import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GEOCODE_CACHE_LIMIT,
  MIN_REQUEST_INTERVAL_MS,
  NOMINATIM_BASE_URL,
  createAddressSearch,
  resetGeocodeState,
  findAddress,
  reverseGeocode,
  searchAddress,
} from './geocode'

interface FetchCall {
  url: string
  init: RequestInit
}

let fetchMock: ReturnType<typeof vi.fn>

/** Ein Treffer im Format jsonv2 - Zahlen kommen dort als Strings. */
function nominatimHit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    place_id: 12345,
    lat: '52.5170365',
    lon: '13.3888599',
    display_name: 'Brandenburger Tor, Pariser Platz, Mitte, Berlin, 10117, Deutschland',
    category: 'tourism',
    type: 'attraction',
    addresstype: 'tourism',
    boundingbox: ['52.5161', '52.5179', '13.3766', '13.3899'],
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function brokenJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0')
    },
  } as unknown as Response
}

function calls(): FetchCall[] {
  return fetchMock.mock.calls.map((call: unknown[]) => ({
    url: String(call[0]),
    init: (call[1] ?? {}) as RequestInit,
  }))
}

function calledUrl(index = 0): URL {
  return new URL(calls()[index].url)
}

/**
 * Loest die Wartezeit der Ratenbegrenzung auf. Grosszuegiges Vorspulen schadet
 * nicht - ohne wartenden Zeitgeber passiert dabei nichts.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(MIN_REQUEST_INTERVAL_MS)
  return promise
}

/**
 * Wie settle, aber fuer die Suchkaskade: die geht mehrere Abrufe nacheinander,
 * und zwischen ihnen liegt jeweils der Mindestabstand. Ein einzelner Zeitsprung
 * genuegt dafuer nicht.
 */
async function settleCascade<T>(promise: Promise<T>): Promise<T> {
  let done = false
  const tracked = promise.then((value) => {
    done = true
    return value
  })
  for (let step = 0; step < 12 && !done; step++) {
    await vi.advanceTimersByTimeAsync(MIN_REQUEST_INTERVAL_MS)
  }
  return tracked
}

