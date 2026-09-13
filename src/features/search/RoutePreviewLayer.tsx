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
import { Polyline, Tooltip } from 'react-leaflet'
import { formatDistance, formatDuration } from '@/lib/format'
import { useUi } from '@/lib/uiStore'
import { useRouteLeg } from './useRouteLeg'

/** Wie die Suchnadel: rot heisst hier "gehoert zur Suche", nicht "Fehler". */
const PREVIEW_COLOR = '#dc2626'

export default function RoutePreviewLayer() {
  const preview = useUi((s) => s.routePreview)
  // Dieselbe Strecke, die auch die Ergebnisleiste zeigt - ein Abruf fuer beide.
  const leg = useRouteLeg(preview?.from ?? null, preview?.to ?? null)

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
          {leg.estimated && <span> (geschätzt)</span>}
        </Tooltip>
      </Polyline>
    </>
  )
}
