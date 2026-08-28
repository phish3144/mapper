/**
 * Gemeinsamer Vertrag aller Routing-Anbieter (OSRM, OpenRouteService, ...).
 *
 * Einheiten sind im gesamten Modul einheitlich: Dauer in Sekunden, Distanz in
 * Metern. Neben den Typen leben hier die wenigen Laufzeit-Helfer, die sowohl
 * die Anbieter als auch der Einstiegspunkt brauchen - so bleibt das Paket ohne
 * zusaetzliche Datei und ohne Abhaengigkeit der Anbieter untereinander.
 */

import type { LatLng, RouteProfile } from '@/types/domain'

/** Ergebnis einer Streckenberechnung ueber alle uebergebenen Punkte. */
export interface RouteLeg {
  durationSec: number
  distanceM: number
  geometry: LatLng[]
}

/**
 * Reisezeit-/Distanzmatrix. Beide Felder sind quadratisch und nach
 * [von][nach] indiziert. Nicht erreichbare Paare stehen als Infinity drin.
 */
export interface TravelMatrix {
  /** Sekunden. */
  durations: number[][]
  /** Meter. */
  distances: number[][]
}

export type RoutingErrorKind = 'network' | 'limit' | 'no-route' | 'bad-request' | 'unknown'

/** Fehler eines Routing-Anbieters mit maschinenlesbarer Ursache. */
export class RoutingError extends Error {
  readonly kind: RoutingErrorKind
  /** HTTP-Status, sofern der Fehler aus einer Antwort stammt, sonst null. */
  readonly status: number | null

  constructor(
    kind: RoutingErrorKind,
    message: string,
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'RoutingError'
    this.kind = kind
    this.status = options.status ?? null
  }
}

export function isRoutingError(value: unknown): value is RoutingError {
  return value instanceof RoutingError
}

export interface RouteProvider {
  name: string
  supportsProfiles: readonly RouteProfile[]
  /** true, wenn das Profil echt unterschieden wird und nicht auf driving zurueckfaellt */
  profileIsDistinct(profile: RouteProfile): boolean
  route(points: LatLng[], profile: RouteProfile, signal?: AbortSignal): Promise<RouteLeg>
  matrix(points: LatLng[], profile: RouteProfile, signal?: AbortSignal): Promise<TravelMatrix>
}

/**
 * Liest eine Vite-Variable. Der Zugriff laeuft bewusst ueber einen Cast:
 * `import.meta.env` ist nur mit den Vite-Client-Typen bekannt, und in reinen
 * Node-Laeufen (Tests, Skripte) fehlt das Objekt ganz.
 */
export function readRoutingEnv(name: string): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env
  const value = env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

/** Ein Abbruch per AbortSignal ist kein Fehlerfall, sondern gewollt. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}
