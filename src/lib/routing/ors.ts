/**
 * OpenRouteService-Anbieter (https://openrouteservice.org/dev/#/api-docs).
 *
 * Braucht einen kostenlosen API-Schluessel, unterscheidet dafuer aber Auto-,
 * Rad- und Fussprofile wirklich. Wird nur benutzt, wenn VITE_ORS_API_KEY
 * gesetzt ist - siehe getRouteProvider() in ./index.
 */

import type { LatLng, RouteProfile } from '@/types/domain'
import { isValidLatLng } from '@/lib/geo'
import type { RouteLeg, RouteProvider, RoutingErrorKind, TravelMatrix } from './types'
import { RoutingError, isAbortError, readRoutingEnv } from './types'

export const ORS_BASE_URL = 'https://api.openrouteservice.org'

/** Grenze des kostenlosen Kontingents fuer Directions und Matrix. */
export const ORS_MAX_POINTS = 50

const ORS_PROFILE: Record<RouteProfile, string> = {
  driving: 'driving-car',
  cycling: 'cycling-regular',
  walking: 'foot-walking',
}

const ALL_PROFILES: readonly RouteProfile[] = ['driving', 'cycling', 'walking']

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** ORS erwartet Koordinatenpaare als [lng, lat], auf 6 Stellen gerundet. */
function toOrsCoordinate(point: LatLng): [number, number] {
  return [Number(point.lng.toFixed(6)), Number(point.lat.toFixed(6))]
}