beforeEach(() => {
  // Feste Zeitgeber in allen Tests: die Ratenbegrenzung rechnet mit Date.now(),
  // echte Uhren wuerden jeden Lauf um Sekunden verlaengern.
  vi.useFakeTimers()
  resetGeocodeState()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('searchAddress - Anfrage', () => {
  it('baut die Such-URL mit jsonv2, Adressdetails, Limit und deutscher Sprache', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    await settle(searchAddress('Brandenburger Tor'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = calledUrl()
    expect(`${url.origin}${url.pathname}`).toBe(`${NOMINATIM_BASE_URL}/search`)
    expect(url.searchParams.get('q')).toBe('Brandenburger Tor')
    expect(url.searchParams.get('format')).toBe('jsonv2')
    expect(url.searchParams.get('addressdetails')).toBe('1')
    expect(url.searchParams.get('limit')).toBe('8')
    expect(url.searchParams.get('accept-language')).toBe('de')
    expect(url.searchParams.get('countrycodes')).toBeNull()
  })

  it('uebernimmt Limit und Laenderfilter', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await settle(searchAddress('Hauptstrasse', { limit: 3, countryCodes: 'DE, AT' }))

    const url = calledUrl()
    expect(url.searchParams.get('limit')).toBe('3')
    expect(url.searchParams.get('countrycodes')).toBe('de,at')
  })

  it('begrenzt das Limit auf 1 bis 40', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await settle(searchAddress('a', { limit: 0 }))
    await settle(searchAddress('b', { limit: 999 }))

    expect(calledUrl(0).searchParams.get('limit')).toBe('1')
    expect(calledUrl(1).searchParams.get('limit')).toBe('40')
  })

  it('setzt den Accept-Language-Header, aber keinen eigenen User-Agent', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    await settle(searchAddress('Berlin'))

    const headers = calls()[0].init.headers as Record<string, string>
    expect(headers['Accept-Language']).toBe('de')
    // Browser verbieten einen eigenen User-Agent - er wuerde die Anfrage
    // scheitern lassen, deshalb darf keiner gesetzt sein.
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('user-agent')
  })

  it('reicht das AbortSignal an fetch durch', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    const controller = new AbortController()
    await settle(searchAddress('Berlin', { signal: controller.signal }))
    expect(calls()[0].init.signal).toBe(controller.signal)
  })

  it('fragt bei leerer Eingabe gar nicht erst an', async () => {
    expect(await searchAddress('')).toEqual([])
    expect(await searchAddress('   ')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('searchAddress - Auswertung', () => {
  it('uebersetzt einen Treffer vollstaendig', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    const hits = await settle(searchAddress('Brandenburger Tor'))

    expect(hits).toHaveLength(1)
    expect(hits[0]).toEqual({
      label: 'Brandenburger Tor, Pariser Platz, Mitte, Berlin, 10117, Deutschland',
      lat: 52.5170365,
      lng: 13.3888599,
      type: 'attraction',
      boundingBox: { south: 52.5161, north: 52.5179, west: 13.3766, east: 13.3899 },
      houseNumber: null,
      road: null,
    })
  })

  it('faellt fuer den Typ auf addresstype zurueck und setzt sonst null', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        nominatimHit({ type: '', addresstype: 'road', category: '' }),
        nominatimHit({ type: null, addresstype: null, category: null, lat: '52.1', lon: '13.1' }),
      ]),
    )
    const hits = await settle(searchAddress('Strasse'))
    expect(hits[0].type).toBe('road')
    expect(hits[1].type).toBeNull()
  })

  it('laesst boundingBox weg, wenn die Box fehlt oder unbrauchbar ist', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        nominatimHit({ boundingbox: undefined }),
        nominatimHit({ boundingbox: ['52.6', '52.5', '13.3', '13.4'], lat: '52.1', lon: '13.1' }),
        nominatimHit({ boundingbox: ['nein', '52.5', '13.3', '13.4'], lat: '52.2', lon: '13.2' }),
      ]),
    )
    const hits = await settle(searchAddress('Strasse'))
    expect(hits.map((hit) => hit.boundingBox)).toEqual([null, null, null])
  })

  it('ueberspringt Eintraege ohne brauchbare Koordinaten', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        nominatimHit({ lat: 'keine Zahl' }),
        nominatimHit({ lon: undefined }),
        nominatimHit({ lat: '95.1' }),
        'kein Objekt',
        null,
        nominatimHit(),
      ]),
    )
    const hits = await settle(searchAddress('Brandenburger Tor'))
    expect(hits).toHaveLength(1)
    expect(hits[0].lat).toBe(52.5170365)
  })
})

describe('searchAddress - Fehlerfaelle', () => {
  it('liefert bei HTTP 429 eine leere Liste, ohne zu werfen', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Bandwidth limit exceeded' }, 429))
    await expect(settle(searchAddress('Berlin'))).resolves.toEqual([])
  })

  it('liefert bei HTTP 500 eine leere Liste', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, 500))
    await expect(settle(searchAddress('Berlin'))).resolves.toEqual([])
  })

  it('liefert bei einem Netzwerkfehler eine leere Liste', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(settle(searchAddress('Berlin'))).resolves.toEqual([])
  })

  it('liefert bei unlesbarem JSON eine leere Liste', async () => {
    fetchMock.mockResolvedValue(brokenJsonResponse())
    await expect(settle(searchAddress('Berlin'))).resolves.toEqual([])
  })

  it('liefert eine leere Liste, wenn die Antwort keine Liste ist', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unable to geocode' }))
    await expect(settle(searchAddress('Berlin'))).resolves.toEqual([])
  })

  it('merkt sich fehlgeschlagene Anfragen nicht', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 500))
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))

    expect(await settle(searchAddress('Berlin'))).toEqual([])
    const hits = await settle(searchAddress('Berlin'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(hits).toHaveLength(1)
  })
})

