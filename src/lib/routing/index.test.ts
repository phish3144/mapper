import { beforeEach, describe, expect, it } from 'vitest'
import type { LatLng, RouteProfile } from '@/types/domain'
import { haversineKm } from '@/lib/geo'
import type { RouteLeg, RouteProvider, TravelMatrix } from './types'
import { RoutingError } from './types'
import {
  FALLBACK_SPEED_KMH,
  clearRoutingCache,
  getRouteProvider,
  haversineMatrix,
  providerNotice,
  resetRouteProvider,
  routingCacheSize,
  withCache,
} from './index'

const BERLIN: LatLng[] = [
  { lat: 52.52, lng: 13.405 },
  { lat: 52.5, lng: 13.4 },
]

interface Stub {
  provider: RouteProvider
  calls: { route: number; matrix: number }
}

function stubProvider(id: string, distinct: (profile: RouteProfile) => boolean = () => true): Stub {
  const calls = { route: 0, matrix: 0 }
  const provider: RouteProvider = {
    id,
    name: `Stub ${id}`,
    supportsProfiles: ['driving', 'cycling', 'walking'],
    profileIsDistinct: distinct,
    route: async (points): Promise<RouteLeg> => {
      calls.route += 1
      return {
        durationSec: 60 * calls.route,
        distanceM: 1000,
        geometry: points.map((p) => ({ lat: p.lat, lng: p.lng })),
      }
    },
    matrix: async (points): Promise<TravelMatrix> => {
      calls.matrix += 1
      const size = points.length
      const build = (base: number): number[][] =>
        Array.from({ length: size }, (_unused, i) =>
          Array.from({ length: size }, (_ignored, j) => (i === j ? 0 : base + i * 10 + j)),
        )
      return { durations: build(calls.matrix), distances: build(100) }
    },
  }
  return { provider, calls }
}

beforeEach(() => {
  resetRouteProvider()
  clearRoutingCache()
})

