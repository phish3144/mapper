/**
 * Einstiegspunkt der Routing-Schicht: Anbieterwahl, ein kleiner Cache und
 * ein Notfall-Rueckfall auf Luftlinien-Schaetzungen.
 */

import type { LatLng, RouteProfile } from '@/types/domain'
import { haversineKm } from '@/lib/geo'
import type { RouteLeg, RouteProvider, TravelMatrix } from './types'
import { readRoutingEnv } from './types'
import { OsrmProvider } from './osrm'
import { OrsProvider } from './ors'

export type { RouteLeg, RouteProvider, RoutingErrorKind, TravelMatrix } from './types'
export { RoutingError, isRoutingError } from './types'
export { decodePolyline, encodePolyline } from './polyline'
export { OsrmProvider } from './osrm'
export { OrsProvider } from './ors'

/** Angenommene Reisegeschwindigkeit fuer den Luftlinien-Rueckfall. */
export const FALLBACK_SPEED_KMH = 50

const MAX_CACHE_ENTRIES = 200

type CacheEntry =
  | { kind: 'route'; value: RouteLeg }
  | { kind: 'matrix'; value: TravelMatrix }

const cache = new Map<string, CacheEntry>()

function coordinateKey(points: readonly LatLng[]): string {
  return points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(';')
}

function cacheKey(
  kind: CacheEntry['kind'],
  providerId: string,
  profile: RouteProfile,
  points: readonly LatLng[],
): string {
  return `${kind}|${providerId}|${profile}|${coordinateKey(points)}`
}

/** Zugriff schiebt den Eintrag ans Ende - damit verdraengt set() den aeltesten. */
function readCache(key: string): CacheEntry | null {
  const entry = cache.get(key)
  if (!entry) return null
  cache.delete(key)
  cache.set(key, entry)
  return entry
}

function writeCache(key: string, entry: CacheEntry): void {
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

export function clearRoutingCache(): void {
  cache.clear()
}

export function routingCacheSize(): number {
  return cache.size
}

/**
 * Kopien herausgeben, damit Aufrufer den Cache-Inhalt nicht versehentlich
 * veraendern. Die Punkte werden mitkopiert - eine flache Kopie der Liste
 * schuetzt nur vor Umsortieren, nicht vor dem Schreiben in einen Punkt.
 */
function copyLeg(leg: RouteLeg): RouteLeg {
  return {
    durationSec: leg.durationSec,
    distanceM: leg.distanceM,
    geometry: leg.geometry.map((p) => ({ lat: p.lat, lng: p.lng })),
  }
}

function copyMatrix(matrix: TravelMatrix): TravelMatrix {
  return {
    durations: matrix.durations.map((row) => row.slice()),
    distances: matrix.distances.map((row) => row.slice()),
  }
}

/** Legt eine Cache-Schicht um einen Anbieter, ohne dessen Verhalten zu aendern. */
export function withCache(provider: RouteProvider): RouteProvider {
  return {
    id: provider.id,
    name: provider.name,
    supportsProfiles: provider.supportsProfiles,
    profileIsDistinct: (profile) => provider.profileIsDistinct(profile),
    route: async (points, profile, signal) => {
      const key = cacheKey('route', provider.id, profile, points)
      const hit = readCache(key)
      if (hit && hit.kind === 'route') return copyLeg(hit.value)
      const leg = await provider.route(points, profile, signal)
      writeCache(key, { kind: 'route', value: leg })
      return copyLeg(leg)
    },
    matrix: async (points, profile, signal) => {
      const key = cacheKey('matrix', provider.id, profile, points)
      const hit = readCache(key)
      if (hit && hit.kind === 'matrix') return copyMatrix(hit.value)
      const matrix = await provider.matrix(points, profile, signal)
      writeCache(key, { kind: 'matrix', value: matrix })
      return copyMatrix(matrix)
    },
  }
}

let activeProvider: RouteProvider | null = null
let activeProviderKey = ''

/**
 * Waehlt OpenRouteService, sobald ein Schluessel hinterlegt ist, sonst OSRM.
 * Das Ergebnis wird gemerkt, bis sich die Konfiguration aendert.
 */
export function getRouteProvider(): RouteProvider {
  const orsKey = readRoutingEnv('VITE_ORS_API_KEY')
  const osrmBase = readRoutingEnv('VITE_OSRM_BASE_URL')
  const key = orsKey ? 'ors' : `osrm|${osrmBase}`
  if (activeProvider && activeProviderKey === key) return activeProvider

  const provider: RouteProvider = orsKey
    ? new OrsProvider(orsKey)
    : new OsrmProvider(osrmBase || undefined)
  activeProvider = withCache(provider)
  activeProviderKey = key
  clearRoutingCache()
  return activeProvider
}

/** Verwirft den gemerkten Anbieter samt Cache (Tests, Konfigurationswechsel). */
export function resetRouteProvider(): void {
  activeProvider = null
  activeProviderKey = ''
  clearRoutingCache()
}

const PROFILE_LABEL: Record<RouteProfile, string> = {
  driving: 'Auto',
  cycling: 'Fahrrad',
  walking: 'zu Fuss',
}

/**
 * Hinweistext, wenn der aktive Dienst Rad- oder Fussprofile nicht wirklich
 * rechnet. Gibt null zurueck, wenn alle Profile echt unterschieden werden.
 */
export function providerNotice(provider: RouteProvider = getRouteProvider()): string | null {
  const fallbacks: RouteProfile[] = (['cycling', 'walking'] as const).filter(
    (profile) => !provider.profileIsDistinct(profile),
  )
  if (fallbacks.length === 0) return null

  const names = fallbacks.map((profile) => PROFILE_LABEL[profile]).join(' und ')
  return (
    `Der Dienst "${provider.name}" berechnet Strecken fuer ${names} nicht eigenstaendig - ` +
    'sie bekommen dieselben Zeiten und Distanzen wie das Auto-Profil. ' +
    'Fuer echte Rad- und Fusswege einen OpenRouteService-Schluessel (VITE_ORS_API_KEY) ' +
    'hinterlegen oder eine eigene OSRM-Instanz ueber VITE_OSRM_BASE_URL eintragen.'
  )
}

/**
 * Notfall-Rueckfall ohne Netz: Luftlinie bei angenommenen 50 km/h. Die Werte
 * sind bewusst grob - sie halten Planung und Oberflaeche am Leben, wenn der
 * Routing-Dienst ausfaellt.
 */
export function haversineMatrix(points: readonly LatLng[]): TravelMatrix {
  const size = points.length
  const durations: number[][] = []
  const distances: number[][] = []

  for (let from = 0; from < size; from++) {
    const durationRow: number[] = new Array<number>(size)
    const distanceRow: number[] = new Array<number>(size)
    for (let to = 0; to < size; to++) {
      if (from === to) {
        durationRow[to] = 0
        distanceRow[to] = 0
        continue
      }
      const km = haversineKm(points[from], points[to])
      distanceRow[to] = km * 1000
      durationRow[to] = (km / FALLBACK_SPEED_KMH) * 3600
    }
    durations.push(durationRow)
    distances.push(distanceRow)
  }

  return { durations, distances }
}