describe('searchAddress - Cache', () => {
  it('beantwortet dieselbe Anfrage ohne zweiten fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    const first = await settle(searchAddress('Brandenburger Tor'))
    const second = await searchAddress('  brandenburger   TOR ')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('merkt sich auch ein leeres Ergebnis', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    expect(await settle(searchAddress('Gibtsnicht'))).toEqual([])
    expect(await searchAddress('Gibtsnicht')).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('trennt Eintraege nach Limit und Laenderfilter', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    await settle(searchAddress('Berlin'))
    await settle(searchAddress('Berlin', { limit: 3 }))
    await settle(searchAddress('Berlin', { countryCodes: 'de' }))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('gibt eine Kopie heraus, sodass Aufrufer den Cache nicht veraendern', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    const first = await settle(searchAddress('Berlin'))
    first.length = 0

    expect(await searchAddress('Berlin')).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it(`behaelt hoechstens ${GEOCODE_CACHE_LIMIT} Eintraege und verwirft die aeltesten`, async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    const overflow = 3
    const total = GEOCODE_CACHE_LIMIT + overflow
    const pending = Array.from({ length: total }, (_unused, i) => searchAddress(`Strasse ${i}`))
    await vi.advanceTimersByTimeAsync(total * MIN_REQUEST_INTERVAL_MS)
    await Promise.all(pending)
    expect(fetchMock).toHaveBeenCalledTimes(total)

    // Der zuletzt eingetragene Schluessel liegt noch im Cache ...
    await searchAddress(`Strasse ${total - 1}`)
    expect(fetchMock).toHaveBeenCalledTimes(total)

    // ... der aelteste wurde verdraengt und wird neu angefragt.
    await settle(searchAddress('Strasse 0'))
    expect(fetchMock).toHaveBeenCalledTimes(total + 1)
  })
})

describe('Ratenbegrenzung', () => {
  it('serialisiert Anfragen und haelt mindestens 1100 ms Abstand', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    const pending = [searchAddress('eins'), searchAddress('zwei'), searchAddress('drei')]

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1099)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await Promise.all(pending)
  })

  it('gilt auch zwischen Vorwaerts- und Rueckwaertssuche', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([nominatimHit()]))
    fetchMock.mockResolvedValue(jsonResponse(nominatimHit()))
    const pending = [searchAddress('eins'), reverseGeocode({ lat: 52.52, lng: 13.405 })]

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(MIN_REQUEST_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await Promise.all(pending)
  })

  it('laesst nach genuegend Ruhe sofort wieder anfragen', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    await settle(searchAddress('eins'))
    await vi.advanceTimersByTimeAsync(5000)

    const pending = searchAddress('zwei')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await pending
  })
})

