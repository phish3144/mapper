/**
 * OSRM-Anbieter (http://project-osrm.org/docs/v5.24.0/api/).
 *
 * Der oeffentliche Demoserver laeuft nachweislich nur mit dem Auto-Profil:
 * `bike` und `foot` liefern dort exakt dieselben Dauern und Distanzen wie
 * `driving`. Das bildet profileIsDistinct() ehrlich ab, damit die Oberflaeche
 * darauf hinweisen kann, statt eine Genauigkeit vorzutaeuschen.
 */

import type { LatLng, RouteProfile } from '@/types/domain'
import { isValidLatLng } from '@/lib/geo'
import type { RouteLeg, RouteProvider, RoutingErrorKind, TravelMatrix } from './types'
import { RoutingError, isAbortError, readRoutingEnv } from './types'
import { decodePolyline } from './polyline'

export const OSRM_PUBLIC_DEMO_URL = 'https://router.project-osrm.org'

/** Ab dieser Punktzahl wird die URL zu lang - der Server antwortet dann mit 414. */
export const OSRM_MAX_POINTS = 100

const OSRM_PROFILE: Record<RouteProfile, string> = {
  driving: 'driving',
  cycling: 'bike',
  walking: 'foot',
}

const ALL_PROFILES: readonly RouteProfile[] = ['driving', 'cycling', 'walking']

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Erkennt den oeffentlichen Demoserver, auch hinter www- oder Subdomains. */
function isPublicDemoUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'project-osrm.org' || host.endsWith('.project-osrm.org')
  } catch {
    return baseUrl.toLowerCase().includes('project-osrm.org')
  }
}

/** OSRM erwartet "lng,lat", getrennt durch Semikolon, hier auf 6 Stellen gerundet. */
function formatCoordinate(point: LatLng): string {
  const round6 = (value: number): string => String(Number(value.toFixed(6)))
  return `${round6(point.lng)},${round6(point.lat)}`
}

function joinCoordinates(points: readonly LatLng[]): string {
  return points.map(formatCoordinate).join(';')
}

function assertPoints(points: readonly LatLng[], minimum: number, context: string): void {
  if (points.length < minimum) {
    throw new RoutingError(
      'bad-request',
      `${context} werden mindestens ${minimum} gueltige Punkte benoetigt (uebergeben: ${points.length}).`,
    )
  }
  if (points.length > OSRM_MAX_POINTS) {
    throw new RoutingError(
      'bad-request',
      `${context} sind hoechstens ${OSRM_MAX_POINTS} Punkte moeglich (uebergeben: ${points.length}). ` +
        'Die Anfrage wird sonst zu lang. Bitte die Auswahl verkleinern.',
    )
  }
  for (let i = 0; i < points.length; i++) {
    if (!isValidLatLng(points[i])) {
      throw new RoutingError('bad-request', `Punkt ${i + 1} hat keine gueltigen Koordinaten.`)
    }
  }
}

function kindForStatus(status: number): RoutingErrorKind {
  if (status === 429) return 'limit'
  if (status >= 500) return 'network'
  if (status >= 400) return 'bad-request'
  return 'unknown'
}

/** Die Statuscodes der OSRM-Antwort (Feld `code`). */
function kindForOsrmCode(code: string): RoutingErrorKind {
  switch (code) {
    case 'NoRoute':
    case 'NoSegment':
    case 'NoTrips':
    case 'NoMatch':
    case 'NoTable':
      return 'no-route'
    case 'TooBig':
    case 'InvalidUrl':
    case 'InvalidService':
    case 'InvalidVersion':
    case 'InvalidOptions':
    case 'InvalidQuery':
    case 'InvalidValue':
      return 'bad-request'
    default:
      return 'unknown'
  }
}

