import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatLng } from '@/types/domain'
import { ORS_BASE_URL, OrsProvider } from './ors'
import { RoutingError } from './types'

const KEY = 'test-schluessel'

const BERLIN: LatLng[] = [
  { lat: 52.52, lng: 13.405 },
  { lat: 52.5, lng: 13.4 },
]

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** Antwort ohne lesbaren Rumpf - so verhaelt sich ORS bei 500ern (HTML). */
function brokenResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token <')
    },
  } as unknown as Response
}

function directionsBody(
  coordinates: unknown[],
  summary: unknown = { duration: 388.6, distance: 3800.9 },
): unknown {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { summary }, geometry: { type: 'LineString', coordinates } }],
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function calledUrl(index = 0): string {
  return String(fetchMock.mock.calls[index][0])
}

function calledInit(index = 0): RequestInit {
  return fetchMock.mock.calls[index][1] as RequestInit
}

function calledPayload(index = 0): Record<string, unknown> {
  return JSON.parse(String(calledInit(index).body)) as Record<string, unknown>
}

describe('OrsProvider - Konfiguration', () => {
  it('nutzt die offizielle Basis-URL und entfernt abschliessende Schraegstriche', () => {
    expect(new OrsProvider(KEY).baseUrl).toBe(ORS_BASE_URL)
    expect(new OrsProvider(KEY, 'https://ors.example.org//').baseUrl).toBe('https://ors.example.org')
    expect(new OrsProvider(KEY, '   ').baseUrl).toBe(ORS_BASE_URL)
  })

  it('traegt die Basis-URL in die Kennung, den Schluessel aber nicht', () => {
    const provider = new OrsProvider(KEY, 'https://ors.example.org')
    expect(provider.id).toBe('ors|https://ors.example.org')
    expect(provider.id).not.toContain(KEY)
  })

  it('unterscheidet alle Profile echt', () => {
    const provider = new OrsProvider(KEY)
    expect(provider.profileIsDistinct()).toBe(true)
    expect(provider.supportsProfiles).toEqual(['driving', 'cycling', 'walking'])
  })

  it('verweigert ohne Schluessel die Anfrage, statt sie abzuschicken', async () => {
    const error = await new OrsProvider('').route(BERLIN, 'driving').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RoutingError)
    expect((error as RoutingError).kind).toBe('bad-request')
    expect((error as RoutingError).message).toMatch(/VITE_ORS_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('OrsProvider.route - Anfrage', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(
      jsonResponse(directionsBody([[13.405, 52.52], [13.4, 52.5]])),
    )
  })

  it('schickt Koordinaten als [lng, lat] im Rumpf, nicht in der URL', async () => {
    await new OrsProvider(KEY).route(BERLIN, 'driving')
    expect(calledUrl()).toBe(`${ORS_BASE_URL}/v2/directions/driving-car/geojson`)
    expect(calledInit().method).toBe('POST')
    expect(calledPayload()).toEqual({ coordinates: [[13.405, 52.52], [13.4, 52.5]] })
  })

  it('setzt Schluessel und Kopfzeilen', async () => {
    await new OrsProvider(KEY).route(BERLIN, 'driving')
    expect(calledInit().headers).toEqual({
      Authorization: KEY,
      'Content-Type': 'application/json',
      Accept: 'application/geo+json',
    })
  })

  it.each([
    ['driving', 'driving-car'],
    ['cycling', 'cycling-regular'],
    ['walking', 'foot-walking'],
  ] as const)('bildet das Profil %s auf %s ab', async (profile, expected) => {
    await new OrsProvider(KEY).route(BERLIN, profile)
    expect(calledUrl()).toBe(`${ORS_BASE_URL}/v2/directions/${expected}/geojson`)
  })

  it('rundet Koordinaten auf sechs Nachkommastellen', async () => {
    await new OrsProvider(KEY).route(
      [
        { lat: 52.5200066123, lng: 13.404953999 },
        { lat: 52.5, lng: 13.4 },
      ],
      'driving',
    )
    expect(calledPayload().coordinates).toEqual([[13.404954, 52.520007], [13.4, 52.5]])
  })

  it('reicht das AbortSignal durch', async () => {
    const controller = new AbortController()
    await new OrsProvider(KEY).route(BERLIN, 'driving', controller.signal)
    expect(calledInit().signal).toBe(controller.signal)
  })
})

describe('OrsProvider.route - Auswertung', () => {
  it('dreht [lng, lat] zu {lat, lng} und uebernimmt die Zusammenfassung', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(directionsBody([[13.405, 52.52], [13.402, 52.515], [13.4, 52.5]])),
    )
    const leg = await new OrsProvider(KEY).route(BERLIN, 'driving')
    expect(leg.durationSec).toBe(388.6)
    expect(leg.distanceM).toBe(3800.9)
    expect(leg.geometry).toEqual([
      { lat: 52.52, lng: 13.405 },
      { lat: 52.515, lng: 13.402 },
      { lat: 52.5, lng: 13.4 },
    ])
  })

  it('ueberspringt unbrauchbare Koordinatenpaare, statt NaN zu erzeugen', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(directionsBody([[13.405, 52.52], ['x', 1], null, [13.4, 52.5]])),
    )
    const leg = await new OrsProvider(KEY).route(BERLIN, 'driving')
    expect(leg.geometry).toEqual([
      { lat: 52.52, lng: 13.405 },
      { lat: 52.5, lng: 13.4 },
    ])
  })

  it('liest eine leere Zusammenfassung als Nulldistanz, nicht als Infinity', async () => {
    // ORS laesst distance/duration weg, wenn Start und Ziel auf denselben
    // Punkt schnappen. Die Strecke existiert, sie ist nur leer.
    fetchMock.mockResolvedValue(jsonResponse(directionsBody([[13.405, 52.52]], {})))
    const leg = await new OrsProvider(KEY).route(BERLIN, 'driving')
    expect(leg.durationSec).toBe(0)
    expect(leg.distanceM).toBe(0)
  })

  it('meldet eine leere Feature-Liste als no-route', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ type: 'FeatureCollection', features: [] }))
    await expect(new OrsProvider(KEY).route(BERLIN, 'driving')).rejects.toMatchObject({
      kind: 'no-route',
    })
  })

  it('lehnt weniger als zwei Punkte ohne Anfrage ab', async () => {
    await expect(new OrsProvider(KEY).route([BERLIN[0]], 'driving')).rejects.toMatchObject({
      kind: 'bad-request',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lehnt ungueltige Koordinaten ohne Anfrage ab', async () => {
    await expect(
      new OrsProvider(KEY).route([BERLIN[0], { lat: 52.5, lng: 200 }], 'driving'),
    ).rejects.toThrow(/Punkt 2 hat keine gueltigen Koordinaten/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lehnt mehr als 50 Punkte ohne Anfrage ab', async () => {
    const many: LatLng[] = Array.from({ length: 51 }, (_unused, i) => ({
      lat: 52.5 + i * 0.001,
      lng: 13.4 + i * 0.001,
    }))
    const error = await new OrsProvider(KEY).route(many, 'driving').catch((e: unknown) => e)
    expect((error as RoutingError).kind).toBe('bad-request')
    expect((error as RoutingError).message).toMatch(/hoechstens 50 Punkte/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('OrsProvider.matrix', () => {
  it('fragt Dauer und Distanz in Metern ab', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        durations: [
          [0, 388.6],
          [401.2, 0],
        ],
        distances: [
          [0, 3800.9],
          [3900.1, 0],
        ],
      }),
    )
    const matrix = await new OrsProvider(KEY).matrix(BERLIN, 'cycling')

    expect(calledUrl()).toBe(`${ORS_BASE_URL}/v2/matrix/cycling-regular`)
    expect(calledPayload()).toEqual({
      locations: [[13.405, 52.52], [13.4, 52.5]],
      metrics: ['duration', 'distance'],
      units: 'm',
    })
    expect(matrix.durations[0][1]).toBe(388.6)
    expect(matrix.distances[1][0]).toBe(3900.1)
  })

  it('macht aus nicht erreichbaren Paaren (null) Infinity', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        durations: [
          [0, null],
          [12, 0],
        ],
        distances: [
          [0, null],
          [34, 0],
        ],
      }),
    )
    const matrix = await new OrsProvider(KEY).matrix(BERLIN, 'driving')
    expect(matrix.durations[0][1]).toBe(Number.POSITIVE_INFINITY)
    expect(matrix.distances[0][1]).toBe(Number.POSITIVE_INFINITY)
  })

  it('fuellt zu kurze Zeilen auf die erwartete Groesse auf', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ durations: [[0], [12, 0]], distances: [[0], [34, 0]] }),
    )
    const matrix = await new OrsProvider(KEY).matrix(BERLIN, 'driving')
    expect(matrix.durations[0]).toHaveLength(2)
    expect(matrix.durations[0][1]).toBe(Number.POSITIVE_INFINITY)
  })

  it('beantwortet einen einzelnen Punkt ohne Anfrage und ohne Schluessel', async () => {
    const matrix = await new OrsProvider('').matrix([BERLIN[0]], 'driving')
    expect(matrix).toEqual({ durations: [[0]], distances: [[0]] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('meldet eine unvollstaendige Matrix als unknown', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ durations: [[0, 1], [1, 0]] }))
    const error = await new OrsProvider(KEY).matrix(BERLIN, 'driving').catch((e: unknown) => e)
    expect((error as RoutingError).kind).toBe('unknown')
  })
})