describe('withCache', () => {
  it('beantwortet die zweite gleiche Anfrage aus dem Zwischenspeicher', async () => {
    const { provider, calls } = stubProvider('a')
    const cached = withCache(provider)
    const first = await cached.route(BERLIN, 'driving')
    const second = await cached.route(BERLIN, 'driving')
    expect(calls.route).toBe(1)
    expect(second).toEqual(first)
  })

  it('trennt Strecke und Matrix, Profile und Punktmengen', async () => {
    const { provider, calls } = stubProvider('a')
    const cached = withCache(provider)
    await cached.route(BERLIN, 'driving')
    await cached.matrix(BERLIN, 'driving')
    await cached.route(BERLIN, 'cycling')
    await cached.route([BERLIN[0], { lat: 52.4, lng: 13.3 }], 'driving')
    expect(calls.route).toBe(3)
    expect(calls.matrix).toBe(1)
  })

  it('trennt zwei Instanzen desselben Dienstes anhand der Kennung', async () => {
    // Der Anzeigename allein wuerde hier kollidieren: beide heissen "OSRM".
    const a = stubProvider('osrm|https://a.example.org')
    const b = stubProvider('osrm|https://b.example.org')
    const first = await withCache(a.provider).route(BERLIN, 'driving')
    const second = await withCache(b.provider).route(BERLIN, 'driving')
    expect(a.calls.route).toBe(1)
    expect(b.calls.route).toBe(1)
    expect(second.durationSec).toBe(first.durationSec)
  })

  it('reicht Kennung, Name, Profile und Signal an den Anbieter durch', async () => {
    const { provider } = stubProvider('a', (profile) => profile === 'driving')
    const cached = withCache(provider)
    expect(cached.id).toBe('a')
    expect(cached.name).toBe('Stub a')
    expect(cached.supportsProfiles).toEqual(['driving', 'cycling', 'walking'])
    expect(cached.profileIsDistinct('driving')).toBe(true)
    expect(cached.profileIsDistinct('walking')).toBe(false)
  })

  it('gibt Kopien heraus - auch die einzelnen Punkte der Geometrie', async () => {
    const { provider } = stubProvider('a')
    const cached = withCache(provider)
    const first = await cached.route(BERLIN, 'driving')
    first.geometry[0].lat = 0
    first.geometry.length = 0
    const second = await cached.route(BERLIN, 'driving')
    expect(second.geometry).toEqual(BERLIN)
  })

  it('gibt auch die Matrix als Kopie heraus', async () => {
    const { provider } = stubProvider('a')
    const cached = withCache(provider)
    const first = await cached.matrix(BERLIN, 'driving')
    first.durations[0][1] = -1
    const second = await cached.matrix(BERLIN, 'driving')
    expect(second.durations[0][1]).not.toBe(-1)
  })

  it('merkt sich Fehler nicht - die naechste Anfrage darf es erneut versuchen', async () => {
    let attempts = 0
    const provider: RouteProvider = {
      ...stubProvider('a').provider,
      matrix: async (): Promise<TravelMatrix> => {
        attempts += 1
        if (attempts === 1) throw new RoutingError('network', 'kurzer Ausfall')
        return { durations: [[0, 1], [1, 0]], distances: [[0, 2], [2, 0]] }
      },
    }
    const cached = withCache(provider)
    await expect(cached.matrix(BERLIN, 'driving')).rejects.toBeInstanceOf(RoutingError)
    const matrix = await cached.matrix(BERLIN, 'driving')
    expect(attempts).toBe(2)
    expect(matrix.durations[0][1]).toBe(1)
  })

  it('haelt hoechstens 200 Eintraege und verdraengt den am laengsten ungenutzten', async () => {
    const { provider, calls } = stubProvider('a')
    const cached = withCache(provider)
    const pointsAt = (i: number): LatLng[] => [BERLIN[0], { lat: 52 + i * 0.001, lng: 13.4 }]

    for (let i = 0; i < 200; i++) await cached.route(pointsAt(i), 'driving')
    expect(routingCacheSize()).toBe(200)
    expect(calls.route).toBe(200)

    // Zugriff auf den aeltesten Eintrag schiebt ihn ans Ende ...
    await cached.route(pointsAt(0), 'driving')
    expect(calls.route).toBe(200)

    // ... also faellt beim naechsten Neuzugang Nummer 1 heraus, nicht Nummer 0.
    await cached.route(pointsAt(200), 'driving')
    expect(routingCacheSize()).toBe(200)
    expect(calls.route).toBe(201)

    await cached.route(pointsAt(0), 'driving')
    expect(calls.route).toBe(201)
    await cached.route(pointsAt(1), 'driving')
    expect(calls.route).toBe(202)
  })

  it('unterscheidet Punkte erst ab der siebten Nachkommastelle nicht mehr', async () => {
    const { provider, calls } = stubProvider('a')
    const cached = withCache(provider)
    await cached.route(BERLIN, 'driving')
    await cached.route([{ lat: 52.5200001, lng: 13.405 }, BERLIN[1]], 'driving')
    expect(calls.route).toBe(1)
    await cached.route([{ lat: 52.520001, lng: 13.405 }, BERLIN[1]], 'driving')
    expect(calls.route).toBe(2)
  })

  it('leert sich auf Zuruf', async () => {
    const { provider, calls } = stubProvider('a')
    const cached = withCache(provider)
    await cached.route(BERLIN, 'driving')
    expect(routingCacheSize()).toBe(1)
    clearRoutingCache()
    expect(routingCacheSize()).toBe(0)
    await cached.route(BERLIN, 'driving')
    expect(calls.route).toBe(2)
  })
})