function messageForOsrmCode(code: string, serverMessage: string | null): string {
  switch (code) {
    case 'NoRoute':
      return 'Zwischen diesen Punkten laesst sich keine Strecke berechnen.'
    case 'NoSegment':
      return 'Mindestens ein Punkt liegt zu weit von einer befahrbaren Strasse entfernt.'
    case 'NoTable':
      return 'Der Routing-Dienst konnte die Reisezeit-Matrix nicht berechnen.'
    case 'TooBig':
      return 'Die Anfrage ist dem Routing-Dienst zu gross. Bitte weniger Punkte waehlen.'
    default:
      return serverMessage
        ? `Der Routing-Dienst meldet: ${serverMessage}`
        : `Der Routing-Dienst meldet den Fehler "${code}".`
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

export class OsrmProvider implements RouteProvider {
  readonly baseUrl: string
  readonly isPublicDemo: boolean
  readonly id: string
  readonly name: string
  readonly supportsProfiles: readonly RouteProfile[] = ALL_PROFILES

  constructor(baseUrl?: string) {
    const configured = baseUrl?.trim() || readRoutingEnv('VITE_OSRM_BASE_URL') || OSRM_PUBLIC_DEMO_URL
    this.baseUrl = stripTrailingSlash(configured)
    this.isPublicDemo = isPublicDemoUrl(this.baseUrl)
    this.id = `osrm|${this.baseUrl}`
    this.name = this.isPublicDemo ? 'OSRM (Demoserver)' : 'OSRM'
  }

  /**
   * Auf dem Demoserver ist nur das Auto-Profil geladen; Rad und Fuss liefern
   * dort dieselben Werte. Eine eigene Instanz kann alle Profile fahren.
   */
  profileIsDistinct(profile: RouteProfile): boolean {
    if (!this.isPublicDemo) return true
    return profile === 'driving'
  }

  async route(points: LatLng[], profile: RouteProfile, signal?: AbortSignal): Promise<RouteLeg> {
    assertPoints(points, 2, 'Fuer eine Strecke')
    const url =
      `${this.baseUrl}/route/v1/${OSRM_PROFILE[profile]}/${joinCoordinates(points)}` +
      '?overview=full&geometries=polyline&steps=false&alternatives=false'
    const body = await this.request(url, signal)

    const routes: unknown[] = Array.isArray(body.routes) ? (body.routes as unknown[]) : []
    const first = routes[0] as Record<string, unknown> | undefined
    if (!first) {
      throw new RoutingError('no-route', 'Zwischen diesen Punkten laesst sich keine Strecke berechnen.')
    }
    const geometry: unknown = first.geometry
    if (typeof geometry !== 'string') {
      throw new RoutingError('unknown', 'Die Antwort des Routing-Dienstes enthaelt keine Geometrie.')
    }

    return {
      durationSec: toNumber(first.duration),
      distanceM: toNumber(first.distance),
      // overview=full liefert die Geometrie als Polyline mit Praezision 5.
      geometry: decodePolyline(geometry, 5),
    }
  }

  async matrix(points: LatLng[], profile: RouteProfile, signal?: AbortSignal): Promise<TravelMatrix> {
    if (points.length === 1) {
      assertPoints(points, 1, 'Fuer eine Reisezeit-Matrix')
      return { durations: [[0]], distances: [[0]] }
    }
    assertPoints(points, 2, 'Fuer eine Reisezeit-Matrix')
    const url =
      `${this.baseUrl}/table/v1/${OSRM_PROFILE[profile]}/${joinCoordinates(points)}` +
      '?annotations=duration,distance'
    const body = await this.request(url, signal)

    const rawDurations = Array.isArray(body.durations) ? (body.durations as unknown[]) : null
    const rawDistances = Array.isArray(body.distances) ? (body.distances as unknown[]) : null
    if (!rawDurations || !rawDistances) {
      throw new RoutingError(
        'unknown',
        'Die Antwort des Routing-Dienstes enthaelt keine vollstaendige Reisezeit-Matrix.',
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
    signal: AbortSignal | undefined,
  ): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    } catch (error) {
      if (isAbortError(error)) throw error
      throw new RoutingError(
        'network',
        `Der Routing-Dienst (${this.baseUrl}) ist nicht erreichbar. Bitte die Internetverbindung pruefen.`,
        { cause: error },
      )
    }

    if (response.status === 429) {
      throw new RoutingError(
        'limit',
        'Der Routing-Dienst hat das Anfragelimit erreicht. Bitte einen Moment warten und es erneut versuchen.',
        { status: 429 },
      )
    }

    let body: Record<string, unknown> | null = null
    try {
      const parsed: unknown = await response.json()
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
    } catch {
      body = null
    }

    const code = typeof body?.code === 'string' ? body.code : null
    if (code !== null && code !== 'Ok') {
      const serverMessage = typeof body?.message === 'string' ? body.message : null
      throw new RoutingError(kindForOsrmCode(code), messageForOsrmCode(code, serverMessage), {
        status: response.status,
      })
    }

    if (!response.ok) {
      throw new RoutingError(
        kindForStatus(response.status),
        `Der Routing-Dienst antwortet mit HTTP ${response.status}.`,
        { status: response.status },
      )
    }

    if (!body) {
      throw new RoutingError('unknown', 'Die Antwort des Routing-Dienstes ist nicht lesbar.')
    }
    return body
  }
}