describe('reverseGeocode', () => {
  it('baut die Rueckwaerts-URL mit jsonv2 und deutscher Sprache', async () => {
    fetchMock.mockResolvedValue(jsonResponse(nominatimHit()))
    await settle(reverseGeocode({ lat: 52.5170365123, lng: 13.3888599456 }))

    const url = calledUrl()
    expect(`${url.origin}${url.pathname}`).toBe(`${NOMINATIM_BASE_URL}/reverse`)
    expect(url.searchParams.get('format')).toBe('jsonv2')
    expect(url.searchParams.get('accept-language')).toBe('de')
    // Auf sechs Nachkommastellen gerundet - mehr als 0,1 m braucht niemand.
    expect(url.searchParams.get('lat')).toBe('52.517037')
    expect(url.searchParams.get('lon')).toBe('13.38886')
  })

  it('liefert den Treffer der Antwort', async () => {
    fetchMock.mockResolvedValue(jsonResponse(nominatimHit()))
    const hit = await settle(reverseGeocode({ lat: 52.517, lng: 13.3888 }))
    expect(hit?.label).toMatch(/^Brandenburger Tor/)
    expect(hit?.lat).toBe(52.5170365)
    expect(hit?.type).toBe('attraction')
  })

  it('liefert null, wenn Nominatim einen Fehler meldet', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unable to geocode' }))
    await expect(settle(reverseGeocode({ lat: 0, lng: 0 }))).resolves.toBeNull()
  })

  it('liefert null bei HTTP-Fehlern und unlesbarem JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 500))
    await expect(settle(reverseGeocode({ lat: 52.52, lng: 13.4 }))).resolves.toBeNull()

    fetchMock.mockResolvedValueOnce(brokenJsonResponse())
    await expect(settle(reverseGeocode({ lat: 52.53, lng: 13.4 }))).resolves.toBeNull()
  })

  it('fragt ungueltige Koordinaten gar nicht erst an', async () => {
    await expect(reverseGeocode({ lat: 91, lng: 13.4 })).resolves.toBeNull()
    await expect(reverseGeocode({ lat: Number.NaN, lng: 13.4 })).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('beantwortet denselben Punkt aus dem Cache', async () => {
    fetchMock.mockResolvedValue(jsonResponse(nominatimHit()))
    const first = await settle(reverseGeocode({ lat: 52.517037, lng: 13.38886 }))
    const second = await reverseGeocode({ lat: 52.5170365, lng: 13.3888599 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })
})

describe('createAddressSearch', () => {
  it('fragt erst nach Ablauf der Entprellzeit und nur einmal an', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    const search = createAddressSearch(500)
    const onResult = vi.fn()

    search('Bran', onResult)
    search('Brande', onResult)
    search('Brandenburger Tor', onResult)

    await vi.advanceTimersByTimeAsync(499)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calledUrl().searchParams.get('q')).toBe('Brandenburger Tor')
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][1]).toBe('Brandenburger Tor')
    // Der Rueckruf liefert jetzt das reichere Ergebnis samt Fehlergrund.
    expect(onResult.mock.calls[0][0].matches).toHaveLength(1)
  })

  it('bricht die laufende Anfrage ab und meldet nur das letzte Ergebnis', async () => {
    const signals: AbortSignal[] = []
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal
      signals.push(signal)
      if (signals.length === 1) {
        // Erste Anfrage bleibt haengen, bis sie abgebrochen wird - so wie ein
        // echter fetch, der beim Abbruch mit AbortError abweist.
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('Abgebrochen')
            error.name = 'AbortError'
            reject(error)
          })
        })
      }
      return Promise.resolve(jsonResponse([nominatimHit()]))
    })

    const search = createAddressSearch(500)
    const onResult = vi.fn()

    search('Berl', onResult)
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signals[0].aborted).toBe(false)

    search('Berlin', onResult)
    expect(signals[0].aborted).toBe(true)

    await vi.advanceTimersByTimeAsync(500 + MIN_REQUEST_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(calledUrl(1).searchParams.get('q')).toBe('Berlin')
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][1]).toBe('Berlin')
  })

  it('meldet eine leere Eingabe sofort und ohne Anfrage', async () => {
    const search = createAddressSearch(500)
    const onResult = vi.fn()

    search('Berlin', onResult)
    search('   ', onResult)

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith({ matches: [], problem: null }, '')

    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('reicht Limit und Laenderfilter durch', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    const search = createAddressSearch(0)
    search('Hauptstrasse', vi.fn(), { limit: 5, countryCodes: 'de' })

    await vi.advanceTimersByTimeAsync(0)
    expect(calledUrl().searchParams.get('limit')).toBe('5')
    expect(calledUrl().searchParams.get('countrycodes')).toBe('de')
  })

  it('unterdrueckt nach cancel() jede Rueckmeldung', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    const search = createAddressSearch(500)
    const onResult = vi.fn()

    search('Berlin', onResult)
    search.cancel()

    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
  })

  it('beantwortet einen Cache-Treffer ohne erneute Anfrage', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    const search = createAddressSearch(500)
    const onResult = vi.fn()

    search('Berlin', onResult)
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    search('berlin ', onResult)
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledTimes(2)
  })

  it('laesst sich von einem werfenden Callback nicht aus dem Tritt bringen', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    const search = createAddressSearch(0)
    const onResult = vi.fn()

    search('Berlin', () => {
      throw new Error('Fehler im Aufrufer')
    })
    // Der Fehler landet im globalen Fehlerkanal (setTimeout), nicht in der
    // Promise-Kette - dieses Vorspulen laeuft deshalb ohne Rejection durch ...
    await vi.advanceTimersByTimeAsync(0)
    // ... und der Fehler geht trotzdem nicht verloren.
    expect(vi.getTimerCount()).toBe(1)
    expect(() => vi.runOnlyPendingTimers()).toThrow('Fehler im Aufrufer')

    // Die naechste Suche meldet weiterhin.
    search('Hamburg', onResult)
    await vi.advanceTimersByTimeAsync(MIN_REQUEST_INTERVAL_MS)
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][1]).toBe('Hamburg')
  })
})

