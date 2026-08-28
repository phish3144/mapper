import { useMemo, useState } from 'react'
import { Badge, Button, EmptyState, Modal, SelectField, TextField } from '@/components/ui'
import { useStore, useCanEdit } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import * as db from '@/lib/db'
import { pluralize } from '@/lib/format'
import RouteEditor from './RouteEditor'
import type { RouteMode } from '@/types/domain'

export default function RoutesPanel() {
  const routes = useStore((s) => s.routes)
  const stopsByRoute = useStore((s) => s.stopsByRoute)
  const currentWorkspaceId = useStore((s) => s.currentWorkspaceId)
  const refreshRoutes = useStore((s) => s.refreshRoutes)
  const reportError = useStore((s) => s.reportError)
  const canEdit = useCanEdit()
  const activeRouteId = useUi((s) => s.activeRouteId)
  const setActiveRoute = useUi((s) => s.setActiveRoute)

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMode, setNewMode] = useState<RouteMode>('manual')
  const [busy, setBusy] = useState(false)

  const active = useMemo(
    () => routes.find((r) => r.id === activeRouteId) ?? null,
    [routes, activeRouteId],
  )

  if (active) {
    return <RouteEditor route={active} onBack={() => setActiveRoute(null)} />
  }

  async function create() {
    if (!currentWorkspaceId || !newName.trim()) return
    setBusy(true)
    try {
      const route = await db.createRoute(currentWorkspaceId, {
        name: newName.trim(),
        mode: newMode,
        rule: newMode === 'rule' ? { onlyActive: true } : {},
      })
      await refreshRoutes()
      setCreating(false)
      setNewName('')
      setNewMode('manual')
      setActiveRoute(route.id)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="sidebar-head">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <h2>
            {routes.length} {pluralize(routes.length, 'Route', 'Routen')}
          </h2>
          {canEdit && (
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              Neue Route
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
                Lege eine an und stelle die Stopps von Hand zusammen — oder lass sie aus einer Regel
                fuellen.
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
                        : `${count} ${pluralize(count, 'Stopp', 'Stopps')}`}
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

      {creating && (
        <Modal
          title="Neue Route"
          onClose={() => setCreating(false)}
          width={430}
          footer={
            <>
              <Button onClick={() => setCreating(false)} disabled={busy}>
                Abbrechen
              </Button>
              <Button variant="primary" busy={busy} disabled={!newName.trim()} onClick={() => void create()}>
                Anlegen
              </Button>
            </>
          }
        >
          <TextField
            label="Name"
            value={newName}
            autoFocus
            placeholder="z. B. Tour Nord, KW 12"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) void create()
            }}
          />
          <SelectField
            label="Zusammenstellung"
            value={newMode}
            onChange={(e) => setNewMode(e.target.value as RouteMode)}
            hint={
              newMode === 'rule'
                ? 'Die Stopps ergeben sich aus einem Filter und lassen sich jederzeit neu aufbauen.'
                : 'Du stellst die Stopps selbst zusammen und sortierst sie per Ziehen und Ablegen.'
            }
          >
            <option value="manual">Manuell</option>
            <option value="rule">Regelbasiert</option>
          </SelectField>
        </Modal>
      )}
    </>
  )
}