describe('getRouteProvider', () => {
  it('merkt sich den Anbieter, bis er verworfen wird', () => {
    const first = getRouteProvider()
    expect(getRouteProvider()).toBe(first)
    resetRouteProvider()
    expect(getRouteProvider()).not.toBe(first)
  })

  it('liefert einen Anbieter mit vollstaendigem Vertrag', () => {
    const provider = getRouteProvider()
    expect(provider.id).toMatch(/^(osrm|ors)\|/)
    expect(provider.name.length).toBeGreaterThan(0)
    expect(provider.supportsProfiles).toEqual(['driving', 'cycling', 'walking'])
    expect(typeof provider.route).toBe('function')
    expect(typeof provider.matrix).toBe('function')
  })

  it('verwirft beim Zuruecksetzen auch den Zwischenspeicher', async () => {
    const { provider } = stubProvider('a')
    await withCache(provider).route(BERLIN, 'driving')
    expect(routingCacheSize()).toBe(1)
    resetRouteProvider()
    expect(routingCacheSize()).toBe(0)
  })
})

describe('providerNotice', () => {
  it('schweigt, wenn alle Profile echt unterschieden werden', () => {
    expect(providerNotice(stubProvider('a').provider)).toBeNull()
  })

  it('nennt beide Ersatzprofile beim Namen', () => {
    const notice = providerNotice(stubProvider('a', (p) => p === 'driving').provider)
    expect(notice).toContain('Fahrrad und zu Fuss')
    expect(notice).toContain('Stub a')
    expect(notice).toContain('VITE_ORS_API_KEY')
  })

  it('nennt nur das tatsaechlich betroffene Profil', () => {
    const notice = providerNotice(stubProvider('a', (p) => p !== 'walking').provider)
    expect(notice).toContain('zu Fuss')
    expect(notice).not.toContain('Fahrrad')
  })

  it('faellt ohne Argument auf den aktiven Anbieter zurueck', () => {
    const provider = getRouteProvider()
    const expected = provider.profileIsDistinct('cycling') && provider.profileIsDistinct('walking')
    expect(providerNotice() === null).toBe(expected)
  })
})

describe('haversineMatrix', () => {
  it('vertraegt eine leere Punktliste', () => {
    expect(haversineMatrix([])).toEqual({ durations: [], distances: [] })
  })

  it('liefert fuer einen einzelnen Punkt die Nullmatrix', () => {
    expect(haversineMatrix([BERLIN[0]])).toEqual({ durations: [[0]], distances: [[0]] })
  })

  it('setzt die Diagonale auf null und bleibt symmetrisch', () => {
    const points: LatLng[] = [...BERLIN, { lat: 48.137, lng: 11.575 }]
    const { durations, distances } = haversineMatrix(points)
    expect(durations).toHaveLength(3)
    for (let i = 0; i < 3; i++) {
      expect(durations[i]).toHaveLength(3)
      expect(durations[i][i]).toBe(0)
      expect(distances[i][i]).toBe(0)
      for (let j = 0; j < 3; j++) {
        expect(distances[i][j]).toBeCloseTo(distances[j][i], 6)
      }
    }
  })

  it('rechnet Meter und Sekunden bei angenommenen 50 km/h', () => {
    const { durations, distances } = haversineMatrix(BERLIN)
    const km = haversineKm(BERLIN[0], BERLIN[1])
    expect(km).toBeGreaterThan(2)
    expect(km).toBeLessThan(3)
    expect(distances[0][1]).toBeCloseTo(km * 1000, 6)
    expect(durations[0][1]).toBeCloseTo((km / FALLBACK_SPEED_KMH) * 3600, 6)
    expect(FALLBACK_SPEED_KMH).toBe(50)
  })

  it('liefert durchweg endliche Werte - die Planung darf daran nicht scheitern', () => {
    const points: LatLng[] = [
      { lat: 90, lng: 180 },
      { lat: -90, lng: -180 },
      { lat: 0, lng: 0 },
    ]
    for (const row of haversineMatrix(points).durations) {
      for (const value of row) expect(Number.isFinite(value)).toBe(true)
    }
  })
})
