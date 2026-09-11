/**
 * Die Zielwahl fuer eine Strecke, die an einem Kartenpunkt beginnt.
 *
 * Ausgeloest wird sie in der Sprechblase eines Standorts, gezeichnet wird sie
 * hier - auf Ebene der Anwendung und nicht in der Sprechblase. Der Grund ist
 * handfest: die Karte liegt in einem eigenen Stapelkontext (isolation), und
 * der Inhalt der Sprechblase haengt zusaetzlich in einem Leaflet-Element mit
 * eigener Groesse. Ein Dialog darin waere abgeschnitten und laege unter der
 * Karte.
 *
 * Der Startpunkt steht im Oberflaechenzustand. Die Sprechblase setzt ihn und
 * ist danach nicht mehr beteiligt - sie darf sich sogar schliessen.
 */
import { Modal } from '@/components/ui'
import { useUi } from '@/lib/uiStore'
import RouteTargetPicker from './RouteTargetPicker'

export default function RouteFromDialog() {
  const origin = useUi((s) => s.routeOrigin)
  const setRouteOrigin = useUi((s) => s.setRouteOrigin)
  const starteRoute = useUi((s) => s.starteRoute)

  if (!origin) return null

  return (
    <Modal flush title={`Route von ${origin.label}`} width={420} onClose={() => setRouteOrigin(null)}>
      <RouteTargetPicker
        embedded
        origin={origin.point}
        excludeId={origin.locationId}
        onCancel={() => setRouteOrigin(null)}
        onPick={(ziel) =>
          starteRoute({
            from: origin.point,
            fromLabel: origin.label,
            to: ziel.point,
            toLabel: ziel.label,
            locationId: ziel.locationId,
            // Diese Strecke beginnt an einem Kartenpunkt, nicht an der Suche:
            // sie darf nicht verschwinden, wenn jemand das Suchfeld leert.
          })
        }
      />
    </Modal>
  )
}
