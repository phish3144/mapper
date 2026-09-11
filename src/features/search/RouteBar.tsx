/**
 * Die Leiste zur gezeigten Strecke: von wo, wohin, wie weit, wie lange.
 *
 * Sie sitzt ueber der Karte und nicht in der Seitenleiste, weil sie zu der
 * Linie gehoert, die dort liegt. Wer sie sieht, sieht auch die Strecke.
 *
 * Was hier NICHT passiert: speichern. Die Strecke ist eine Auskunft, keine
 * Tour. Wer sie behalten will, nimmt den Standort in eine Tour auf - dafuer
 * gibt es die Stoppliste.
 */
import { Button, Spinner } from '@/components/ui'
import { formatDistance, formatDuration } from '@/lib/format'
import { useUi } from '@/lib/uiStore'
import { navigationUrl } from '@/lib/navigation'
import { useRouteLeg } from './useRouteLeg'

export default function RouteBar() {
  const preview = useUi((s) => s.routePreview)
  const setRoutePreview = useUi((s) => s.setRoutePreview)
  const starteRoute = useUi((s) => s.starteRoute)
  const leg = useRouteLeg(preview?.from ?? null, preview?.to ?? null)

  if (!preview) return null

  function tauschen(): void {
    if (!preview) return
    // Hin und zurueck sind nicht dasselbe: Einbahnstrassen, Auffahrten,
    // gesperrte Abbiegungen. Deshalb wirklich neu rechnen lassen und nicht
    // die vorhandene Linie umdrehen.
    starteRoute({
      from: preview.to,
      fromLabel: preview.toLabel,
      to: preview.from,
      toLabel: preview.fromLabel,
      locationId: null,
      belongsToSearch: preview.belongsToSearch,
    })
  }

  return (
    <div className="route-bar panel">
      <div className="route-bar-text">
        <div className="row small" style={{ gap: 6, flexWrap: 'nowrap', minWidth: 0 }}>
          <span className="truncate" title={preview.fromLabel}>
            {preview.fromLabel}
          </span>
          <span aria-hidden="true" className="faint">
            →
          </span>
          <span className="truncate" style={{ fontWeight: 600 }} title={preview.toLabel}>
            {preview.toLabel}
          </span>
        </div>
        <div className="small muted">
          {leg === null ? (
            <span className="row" style={{ gap: 6 }}>
              <Spinner /> Strecke wird berechnet …
            </span>
          ) : leg.estimated ? (
            /* Ehrlich benennen: eine Luftlinie ist keine Fahrstrecke, und der
               Unterschied ist in der Praxis schnell ein Drittel. */
            `${formatDistance(leg.meters)} Luftlinie · Fahrzeit unbekannt`
          ) : (
            `${formatDistance(leg.meters)} · ${formatDuration(leg.seconds)} mit dem Auto`
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 4, flex: '0 0 auto' }}>
        <Button size="sm" title="Start und Ziel vertauschen" onClick={tauschen}>
          ⇄
        </Button>
        <a
          className="btn btn-sm"
          href={navigationUrl(preview.from, preview.to)}
          target="_blank"
          rel="noreferrer"
          title="Strecke in einer Navigations-App oeffnen"
        >
          Navigation
        </a>
        <Button size="sm" variant="ghost" title="Strecke ausblenden" onClick={() => setRoutePreview(null)}>
          ✕
        </Button>
      </div>
    </div>
  )
}