describe('OrsProvider - Fehlerabbildung', () => {
  async function failureOf(response: Response): Promise<RoutingError> {
    fetchMock.mockResolvedValue(response)
    const error = await new OrsProvider(KEY).route(BERLIN, 'driving').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RoutingError)
    return error as RoutingError
  }

  it('bildet HTTP 429 auf kind "limit" ab', async () => {
    const error = await failureOf(jsonResponse({ error: { code: 2003, message: 'Rate limit' } }, 429))
    expect(error.kind).toBe('limit')
    expect(error.status).toBe(429)
  })

  it('erkennt das aufgebrauchte Tageskontingent trotz HTTP 403', async () => {
    const error = await failureOf(jsonResponse({ error: 'Quota exceeded' }, 403))
    expect(error.kind).toBe('limit')
  })

  it('bildet einen abgelehnten Schluessel auf bad-request ab', async () => {
    for (const status of [401, 403]) {
      const error = await failureOf(jsonResponse({ error: 'Access to this API has been disallowed' }, status))
      expect(error.kind).toBe('bad-request')
      expect(error.message).toMatch(/API-Schluessel/)
    }
  })

  it('bildet die Fehlercodes fuer "kein Weg" auf no-route ab', async () => {
    for (const code of [2009, 2010, 6010, 6011]) {
      const error = await failureOf(jsonResponse({ error: { code, message: 'Could not find routable point' } }, 404))
      expect(error.kind).toBe('no-route')
    }
  })

  it('erkennt "kein Weg" auch nur am Text', async () => {
    const error = await failureOf(
      jsonResponse({ error: { code: 9999, message: 'Route could not be found - unknown' } }, 404),
    )
    expect(error.kind).toBe('no-route')
  })

  it('bildet 5xx auf network ab, auch ohne lesbaren Rumpf', async () => {
    const error = await failureOf(brokenResponse(502))
    expect(error.kind).toBe('network')
    expect(error.status).toBe(502)
  })

  it('bildet uebrige 4xx auf bad-request ab und nennt die Serverantwort', async () => {
    const error = await failureOf(jsonResponse({ error: { code: 2004, message: 'Too many locations' } }, 400))
    expect(error.kind).toBe('bad-request')
    expect(error.message).toMatch(/Too many locations/)
  })

  it('meldet einen Fehler auch bei HTTP 200, statt ihn zu verschlucken', async () => {
    const error = await failureOf(jsonResponse({ error: { code: 9999, message: 'Merkwuerdig' } }, 200))
    expect(error.kind).toBe('unknown')
  })

  it('bildet einen Netzwerkabbruch auf kind "network" ab', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await new OrsProvider(KEY).route(BERLIN, 'driving').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RoutingError)
    expect((error as RoutingError).kind).toBe('network')
  })

  it('reicht einen Abbruch unveraendert weiter', async () => {
    const abort = Object.assign(new Error('Abgebrochen'), { name: 'AbortError' })
    fetchMock.mockRejectedValue(abort)
    const error = await new OrsProvider(KEY).route(BERLIN, 'driving').catch((e: unknown) => e)
    expect(error).toBe(abort)
    expect(error).not.toBeInstanceOf(RoutingError)
  })
})
