import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, locationById } from '@/lib/store'
import * as db from '@/lib/db'
import { getRouteProvider, haversineMatrix } from '@/lib/routing'
import type { TravelMatrix } from '@/lib/routing/types'
import { isRoutingError } from '@/lib/routing/types'
import { computeSchedule, optimizeOrder } from '@/lib/planner'
import type { PlanOptions, PlanStopInput, Schedule } from '@/lib/planner'
import type { LatLng, MapLocation, Route, RouteStop } from '@/types/domain'

export interface RoutePlan {
  /** Stopps in aktueller Reihenfolge, jeweils mit aufgeloestem Standort. */
  entries: { stop: RouteStop; location: MapLocation }[]
  schedule: Schedule | null
  geometry: LatLng[] | null
  matrix: TravelMatrix | null
  /** true, solange Matrix oder Geometrie geladen werden. */
  loading: boolean
  error: string | null
  /** true, wenn die Fahrzeiten mangels Routing-Antwort nur geschaetzt sind. */
  estimated: boolean
  optimize: () => Promise<void>
  optimizing: boolean
  /** Gewinn der letzten Optimierung, damit er benannt werden kann. */
  lastGain: { seconds: number; violationsBefore: number; violationsAfter: number } | null
}

function buildOptions(route: Route, entries: { stop: RouteStop }[]): PlanOptions {
  const indexOfLocation = (locId: string | null): number | null => {
    if (!locId) return null
    const i = entries.findIndex((e) => e.stop.location_id === locId)
    return i >= 0 ? i : null
  }
  return {
    departAt: route.depart_at ? new Date(route.depart_at) : null,
    fixedStartIndex: indexOfLocation(route.start_location_id),
    fixedEndIndex: indexOfLocation(route.end_location_id),
    roundtrip: route.roundtrip,
  }
}

/**
 * Fuehrt Stopps, Reisezeitmatrix und Fahrplan zusammen.
 *
 * Die Matrix kostet einen Netzwerkaufruf und aendert sich nur, wenn sich die
 * MENGE der Stopps oder das Profil aendert - nicht bei blossem Umsortieren.
 * Deshalb haengt ihr Effekt an einem Schluessel aus sortierten Koordinaten:
 * Ziehen und Ablegen rechnet dann sofort neu, ohne erneut zu laden.
 */
