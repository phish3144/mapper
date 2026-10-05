/**
 * Fahrzeit und Fahrstrecke von einem Punkt zu mehreren Zielen.
 *
 * Gemeinsam fuer die Umgebungsliste und die Zielwahl: beide zeigten frueher
 * die Luftlinie als die Entfernung, und die lag im Mittel ein Drittel unter
 * der Strecke, die man tatsaechlich faehrt - bei 16 von 64 nachgemessenen
 * Paaren um mehr als 50 km. Eine Vorschlagsliste, die nach Luftlinie
 * sortiert, schlaegt deshalb oft nicht den Standort vor, der am schnellsten
 * zu erreichen ist.
 *
 * Bleibt der Routendienst stumm, liefert der Haken `null`. Die Aufrufer
 * fallen dann auf die Luftlinie zurueck und sagen das auch.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { getRouteProvider } from '@/lib/routing'
import type { LatLng } from '@/types/domain'

export interface TravelTarget {
  id: string
  lat: number
  lng: number
}

export type TravelStatus = 'idle' | 'loading' | 'ready' | 'failed'

/** Je Ziel in derselben Reihenfolge wie `targets`. */
export interface TravelArrays {
  durations: number[]
  distances: number[]
}

interface Stand {
  key: string
  status: TravelStatus
  travel: TravelArrays | null
}

export function useTravelFrom(
  origin: LatLng,
  targets: readonly TravelTarget[],
): { status: TravelStatus; travel: TravelArrays | null } {
  /**
   * Schluessel der Anfrage. Er nennt Kennung UND Koordinaten jedes Ziels:
   * verschobene Standorte muessen neu gerechnet werden, blosses Neurendern
   * nicht. Ausserdem haelt er spaete Antworten fern - sonst stuenden Zeiten
   * einer frueheren Liste bei den falschen Standorten.
   */
  const key = useMemo(
    () =>
      [
        `start@${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`,
        ...targets.map((t) => `${t.id}@${t.lat.toFixed(6)},${t.lng.toFixed(6)}`),
      ].join('|'),
    [origin, targets],
  )

  // Der Effekt haengt allein am Schluessel; die Punkte kommen ueber die Ref.
  // Ein Array in den Abhaengigkeiten waere bei jedem Rendern neu und wuerde
  // die Anfrage endlos wiederholen.
  const pointsRef = useRef<LatLng[]>([])
  useEffect(() => {
    pointsRef.current = [origin, ...targets.map((t) => ({ lat: t.lat, lng: t.lng }))]
  }, [origin, targets])

  const [stand, setStand] = useState<Stand>({ key: '', status: 'idle', travel: null })

  useEffect(() => {
    const points = pointsRef.current
    // Nur der Startpunkt selbst - dafuer gibt es nichts zu rechnen.
    if (points.length < 2) {
      setStand({ key, status: 'idle', travel: null })
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setStand({ key, status: 'loading', travel: null })

    void (async () => {
      try {
        const matrix = await getRouteProvider().matrix(points, 'driving', controller.signal)
        if (cancelled) return
        // Zeile 0 ist der Weg vom Start zu den Zielen; Spalte 0 ist er selbst.
        setStand({
          key,
          status: 'ready',
          travel: {
            durations: matrix.durations[0]?.slice(1) ?? [],
            distances: matrix.distances[0]?.slice(1) ?? [],
          },
        })
      } catch {
        if (cancelled || controller.signal.aborted) return
        // Kein reportError: die Luftlinie beantwortet die Frage notduerftig,
        // ein Fehlerbanner waere hier lauter als der Verlust an Genauigkeit.
        setStand({ key, status: 'failed', travel: null })
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [key])

  // Solange der Stand zu einer anderen Liste gehoert, wird gerade gerechnet.
  if (stand.key !== key) return { status: targets.length > 0 ? 'loading' : 'idle', travel: null }
  return { status: stand.status, travel: stand.travel }
}