function assertPoints(points: readonly LatLng[], minimum: number, context: string): void {
  if (points.length < minimum) {
    throw new RoutingError(
      'bad-request',
      `${context} werden mindestens ${minimum} gueltige Punkte benoetigt (uebergeben: ${points.length}).`,
    )
  }
  if (points.length > ORS_MAX_POINTS) {
    throw new RoutingError(
      'bad-request',
      `${context} sind bei OpenRouteService hoechstens ${ORS_MAX_POINTS} Punkte moeglich ` +
        `(uebergeben: ${points.length}). Bitte die Auswahl verkleinern.`,
    )
  }
  for (let i = 0; i < points.length; i++) {
    if (!isValidLatLng(points[i])) {
      throw new RoutingError('bad-request', `Punkt ${i + 1} hat keine gueltigen Koordinaten.`)
    }
  }
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function toRow(value: unknown, size: number): number[] {
  const row: unknown[] = Array.isArray(value) ? (value as unknown[]) : []
  const result: number[] = new Array<number>(size)
  for (let i = 0; i < size; i++) result[i] = toNumber(row[i])
  return result
}

/** Zieht die Fehlermeldung aus den beiden Formen, die ORS liefert. */
function extractOrsError(body: Record<string, unknown> | null): { code: number | null; message: string | null } {
  const raw = body?.error
  if (typeof raw === 'string') return { code: null, message: raw }
  if (raw && typeof raw === 'object') {
    const error = raw as Record<string, unknown>
    return {
      code: typeof error.code === 'number' ? error.code : null,
      message: typeof error.message === 'string' ? error.message : null,
    }
  }
  return { code: null, message: null }
}

const NO_ROUTE_CODES = new Set([2009, 2010, 6010, 6011])

function classifyOrsFailure(
  status: number,
  code: number | null,
  message: string | null,
): { kind: RoutingErrorKind; text: string } {
  const text = message ?? ''
  if (code !== null && NO_ROUTE_CODES.has(code)) {
    return { kind: 'no-route', text: 'Zwischen diesen Punkten laesst sich keine Strecke berechnen.' }
  }
  if (/route could not be found|not be found between|no route/i.test(text)) {
    return { kind: 'no-route', text: 'Zwischen diesen Punkten laesst sich keine Strecke berechnen.' }
  }
  if (status === 429 || /quota|rate limit|daily limit/i.test(text)) {
    return {
      kind: 'limit',
      text: 'Das Kontingent von OpenRouteService ist aufgebraucht. Bitte spaeter erneut versuchen.',
    }
  }
  if (status === 401 || status === 403) {
    return {
      kind: 'bad-request',
      text: 'OpenRouteService hat den API-Schluessel abgelehnt. Bitte VITE_ORS_API_KEY pruefen.',
    }
  }
  if (status >= 500) {
    return { kind: 'network', text: `OpenRouteService antwortet mit HTTP ${status}.` }
  }
  if (status >= 400) {
    return {
      kind: 'bad-request',
      text: message
        ? `OpenRouteService meldet: ${message}`
        : `OpenRouteService lehnt die Anfrage ab (HTTP ${status}).`,
    }
  }
  return {
    kind: 'unknown',
    text: message ? `OpenRouteService meldet: ${message}` : 'Unerwartete Antwort von OpenRouteService.',
  }
}

export class OrsProvider implements RouteProvider {
  readonly name = 'OpenRouteService'
  readonly supportsProfiles: readonly RouteProfile[] = ALL_PROFILES
  readonly baseUrl: string
  private readonly apiKey: string

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = (apiKey ?? readRoutingEnv('VITE_ORS_API_KEY')).trim()
    this.baseUrl = stripTrailingSlash(baseUrl?.trim() || ORS_BASE_URL)
  }

  /** ORS haelt fuer jedes Profil ein eigenes Strassennetz vor. */
  profileIsDistinct(): boolean {
    return true
  }

  async route(points: LatLng[], profile: RouteProfile, signal?: AbortSignal): Promise<RouteLeg> {
    assertPoints(points, 2, 'Fuer eine Strecke')
    const url = `${this.baseUrl}/v2/directions/${ORS_PROFILE[profile]}/geojson`
    const body = await this.request(
      url,
      { coordinates: points.map(toOrsCoordinate) },
      signal,
      'application/geo+json',
    )

    const features: unknown[] = Array.isArray(body.features) ? (body.features as unknown[]) : []
    const feature = features[0] as Record<string, unknown> | undefined
    if (!feature) {
      throw new RoutingError('no-route', 'Zwischen diesen Punkten laesst sich keine Strecke berechnen.')
    }

    const geometry = feature.geometry as Record<string, unknown> | undefined
    const coordinates: unknown[] = Array.isArray(geometry?.coordinates)
      ? (geometry.coordinates as unknown[])
      : []
    const properties = (feature.properties ?? {}) as Record<string, unknown>
    const summary = (properties.summary ?? {}) as Record<string, unknown>

    return {
      durationSec: toNumber(summary.duration),
      distanceM: toNumber(summary.distance),
      geometry: coordinates.reduce<LatLng[]>((acc, entry) => {
        if (Array.isArray(entry) && typeof entry[0] === 'number' && typeof entry[1] === 'number') {
          acc.push({ lat: entry[1], lng: entry[0] })
        }
        return acc
      }, []),
    }
  }

  async matrix(points: LatLng[], profile: RouteProfile, signal?: AbortSignal): Promise<TravelMatrix> {
    if (points.length === 1 && isValidLatLng(points[0])) {
      return { durations: [[0]], distances: [[0]] }
    }
    assertPoints(points, 2, 'Fuer eine Reisezeit-Matrix')
    const url = `${this.baseUrl}/v2/matrix/${ORS_PROFILE[profile]}`
    const body = await this.request(
      url,
      {
        locations: points.map(toOrsCoordinate),
        metrics: ['duration', 'distance'],
        units: 'm',
      },
      signal,
      'application/json',
    )

    const rawDurations = Array.isArray(body.durations) ? (body.durations as unknown[]) : null
    const rawDistances = Array.isArray(body.distances) ? (body.distances as unknown[]) : null
    if (!rawDurations || !rawDistances) {
      throw new RoutingError(
        'unknown',
        'Die Antwort von OpenRouteService enthaelt keine vollstaendige Reisezeit-Matrix.',
      )
    }
    const size = points.length
    return {
      durations: Array.from({ length: size }, (_unused, i) => toRow(rawDurations[i], size)),
      distances: Array.from({ length: size }, (_unused, i) => toRow(rawDistances[i], size)),
    }
  }

  private async request(
    url: string,
    payload: unknown,
    signal: AbortSignal | undefined,
    accept: string,
  ): Promise<Record<string, unknown>> {
    if (!this.apiKey) {
      throw new RoutingError(
        'bad-request',
        'Es ist kein OpenRouteService-Schluessel hinterlegt. Bitte VITE_ORS_API_KEY setzen.',
      )
    }

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        signal,
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
          Accept: accept,
        },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      if (isAbortError(error)) throw error
      throw new RoutingError(
        'network',
        'OpenRouteService ist nicht erreichbar. Bitte die Internetverbindung pruefen.',
        { cause: error },
      )
    }

    let body: Record<string, unknown> | null = null
    try {
      const parsed: unknown = await response.json()
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
    } catch {
      body = null
    }

    const failure = extractOrsError(body)
    if (!response.ok || failure.message !== null || failure.code !== null) {
      const { kind, text } = classifyOrsFailure(response.status, failure.code, failure.message)
      throw new RoutingError(kind, text, { status: response.status })
    }

    if (!body) {
      throw new RoutingError('unknown', 'Die Antwort von OpenRouteService ist nicht lesbar.')
    }
    return body
  }
}