describe('Randfaelle', () => {
  it('gibt eigenstaendige Treffer heraus - Aenderungen vergiften den Cache nicht', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    const first = await settle(searchAddress('Berlin'))
    first[0].label = 'KAPUTT'
    if (first[0].boundingBox) first[0].boundingBox.north = 0

    const second = await searchAddress('Berlin')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second[0].label).toBe(
      'Brandenburger Tor, Pariser Platz, Mitte, Berlin, 10117, Deutschland',
    )
    expect(second[0].boundingBox?.north).toBe(52.5179)
  })

  it('meldet bei bereits abgebrochenem Signal nichts - auch nicht aus dem Cache', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    expect(await settle(searchAddress('Berlin'))).toHaveLength(1)

    const controller = new AbortController()
    controller.abort()
    expect(await searchAddress('Berlin', { signal: controller.signal })).toEqual([])
    expect(await searchAddress('Hamburg', { signal: controller.signal })).toEqual([])
    expect(await reverseGeocode({ lat: 52.52, lng: 13.4 }, controller.signal)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gibt den Platz in der Warteschlange frei, wenn waehrend der Wartezeit abgebrochen wird', async () => {
    fetchMock.mockResolvedValue(jsonResponse([nominatimHit()]))
    const controller = new AbortController()
    const first = searchAddress('eins')
    await vi.advanceTimersByTimeAsync(0)

    const second = searchAddress('zwei', { signal: controller.signal })
    const third = searchAddress('drei')
    controller.abort()

    await vi.advanceTimersByTimeAsync(5 * MIN_REQUEST_INTERVAL_MS)
    expect(await first).toHaveLength(1)
    expect(await second).toEqual([])
    expect(await third).toHaveLength(1)
    // Die abgebrochene Anfrage geht gar nicht erst hinaus, blockiert aber auch
    // die nachfolgende nicht.
    expect(calls().map((call) => new URL(call.url).searchParams.get('q'))).toEqual([
      'eins',
      'drei',
    ])
  })

  it('behaelt eine Box ueber den 180. Laengengrad hinweg', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([nominatimHit({ boundingbox: ['-18.3', '-12.4', '176.9', '-178.2'] })]),
    )
    const hits = await settle(searchAddress('Fidschi'))
    expect(hits[0].boundingBox).toEqual({
      south: -18.3,
      north: -12.4,
      west: 176.9,
      east: -178.2,
    })
  })

  it('versteht Koordinaten auch als echte Zahlen', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([nominatimHit({ lat: 52.5, lon: 13.4, boundingbox: [52.4, 52.6, 13.3, 13.5] })]),
    )
    const hits = await settle(searchAddress('Berlin'))
    expect(hits[0].lat).toBe(52.5)
    expect(hits[0].lng).toBe(13.4)
    expect(hits[0].boundingBox).toEqual({ south: 52.4, north: 52.6, west: 13.3, east: 13.5 })
  })

  it('kommt mit den Grenzwerten des Koordinatenbereichs zurecht', async () => {
    fetchMock.mockResolvedValue(jsonResponse(nominatimHit({ lat: '-90', lon: '180' })))
    const hit = await settle(reverseGeocode({ lat: -90, lng: 180 }))

    expect(calledUrl().searchParams.get('lat')).toBe('-90')
    expect(calledUrl().searchParams.get('lon')).toBe('180')
    expect(hit?.lat).toBe(-90)
    expect(hit?.lng).toBe(180)
  })

  it('merkt sich, dass an einem Punkt nichts liegt', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unable to geocode' }))
    expect(await settle(reverseGeocode({ lat: 0, lng: 0 }))).toBeNull()
    expect(await reverseGeocode({ lat: 0, lng: 0 })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('wirft leere Glieder aus dem Laenderfilter', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await settle(searchAddress('Hauptstrasse', { countryCodes: ' de , , at ,' }))
    expect(calledUrl().searchParams.get('countrycodes')).toBe('de,at')

    // Derselbe Filter in anderer Schreibweise trifft denselben Cache-Eintrag.
    await searchAddress('Hauptstrasse', { countryCodes: 'DE,AT' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignoriert einen Filter, der nur aus Trennzeichen besteht', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await settle(searchAddress('Hauptstrasse', { countryCodes: ' , , ' }))
    expect(calledUrl().searchParams.get('countrycodes')).toBeNull()
  })
})

describe('findAddress — Kaskade und Fehlerarten', () => {
  it('meldet eine Drosselung als solche, statt "nichts gefunden" zu behaupten', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Too Many Requests' }, 429))
    const result = await settleCascade(findAddress('Horstwiesen 14, 29336 Nienhagen'))

    expect(result.matches).toEqual([])
    expect(result.problem).toBe('rate-limit')
    // Weitere Lockerungsschritte wuerden die Drosselung nur verschlimmern.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('unterscheidet Sperre, Netzfehler und unbrauchbare Antwort', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 403))
    expect((await settleCascade(findAddress('Nienhagen'))).problem).toBe('blocked')

    resetGeocodeState()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await settleCascade(findAddress('Nienhagen'))).problem).toBe('network')
  })

  it('haelt beim ersten Treffer an und meldet kein Problem', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        nominatimHit({
          display_name: '14, Horstwiesen, Nienhagen, 29336, Deutschland',
          type: 'house',
          address: { house_number: '14', road: 'Horstwiesen', postcode: '29336' },
        }),
      ]),
    )
    const result = await settleCascade(findAddress('Horstwiesen 14, 29336 Nienhagen'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.problem).toBeNull()
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].precision).toBe('exact')
    expect(result.matches[0].note).toBeNull()
  })

  it('weist eine Strassenmitte aus, wenn nach einer Hausnummer gefragt war', async () => {
    // Nominatim liefert auf eine unbekannte Hausnummer bereitwillig die
    // Strasse zurueck, ohne das kenntlich zu machen.
    fetchMock.mockResolvedValue(
      jsonResponse([
        nominatimHit({
          display_name: 'Horstwiesen, Nienhagen, 29336, Deutschland',
          type: 'residential',
          address: { road: 'Horstwiesen', postcode: '29336' },
        }),
      ]),
    )
    const result = await settleCascade(findAddress('Horstwiesen 999, 29336 Nienhagen'))

    expect(result.matches[0].precision).toBe('street')
    expect(result.matches[0].note).toContain('Hausnummer')
  })

  it('nennt einen blossen Ortstreffer nicht ungenau, wenn nur ein Ort gesucht war', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        nominatimHit({ display_name: 'Nienhagen, Landkreis Celle', type: 'village', address: {} }),
      ]),
    )
    const result = await settleCascade(findAddress('Nienhagen'))

    expect(result.matches[0].precision).toBe('exact')
    expect(result.matches[0].note).toBeNull()
  })

  it('lockert erst, wenn ein Schritt leer bleibt', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValue(
        jsonResponse([
          nominatimHit({
            display_name: 'Horstwiesen, Nienhagen',
            address: { road: 'Horstwiesen' },
          }),
        ]),
      )
    const result = await settleCascade(findAddress('Horstwiesen 14, 29336 Nienhagen'))

    expect(fetchMock.mock.calls.length).toBeGreaterThan(2)
    expect(result.matches[0].precision).toBe('street')
  })
})