export function useRoutePlan(routeId: string | null): RoutePlan {
  const routes = useStore((s) => s.routes)
  const locations = useStore((s) => s.locations)
  const stopsByRoute = useStore((s) => s.stopsByRoute)
  const loadStops = useStore((s) => s.loadStops)
  const reportError = useStore((s) => s.reportError)

  const route = useMemo(() => routes.find((r) => r.id === routeId) ?? null, [routes, routeId])
  const locIndex = useMemo(() => locationById(locations), [locations])

  const entries = useMemo(() => {
    if (!routeId) return []
    const stops = stopsByRoute[routeId] ?? []
    const out: { stop: RouteStop; location: MapLocation }[] = []
    for (const stop of [...stops].sort((a, b) => a.position - b.position)) {
      const location = locIndex.get(stop.location_id)
      // Ein Stopp ohne sichtbaren Standort kommt vor: die Sichtbarkeit des
      // Standorts kann enger sein als die der Route.
      if (location) out.push({ stop, location })
    }
    return out
  }, [routeId, stopsByRoute, locIndex])

  const [matrix, setMatrix] = useState<TravelMatrix | null>(null)
  const [geometry, setGeometry] = useState<LatLng[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estimated, setEstimated] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [lastGain, setLastGain] = useState<RoutePlan['lastGain']>(null)

  const profile = route?.profile ?? 'driving'
  // Schluessel ueber die MENGE der Stopps: Umsortieren darf keinen neuen
  // Netzwerkaufruf ausloesen, ein hinzugefuegter Stopp schon.
  const matrixKey = useMemo(
    () =>
      entries
        .map((e) => `${e.location.lat.toFixed(5)},${e.location.lng.toFixed(5)}`)
        .sort()
        .join(';') + `|${profile}`,
    [entries, profile],
  )
  // Fuer die Geometrie zaehlt die Reihenfolge sehr wohl.
  const geometryKey = useMemo(
    () =>
      entries.map((e) => `${e.location.lat.toFixed(5)},${e.location.lng.toFixed(5)}`).join(';') +
      `|${profile}|${route?.roundtrip ? 'r' : 'o'}`,
    [entries, profile, route?.roundtrip],
  )

  const pointsRef = useRef<LatLng[]>([])
  pointsRef.current = entries.map((e) => ({ lat: e.location.lat, lng: e.location.lng }))

  useEffect(() => {
    const points = pointsRef.current
    if (points.length < 2) {
      setMatrix(null)
      setEstimated(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const result = await getRouteProvider().matrix(points, profile, controller.signal)
        if (!cancelled) {
          setMatrix(result)
          setEstimated(false)
        }
      } catch (e) {
        if (cancelled || controller.signal.aborted) return
        // Ohne Matrix waere die Planung tot. Eine Luftlinienschaetzung ist
        // schlechter als echte Fahrzeiten, aber weit besser als nichts -
        // sie wird in der Oberflaeche als Schaetzung ausgewiesen.
        setMatrix(haversineMatrix(points))
        setEstimated(true)
        setError(
          isRoutingError(e) && e.kind === 'limit'
            ? 'Der Routing-Dienst ist ausgelastet. Die Zeiten sind vorerst geschaetzt.'
            : 'Der Routing-Dienst ist nicht erreichbar. Die Zeiten sind geschaetzt (Luftlinie).',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [matrixKey, profile])

  useEffect(() => {
    const points = pointsRef.current
    if (points.length < 2) {
      setGeometry(null)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    const full = route?.roundtrip ? [...points, points[0]] : points
    void (async () => {
      try {
        const leg = await getRouteProvider().route(full, profile, controller.signal)
        if (!cancelled) setGeometry(leg.geometry)
      } catch {
        // Die gezeichnete Linie ist Beiwerk; scheitert sie, faellt die Karte
        // auf die direkte Verbindung zurueck.
        if (!cancelled) setGeometry(full)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [geometryKey, profile, route?.roundtrip])

  const planStops = useMemo<PlanStopInput[]>(
    () =>
      entries.map((e) => ({
        locationId: e.location.id,
        point: { lat: e.location.lat, lng: e.location.lng },
        serviceMinutes:
          e.stop.service_minutes_override ??
          (e.location.service_minutes || route?.default_service_minutes || 0),
        timeWindows: e.location.time_windows,
      })),
    [entries, route?.default_service_minutes],
  )

  const schedule = useMemo(() => {
    if (!route || !matrix || planStops.length === 0) return null
    const options = buildOptions(route, entries)
    return computeSchedule(
      planStops.map((_, i) => i),
      planStops,
      matrix,
      options,
    )
  }, [route, matrix, planStops, entries])

  const optimize = useCallback(async () => {
    if (!route || !matrix || planStops.length < 3) return
    setOptimizing(true)
    try {
      const options = buildOptions(route, entries)
      const result = optimizeOrder(planStops, matrix, options)
      const orderedIds = result.order.map((i) => entries[i].stop.id)
      await db.reorderRouteStops(route.id, orderedIds)
      await loadStops(route.id)
      setLastGain({
        seconds: Math.max(
          0,
          result.improvedFrom.totalTravelSec +
            result.improvedFrom.totalWaitMinutes * 60 -
            (result.schedule.totalTravelSec + result.schedule.totalWaitMinutes * 60),
        ),
        violationsBefore: result.improvedFrom.violations,
        violationsAfter: result.schedule.violations,
      })
    } catch (e) {
      reportError(e)
    } finally {
      setOptimizing(false)
    }
  }, [route, matrix, planStops, entries, loadStops, reportError])

  return {
    entries,
    schedule,
    geometry,
    matrix,
    loading,
    error,
    estimated,
    optimize,
    optimizing,
    lastGain,
  }
}
