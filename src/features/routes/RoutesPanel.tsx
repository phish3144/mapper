import { useMemo, useState } from 'react'
import { Badge, Button, EmptyState } from '@/components/ui'
import { useStore, useCanEdit } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import * as db from '@/lib/db'
import { pluralize } from '@/lib/format'
import RouteEditor from './RouteEditor'
import QuickTourPanel from './QuickTourPanel'

export default function RoutesPanel() {
  const routes = useStore((s) => s.routes)
  const stopsByRoute = useStore((s) => s.stopsByRoute)
  const currentWorkspaceId = useStore((s) => s.currentWorkspaceId)
  const refreshRoutes = useStore((s) => s.refreshRoutes)
  const reportError = useStore((s) => s.reportError)
  const canEdit = useCanEdit()
  const activeRouteId = useUi((s) => s.activeRouteId)
  const setActiveRoute = useUi((s) => s.setActiveRoute)

  const [busy, setBusy] = useState(false)

  const active = useMemo(
    () => routes.find((r) => r.id === activeRouteId) ?? null,
    [routes, activeRouteId],
  )

  /**
   * Legt eine leere Route an und geht direkt hinein. Frueher stand hier ein
   * Fenster, das nach Name und Zusammenstellung fragte - beides ist im Editor
   * ohnehin da (der Name als Feld in der Kopfzeile, die Zusammenstellung unter
   * "Einstellungen"). Das Fenster hat also nur gefragt, was man gleich danach
   * wieder vor sich hatte.
   */
  async function createEmpty() {
    if (!currentWorkspaceId) return
    setBusy(true)
    try {
      const route = await db.createRoute(currentWorkspaceId, {
        name: 'Neue Route',
        mode: 'manual',
        rule: {},
      })
      await refreshRoutes()
      setActiveRoute(route.id)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }

  const liste = (
    <>
      <div className="sidebar-head">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <h2>{pluralize(routes.length, 'Route', 'Routen')}</h2>
          {canEdit && (
            <Button size="sm" busy={busy} onClick={() => void createEmpty()}>
              Leere Route
            </Button>
          )}
        </div>
      </div>

      <div className="sidebar-scroll">
        {routes.length === 0 ? (
          <EmptyState>
            Noch keine Routen.
            {canEdit ? (
              <>
                <br />
                Adressen oben einfuegen — die Reihenfolge wird berechnet.
                <br />
                <span className="faint">
                  Von Hand geht es auch: „Leere Route", dann Stopps aus dem Bestand oder aus einer Regel.
                </span>
              </>
            ) : null}
          </EmptyState>
        ) : (
          <div className="list">
            {routes.map((r) => {
              const count = stopsByRoute[r.id]?.length
              return (
                <div
                  key={r.id}
                  className="list-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveRoute(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setActiveRoute(r.id)
                    }
                  }}
                >
                  <div className="list-item-main">
                    <div className="list-item-title">{r.name}</div>
                    <div className="list-item-sub">
                      {count === undefined
                        ? 'Stopps werden geladen …'
                        : pluralize(count, 'Stopp', 'Stopps')}
                      {r.description ? ` · ${r.description}` : ''}
                    </div>
                  </div>
                  {r.mode === 'rule' && <Badge tone="accent">Regel</Badge>}
                  {r.roundtrip && <Badge>Rundtour</Badge>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )

  // Der Adresskasten steht ueber beidem und bleibt beim Wechsel stehen. Nur so
  // ueberlebt sein Bericht den Augenblick, in dem die frisch gebaute Tour
  // aufgeht - und die nicht gefundenen Zeilen bleiben zum Nachbessern da.
  return (
    <>
      <QuickTourPanel route={active} />
      {active ? <RouteEditor route={active} onBack={() => setActiveRoute(null)} /> : liste}
    </>
  )
}
