/**
 * Die Strecke von der gesuchten Adresse zu einem vorgeschlagenen Standort.
 *
 * Bewusst eine eigene Ebene neben RouteLayer und bewusst fluechtig: sie
 * beantwortet nur "wie weit ist das von hier?". Es entsteht dabei kein
 * Standort, kein Stopp und keine Tour - wer die Suche aufhebt, ist sie los.
 *
 * Gestrichelt und in der Farbe der Suchnadel, damit sie nicht mit der
 * durchgezogenen blauen Tourenlinie verwechselt wird. Die beiden koennen
 * gleichzeitig auf der Karte liegen.
 */
import { useEffect, useState } from 'react'
import { Polyline, Tooltip } from 'react-leaflet'
import { getRouteProvider } from '@/lib/routing'
import { formatDistance, formatDuration } from '@/lib/format'
import { haversineKm } from '@/lib/geo'
import { useUi } from '@/lib/uiStore'
import type { LatLng } from '@/types/domain'

/** Wie die Suchnadel: rot heisst hier "gehoert zur Suche", nicht "Fehler". */
const PREVIEW_COLOR = '#dc2626'

interface Leg {
  geometry: LatLng[]
  meters: number
  seconds: number
  /** true, wenn kein Routing-Dienst antwortete und die Luftlinie einspringt. */
  estimated: boolean
}

export default function RoutePreviewLayer() {
  const preview = useUi((s) => s.routePreview)
  const [leg, setLeg] = useState<Leg | null>(null)

  const from = preview?.from ?? null
  const to = preview?.to ?? null
  // Ueber die Koordinaten und nicht ueber das Objekt: sonst laedt jede neue
  // Objektkennung dieselbe Strecke erneut.
  const key = from && to ? `${from.lat},${from.lng}|${to.lat},${to.lng}` : ''

  useEffect(() => {
    if (!from || !to) {
      setLeg(null)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    // Sofort die Luftlinie zeigen, damit die Antwort auf den Klick nicht auf
    // den Routing-Dienst wartet. Die echte Strecke ersetzt sie, sobald sie da
    // ist - das ist der Unterschied zwischen "reagiert" und "haengt".
    setLeg({ geometry: [from, to], meters: haversineKm(from, to) * 1000, seconds: 0, estimated: true })

    void (async () => {
      try {
        const result = await getRouteProvider().route([from, to], 'driving', controller.signal)
        if (cancelled) return
        setLeg({
          geometry: result.geometry.length > 1 ? result.geometry : [from, to],
          meters: result.distanceM,
          seconds: result.durationSec,
          estimated: false,
        })
      } catch {
        // Die Luftlinie steht schon; mehr ist ohne Dienst nicht zu holen.
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!preview || !leg) return null

  const positions = leg.geometry.map((p) => [p.lat, p.lng] as [number, number])
  const text = leg.estimated
    ? `${formatDistance(leg.meters)} Luftlinie`
    : `${formatDistance(leg.meters)} · ${formatDuration(leg.seconds)}`

  return (
    <>
      {/* Dunkle Unterlage: die rote Linie allein verschwindet auf Waldgruen. */}
      <Polyline positions={positions} pathOptions={{ color: '#000', weight: 7, opacity: 0.2 }} />
      <Polyline
        positions={positions}
        pathOptions={{ color: PREVIEW_COLOR, weight: 4, opacity: 0.95, dashArray: '8 6' }}
      >
        <Tooltip sticky>
          <strong>{preview.toLabel}</strong>
          <br />
          {text}
          {leg.estimated && <span> (geschaetzt)</span>}
        </Tooltip>
      </Polyline>
    </>
  )
}
