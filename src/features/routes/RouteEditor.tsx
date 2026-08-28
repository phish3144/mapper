import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Checkbox, Field, IconButton, SelectField, useConfirm } from '@/components/ui'
import { useStore, useCanEdit, buildMembershipMap } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import * as db from '@/lib/db'
import { applyRule } from '@/lib/rules'
import { providerNotice } from '@/lib/routing'
import { formatDistance, formatDuration, formatMinutes, formatTime, pluralize } from '@/lib/format'
import StopList from './StopList'
import RuleEditor from './RuleEditor'
import { useRoutePlan } from './useRoutePlan'
import VisibilityEditor from '@/features/catalog/VisibilityEditor'
import type { Route, RouteProfile, RouteRule, VisibilityLevel } from '@/types/domain'

const PROFILE_LABELS: Record<RouteProfile, string> = {
  driving: 'Auto',
  cycling: 'Fahrrad',
  walking: 'zu Fuss',
}

/** Wandelt einen ISO-Zeitstempel in den Wert eines datetime-local-Feldes (Lokalzeit). */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function RouteEditor({ route, onBack }: { route: Route; onBack: () => void }) {
  const canEdit = useCanEdit()
  const locations = useStore((s) => s.locations)
  const locationGroups = useStore((s) => s.locationGroups)
  const loadStops = useStore((s) => s.loadStops)
  const refreshRoutes = useStore((s) => s.refreshRoutes)
  const reportError = useStore((s) => s.reportError)
  const notify = useStore((s) => s.notify)
  const focusBounds = useUi((s) => s.focusBounds)
  const setActiveRoute = useUi((s) => s.setActiveRoute)

  const [showSettings, setShowSettings] = useState(false)
  const [name, setName] = useState(route.name)
  const [applying, setApplying] = useState(false)
  const { confirm, confirmElement } = useConfirm()

  const plan = useRoutePlan(route.id)
  const notice = useMemo(() => providerNotice(), [])
  const membership = useMemo(() => buildMembershipMap(locationGroups), [locationGroups])

  useEffect(() => {
    setName(route.name)
  }, [route.id, route.name])

  useEffect(() => {
    void loadStops(route.id)
    setActiveRoute(route.id)
    return () => setActiveRoute(null)
  }, [route.id, loadStops, setActiveRoute])

  async function patch(changes: Partial<Parameters<typeof db.updateRoute>[1]>) {
    try {
      await db.updateRoute(route.id, changes)
      await refreshRoutes()
    } catch (e) {
      reportError(e)
    }
  }

  async function applyRuleNow() {
    setApplying(true)
    try {
      const matched = applyRule(route.rule, locations, membership)
      await db.replaceRouteStops(route.id, matched.map((l) => l.id))
      await loadStops(route.id)
      notify('success', `${matched.length} ${pluralize(matched.length, 'Stopp', 'Stopps')} aus der Regel uebernommen.`)
    } catch (e) {
      reportError(e)
    } finally {
      setApplying(false)
    }
  }

  const stopOptions = plan.entries.map((e) => ({ id: e.location.id, name: e.location.name }))
  const schedule = plan.schedule

  return (
    <>
      <div className="sidebar-head">
        <div className="row" style={{ marginBottom: 8 }}>
          <IconButton label="Zurueck zur Routenliste" onClick={onBack}>
            ←
          </IconButton>
          <input
            className="input grow"
            value={name}
            disabled={!canEdit}
            aria-label="Name der Route"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const trimmed = name.trim()
              if (trimmed && trimmed !== route.name) void patch({ name: trimmed })
              else setName(route.name)
            }}
          />
        </div>

        <div className="row small muted" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          <Badge>{PROFILE_LABELS[route.profile]}</Badge>
          <Badge tone={route.mode === 'rule' ? 'accent' : 'default'}>
            {route.mode === 'rule' ? 'regelbasiert' : 'manuell'}
          </Badge>
          {route.roundtrip && <Badge>Rundtour</Badge>}
          {route.visibility !== 'workspace' && (
            <Badge tone="warning">{route.visibility === 'private' ? 'privat' : 'eingeschraenkt'}</Badge>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowSettings((v) => !v)}
            aria-expanded={showSettings}
          >
            {showSettings ? 'Einstellungen ausblenden' : 'Einstellungen'}
          </button>
        </div>

        {showSettings && (
          <div className="panel panel-pad" style={{ marginBottom: 10 }}>
            <SelectField
              label="Verkehrsmittel"
              value={route.profile}
              disabled={!canEdit}
              onChange={(e) => void patch({ profile: e.target.value as RouteProfile })}
            >
              <option value="driving">Auto</option>
              <option value="cycling">Fahrrad</option>
              <option value="walking">zu Fuss</option>
            </SelectField>
            {notice && route.profile !== 'driving' && (
              <div className="field-hint" style={{ marginTop: -8, marginBottom: 10 }}>
                {notice}
              </div>
            )}

            <SelectField
              label="Zusammenstellung"
              value={route.mode}
              disabled={!canEdit}
              onChange={(e) => void patch({ mode: e.target.value as Route['mode'] })}
            >
              <option value="manual">Manuell — feste Stoppliste</option>
              <option value="rule">Regelbasiert — Stopps aus einem Filter</option>
            </SelectField>

            <Field label="Geplante Abfahrt" hint="Ohne Abfahrtszeit werden nur Fahrzeiten berechnet, keine Uhrzeiten.">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="datetime-local"
                  disabled={!canEdit}
                  value={toLocalInput(route.depart_at)}
                  onChange={(e) =>
                    void patch({
                      depart_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                    })
                  }
                />
              )}
            </Field>

            <div className="field-row">
              <SelectField
                label="Start"
                value={route.start_location_id ?? ''}
                disabled={!canEdit}
                onChange={(e) => void patch({ start_location_id: e.target.value || null })}
              >
                <option value="">frei waehlbar</option>
                {stopOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Ziel"
                value={route.end_location_id ?? ''}
                disabled={!canEdit || route.roundtrip}
                onChange={(e) => void patch({ end_location_id: e.target.value || null })}
              >
                <option value="">frei waehlbar</option>
                {stopOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </SelectField>
            </div>

            <div className="field">
              <Checkbox
                label="Rundtour — zurueck zum Startpunkt"
                checked={route.roundtrip}
                disabled={!canEdit}
                onChange={(on) => void patch({ roundtrip: on, end_location_id: on ? null : route.end_location_id })}
              />
            </div>

            <Field
              label="Aufenthaltsdauer als Vorgabe (Minuten)"
              hint="Gilt fuer Standorte ohne eigene Angabe."
            >
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="number"
                  min={0}
                  max={1440}
                  disabled={!canEdit}
                  value={route.default_service_minutes}
                  onChange={(e) => void patch({ default_service_minutes: Number(e.target.value) || 0 })}
                />
              )}
            </Field>

            <VisibilityEditor
              kind="route"
              entityId={route.id}
              workspaceId={route.workspace_id}
              value={route.visibility}
              onChange={(v: VisibilityLevel) => void patch({ visibility: v })}
            />

            {canEdit && (
              <>
                <hr className="divider" />
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    confirm(
                      'Route loeschen?',
                      <>
                        Die Route <strong>{route.name}</strong> und ihre Stoppliste werden geloescht. Die
                        Standorte selbst bleiben erhalten.
                      </>,
                      async () => {
                        try {
                          await db.deleteRoute(route.id)
                          await refreshRoutes()
                          onBack()
                        } catch (e) {
                          reportError(e)
                        }
                      },
                    )
                  }
                >
                  Route loeschen
                </Button>
              </>
            )}
          </div>
        )}

        {route.mode === 'rule' && (
          <div className="panel panel-pad" style={{ marginBottom: 10 }}>
            <h4 style={{ marginBottom: 8 }}>Regel</h4>
            <RuleEditor
              value={route.rule}
              onChange={(next: RouteRule) => void patch({ rule: next })}
            />
            {canEdit && (
              <Button
                variant="primary"
                block
                busy={applying}
                style={{ marginTop: 10 }}
                onClick={() => void applyRuleNow()}
              >
                Stopps aus der Regel neu aufbauen
              </Button>
            )}
            <div className="field-hint" style={{ marginTop: 6 }}>
              Die Stoppliste wird dabei vollstaendig ersetzt. Danach kannst du sie weiter von Hand
              anpassen.
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-scroll" style={{ padding: '0 12px' }}>
        {plan.error && (
          <div className="panel panel-pad small" style={{ marginBottom: 8, borderLeft: '3px solid var(--warning)' }}>
            {plan.error}
          </div>
        )}

        <div className="row-between" style={{ marginBottom: 8 }}>
          <h4>
            {plan.entries.length} {pluralize(plan.entries.length, 'Stopp', 'Stopps')}
          </h4>
          <div className="row" style={{ gap: 4 }}>
            {plan.entries.length > 0 && (
              <Button
                size="sm"
                onClick={() =>
                  focusBounds(plan.entries.map((e) => ({ lat: e.location.lat, lng: e.location.lng })))
                }
              >
                Auf Karte zeigen
              </Button>
            )}
            {canEdit && plan.entries.length >= 3 && (
              <Button
                size="sm"
                variant="primary"
                busy={plan.optimizing}
                disabled={plan.loading}
                onClick={() => void plan.optimize()}
              >
                Optimieren
              </Button>
            )}
          </div>
        </div>

        {plan.lastGain && (
          <div className="panel panel-pad small" style={{ marginBottom: 8, borderLeft: '3px solid var(--success)' }}>
            {plan.lastGain.seconds > 0
              ? `${formatDuration(plan.lastGain.seconds)} eingespart.`
              : 'Die Reihenfolge war bereits optimal.'}
            {plan.lastGain.violationsBefore !== plan.lastGain.violationsAfter &&
              ` Zeitfensterverletzungen: ${plan.lastGain.violationsBefore} → ${plan.lastGain.violationsAfter}.`}
          </div>
        )}

        <StopList
          entries={plan.entries}
          schedule={schedule}
          canEdit={canEdit}
          onReorder={async (ids) => {
            try {
              await db.reorderRouteStops(route.id, ids)
              await loadStops(route.id)
            } catch (e) {
              reportError(e)
            }
          }}
          onRemove={async (stopId) => {
            try {
              await db.removeRouteStop(stopId)
              await loadStops(route.id)
            } catch (e) {
              reportError(e)
            }
          }}
        />
      </div>

      {schedule && plan.entries.length > 1 && (
        <div className="sidebar-foot">
          <div className="stats">
            <div className="stat">
              <div className="stat-value">{formatDuration(schedule.totalTravelSec)}</div>
              <div className="stat-label">Fahrzeit{plan.estimated ? ' (geschaetzt)' : ''}</div>
            </div>
            <div className="stat">
              <div className="stat-value">{formatDistance(schedule.totalDistanceM)}</div>
              <div className="stat-label">Strecke</div>
            </div>
            {schedule.totalServiceMinutes > 0 && (
              <div className="stat">
                <div className="stat-value">{formatMinutes(schedule.totalServiceMinutes)}</div>
                <div className="stat-label">Aufenthalt</div>
              </div>
            )}
            {schedule.totalWaitMinutes > 0 && (
              <div className="stat">
                <div className="stat-value">{formatMinutes(schedule.totalWaitMinutes)}</div>
                <div className="stat-label">Wartezeit</div>
              </div>
            )}
            {schedule.finishAt && (
              <div className="stat">
                <div className="stat-value">{formatTime(schedule.finishAt)}</div>
                <div className="stat-label">Ankunft</div>
              </div>
            )}
            {schedule.violations > 0 && (
              <div className="stat" style={{ background: 'var(--danger-subtle)' }}>
                <div className="stat-value" style={{ color: 'var(--danger)' }}>
                  {schedule.violations}
                </div>
                <div className="stat-label">Zeitfenster verletzt</div>
              </div>
            )}
          </div>
        </div>
      )}
      {confirmElement}
    </>
  )
}
