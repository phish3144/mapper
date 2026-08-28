import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatLng } from '@/types/domain'
import { OSRM_PUBLIC_DEMO_URL, OsrmProvider } from './osrm'
import { encodePolyline } from './polyline'
import { RoutingError } from './types'

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

function routeBody(geometry: string, duration = 388.6, distance = 3800.9): unknown {
  return { code: 'Ok', routes: [{ duration, distance, geometry }], waypoints: [] }
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

describe('OsrmProvider - Konfiguration', () => {
  // Vite ersetzt import.meta.env je Modul statisch durch ein Objektliteral.
  // Ein Stub aus der Testdatei erreicht das Anbieter-Modul deshalb nicht -
  // fuer abweichende Basis-URLs nimmt der Test das Konstruktor-Argument.
  it('nutzt ohne Argument die Umgebung und faellt auf den Demoserver zurueck', () => {
    expect(new OsrmProvider().baseUrl).toBe(OSRM_PUBLIC_DEMO_URL)
    expect(new OsrmProvider('   ').baseUrl).toBe(OSRM_PUBLIC_DEMO_URL)
  })

  it('uebernimmt eine eigene Basis-URL und entfernt den abschliessenden Schraegstrich', () => {
    expect(new OsrmProvider('https://osrm.example.org/').baseUrl).toBe('https://osrm.example.org')
    expect(new OsrmProvider('https://osrm.example.org:5000//').baseUrl).toBe(
      'https://osrm.example.org:5000',
    )
  })
})

describe('OsrmProvider.profileIsDistinct', () => {
  it('kennt auf dem Demoserver nur das Auto-Profil als echt', () => {
    const provider = new OsrmProvider(OSRM_PUBLIC_DEMO_URL)
    expect(provider.isPublicDemo).toBe(true)
    expect(provider.profileIsDistinct('driving')).toBe(true)
    expect(provider.profileIsDistinct('cycling')).toBe(false)
    expect(provider.profileIsDistinct('walking')).toBe(false)
  })

  it('traut einer eigenen Instanz alle Profile zu', () => {
    const provider = new OsrmProvider('https://osrm.example.org')
    expect(provider.isPublicDemo).toBe(false)
    expect(provider.profileIsDistinct('driving')).toBe(true)
    expect(provider.profileIsDistinct('cycling')).toBe(true)
    expect(provider.profileIsDistinct('walking')).toBe(true)
  })
})

describe('OsrmProvider.route - URL-Bau', () => {
  it('baut die Strecken-URL mit lng,lat-Paaren', async () => {
    fetchMock.mockResolvedValue(jsonResponse(routeBody(encodePolyline(BERLIN))))
    await new OsrmProvider(OSRM_PUBLIC_DEMO_URL).route(BERLIN, 'driving')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calledUrl()).toBe(
      `${OSRM_PUBLIC_DEMO_URL}/route/v1/driving/13.405,52.52;13.4,52.5` +
        '?overview=full&geometries=polyline&steps=false&alternatives=false',
    )
  })

  it.each([
    ['cycling', 'bike'],
    ['walking', 'foot'],
    ['driving', 'driving'],
  ] as const)('bildet das Profil %s auf %s ab', async (profile, expected) => {
    fetchMock.mockResolvedValue(jsonResponse(routeBody(encodePolyline(BERLIN))))
    await new OsrmProvider(OSRM_PUBLIC_DEMO_URL).route(BERLIN, profile)
    expect(calledUrl()).toContain(`/route/v1/${expected}/`)
  })

  it('rundet Koordinaten auf sechs Nachkommastellen', async () => {
    fetchMock.mockResolvedValue(jsonResponse(routeBody(encodePolyline(BERLIN))))
    await new OsrmProvider(OSRM_PUBLIC_DEMO_URL).route(
      [
        { lat: 52.5200066123, lng: 13.404953999 },
        { lat: 52.5, lng: 13.4 },
      ],
      'driving',
    )
    expect(calledUrl()).toContain('/13.404954,52.520007;13.4,52.5?')
  })

  it('reicht das AbortSignal durch', async () => {
    fetchMock.mockResolvedValue(jsonResponse(routeBody(encodePolyline(BERLIN))))
    const controller = new AbortController()
    await new OsrmProvider().route(BERLIN, 'driving', controller.signal)
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })
})

