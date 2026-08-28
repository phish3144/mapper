import { Marker, Polyline } from 'react-leaflet'
import { useUi } from '@/lib/uiStore'
import { createStopIcon } from '@/features/map/markerIcons'
import { useRoutePlan } from './useRoutePlan'

/**
 * Zeichnet die aktive Route auf die Karte: Streckenlinie und nummerierte
 * Stoppnadeln. Sitzt bewusst hier und nicht in MarkerLayer — die Route ist
 * eine eigene Ebene ueber den Standorten.
 */
export default function RouteLayer() {
  const activeRouteId = useUi((s) => s.activeRouteId)
  const selectLocation = useUi((s) => s.selectLocation)
  const plan = useRoutePlan(activeRouteId)

  if (!activeRouteId || plan.entries.length === 0) return null

  const violationByIndex = new Map<number, boolean>()
  if (plan.schedule) {
    for (const s of plan.schedule.stops) violationByIndex.set(s.index, s.violation !== 'none')
  }

  return (
    <>
      {plan.geometry && plan.geometry.length > 1 && (
        <>
          {/* Zwei Linien uebereinander: die breite dunkle darunter gibt der
              farbigen Linie auf hellen wie dunklen Kacheln genug Kontrast. */}
          <Polyline
            positions={plan.geometry.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: '#000', weight: 7, opacity: 0.25 }}
          />
          <Polyline
            positions={plan.geometry.map((p) => [p.lat, p.lng])}
            pathOptions={{
              color: '#2563eb',
              weight: 4,
              opacity: 0.9,
              dashArray: plan.estimated ? '6 6' : undefined,
            }}
          />
        </>
      )}
      {plan.entries.map((entry, i) => (
        <Marker
          key={entry.stop.id}
          position={[entry.location.lat, entry.location.lng]}
          icon={createStopIcon(i + 1, violationByIndex.get(i) === true)}
          zIndexOffset={1000}
          eventHandlers={{ click: () => selectLocation(entry.location.id) }}
        />
      ))}
    </>
  )
}