describe('OsrmProvider.route - Auswertung', () => {
  it('liefert Dauer, Distanz und dekodierte Geometrie', async () => {
    const geometry: LatLng[] = [
      { lat: 52.52, lng: 13.405 },
      { lat: 52.515, lng: 13.402 },
      { lat: 52.5, lng: 13.4 },
    ]
    fetchMock.mockResolvedValue(jsonResponse(routeBody(encodePolyline(geometry), 388.6, 3800.9)))

    const leg = await new OsrmProvider().route(BERLIN, 'driving')
    expect(leg.durationSec).toBe(388.6)
    expect(leg.distanceM).toBe(3800.9)
    expect(leg.geometry).toEqual(geometry)
  })

  it('meldet eine leere Streckenliste als no-route', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'Ok', routes: [] }))
    await expect(new OsrmProvider().route(BERLIN, 'driving')).rejects.toMatchObject({
      kind: 'no-route',
    })
  })

  it('lehnt weniger als zwei Punkte ohne Anfrage ab', async () => {
    await expect(new OsrmProvider().route([BERLIN[0]], 'driving')).rejects.toMatchObject({
      kind: 'bad-request',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lehnt ungueltige Koordinaten ohne Anfrage ab', async () => {
    const broken = [BERLIN[0], { lat: 95, lng: 13.4 }]
    await expect(new OsrmProvider().route(broken, 'driving')).rejects.toThrow(
      /Punkt 2 hat keine gueltigen Koordinaten/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('OsrmProvider - Fehlerabbildung', () => {
  it('bildet HTTP 429 auf kind "limit" ab', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Too many requests' }, 429))
    const error = await new OsrmProvider().route(BERLIN, 'driving').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RoutingError)
    expect((error as RoutingError).kind).toBe('limit')
    expect((error as RoutingError).status).toBe(429)
  })

  it('bildet den Code "NoRoute" auf kind "no-route" ab', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'NoRoute', message: 'Impossible route between points' }, 400),
    )
    const error = await new OsrmProvider().route(BERLIN, 'driving').catch((e: unknown) => e)
    expect((error as RoutingError).kind).toBe('no-route')
    expect((error as RoutingError).message).toMatch(/keine Strecke berechnen/)
  })

  it('bildet den Code "InvalidQuery" auf kind "bad-request" ab', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'InvalidQuery', message: 'Query string' }, 400))
    const error = await new OsrmProvider().route(BERLIN, 'driving').catch((e: unknown) => e)
    expect((error as RoutingError).kind).toBe('bad-request')
  })

  it('bildet einen Netzwerkabbruch auf kind "network" ab', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await new OsrmProvider().route(BERLIN, 'driving').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RoutingError)
    expect((error as RoutingError).kind).toBe('network')
  })

  it('bildet HTTP 503 auf kind "network" ab', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, 503))
    const error = await new OsrmProvider().route(BERLIN, 'driving').catch((e: unknown) => e)
    expect((error as RoutingError).kind).toBe('network')
  })

  it('reicht einen Abbruch unveraendert weiter', async () => {
    const abort = Object.assign(new Error('Abgebrochen'), { name: 'AbortError' })
    fetchMock.mockRejectedValue(abort)
    const error = await new OsrmProvider().route(BERLIN, 'driving').catch((e: unknown) => e)
    expect(error).toBe(abort)
    expect(error).not.toBeInstanceOf(RoutingError)
  })
})

describe('OsrmProvider.matrix', () => {
  it('baut die Tabellen-URL mit Dauer- und Distanzangaben', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 'Ok',
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
    const matrix = await new OsrmProvider(OSRM_PUBLIC_DEMO_URL).matrix(BERLIN, 'cycling')

    expect(calledUrl()).toBe(
      `${OSRM_PUBLIC_DEMO_URL}/table/v1/bike/13.405,52.52;13.4,52.5?annotations=duration,distance`,
    )
    expect(matrix.durations).toEqual([
      [0, 388.6],
      [401.2, 0],
    ])
    expect(matrix.distances[0][1]).toBe(3800.9)
  })

  it('macht aus nicht erreichbaren Paaren (null) Infinity', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 'Ok',
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
    const matrix = await new OsrmProvider().matrix(BERLIN, 'driving')
    expect(matrix.durations[0][1]).toBe(Number.POSITIVE_INFINITY)
    expect(matrix.distances[0][1]).toBe(Number.POSITIVE_INFINITY)
  })

  it('lehnt mehr als 100 Punkte ohne Anfrage ab', async () => {
    const many: LatLng[] = Array.from({ length: 101 }, (_unused, i) => ({
      lat: 52.5 + i * 0.001,
      lng: 13.4 + i * 0.001,
    }))
    const error = await new OsrmProvider().matrix(many, 'driving').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RoutingError)
    expect((error as RoutingError).kind).toBe('bad-request')
    expect((error as RoutingError).message).toMatch(/hoechstens 100 Punkte/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('beantwortet einen einzelnen Punkt ohne Anfrage', async () => {
    const matrix = await new OsrmProvider().matrix([BERLIN[0]], 'driving')
    expect(matrix).toEqual({ durations: [[0]], distances: [[0]] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('meldet eine unvollstaendige Matrix als unknown', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 'Ok', durations: [[0, 1]] }))
    const error = await new OsrmProvider().matrix(BERLIN, 'driving').catch((e: unknown) => e)
    expect((error as RoutingError).kind).toBe('unknown')
  })
})

describe('OsrmProvider - Kennung und Randfaelle der Matrix', () => {
  it('traegt die Basis-URL in die Kennung, damit zwei Instanzen unterscheidbar bleiben', () => {
    expect(new OsrmProvider('https://a.example.org').id).toBe('osrm|https://a.example.org')
    expect(new OsrmProvider('https://b.example.org').id).not.toBe(
      new OsrmProvider('https://a.example.org').id,
    )
    // Beide heissen gleich - allein am Namen waeren sie nicht zu trennen.
    expect(new OsrmProvider('https://a.example.org').name).toBe(
      new OsrmProvider('https://b.example.org').name,
    )
  })

  it('fuellt fehlende Zeilen und Spalten mit Infinity auf', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'Ok', durations: [[0]], distances: [[0]] }),
    )
    const matrix = await new OsrmProvider().matrix(BERLIN, 'driving')
    expect(matrix.durations).toEqual([
      [0, Number.POSITIVE_INFINITY],
      [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    ])
    expect(matrix.distances[1][0]).toBe(Number.POSITIVE_INFINITY)
  })

  it('lehnt auch bei route() mehr als 100 Punkte ab', async () => {
    const many: LatLng[] = Array.from({ length: 101 }, (_unused, i) => ({
      lat: 52.5 + i * 0.001,
      lng: 13.4 + i * 0.001,
    }))
    const error = await new OsrmProvider().route(many, 'driving').catch((e: unknown) => e)
    expect((error as RoutingError).kind).toBe('bad-request')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lehnt eine leere Punktliste ab, statt eine kaputte URL zu bauen', async () => {
    await expect(new OsrmProvider().matrix([], 'driving')).rejects.toMatchObject({
      kind: 'bad-request',
    })
    await expect(new OsrmProvider().route([], 'driving')).rejects.toMatchObject({
      kind: 'bad-request',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('meldet eine Antwort ohne Geometrie als unknown', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'Ok', routes: [{ duration: 1, distance: 2 }] }),
    )
    const error = await new OsrmProvider().route(BERLIN, 'driving').catch((e: unknown) => e)
    expect((error as RoutingError).kind).toBe('unknown')
  })

  it('meldet einen unlesbaren Rumpf bei HTTP 200 als unknown', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    } as unknown as Response)
    const error = await new OsrmProvider().route(BERLIN, 'driving').catch((e: unknown) => e)
    expect((error as RoutingError).kind).toBe('unknown')
  })
})
