/**
 * Seitenleiste der Standorte: filtern, auswaehlen, bearbeiten.
 *
 * Die Liste ist der zweite Blick auf dieselbe Menge, die auch die Karte zeigt
 * — gefiltert wird deshalb ueber filterLocations aus dem Oberflaechenzustand
 * und nicht hier. Ein Klick waehlt aus und springt die Karte an; ohne das
 * zweite waere die Auswahl auf der Karte oft ausserhalb des Ausschnitts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  EmptyState,
  GroupStripe,
  IconButton,
  Spinner,
  useConfirm,
} from '@/components/ui'
import { buildMembershipMap, categoryById, useCanEdit, useLocationColors, useStore } from '@/lib/store'
import { filterLocations, isFilterActive, useUi } from '@/lib/uiStore'
import * as db from '@/lib/db'
import { formatLatLng } from '@/lib/geo'
import { formatTimeWindows, pluralize } from '@/lib/format'
import FilterBar from './FilterBar'
import LocationForm from './LocationForm'
import ImportExportDialog from './ImportExportDialog'
import type { LatLng, MapLocation, VisibilityLevel } from '@/types/domain'

/** Gleichzeitige Loeschvorgaenge — mehr bringt kein Tempo, nur Last. */
const DELETE_CONCURRENCY = 8

interface FormState {
  location: MapLocation | null
  point: LatLng | null
}

function VisibilityBadge({ visibility }: { visibility: VisibilityLevel }) {
  if (visibility === 'workspace') return null
  return <Badge tone="warning">{visibility === 'private' ? 'privat' : 'eingeschraenkt'}</Badge>
}

export default function LocationsPanel() {
  const locations = useStore((s) => s.locations)
  const categories = useStore((s) => s.categories)
  const groups = useStore((s) => s.groups)
  const locationGroups = useStore((s) => s.locationGroups)
  const loading = useStore((s) => s.loadingWorkspace)
  const refreshLocations = useStore((s) => s.refreshLocations)
  const notify = useStore((s) => s.notify)
  const reportError = useStore((s) => s.reportError)
  const canEdit = useCanEdit()

  const filter = useUi((s) => s.filter)
  const selectedId = useUi((s) => s.selectedLocationId)
  const checkedIds = useUi((s) => s.checkedLocationIds)
  const draftPoint = useUi((s) => s.draftPoint)
  const editingLocationId = useUi((s) => s.editingLocationId)
  const selectLocation = useUi((s) => s.selectLocation)
  const toggleChecked = useUi((s) => s.toggleChecked)
  const setChecked = useUi((s) => s.setChecked)
  const clearChecked = useUi((s) => s.clearChecked)
  const setDraftPoint = useUi((s) => s.setDraftPoint)
  const setEditingLocation = useUi((s) => s.setEditingLocation)
  const focusPoint = useUi((s) => s.focusPoint)

  const [form, setForm] = useState<FormState | null>(null)
  const [ioOpen, setIoOpen] = useState(false)
  const [bulkGroupId, setBulkGroupId] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const { confirm, confirmElement } = useConfirm()

  // Wird das Formular geschlossen, um einen Punkt auf der Karte zu waehlen,
  // muss es danach denselben Standort wieder oeffnen — sonst wuerde aus dem
  // Bearbeiten unversehens ein Neuanlegen.
  const pendingPickRef = useRef<FormState | null>(null)
  // Spiegel des offenen Formulars: closeForm muss ueber alle Renderdurchlaeufe
  // hinweg dieselbe Funktion bleiben (siehe openForm/closeForm), darf den
  // Zustand also nicht aus der Closure lesen.
  const formRef = useRef<FormState | null>(null)
  useEffect(() => {
    formRef.current = form
  }, [form])

  const membership = useMemo(() => buildMembershipMap(locationGroups), [locationGroups])
  const visible = useMemo(
    () => filterLocations(locations, filter, membership),
    [locations, filter, membership],
  )
  const catById = useMemo(() => categoryById(categories), [categories])
  const colorsOf = useLocationColors()

  // Die Farben allein sagen nicht, WELCHE Gruppe gemeint ist. Der Titel des
  // Streifens holt das nach - ungekuerzt, auch wenn die Darstellung deckelt.
  const groupLabel = useCallback(
    (location: MapLocation) => {
      const mine = new Set(membership.get(location.id) ?? [])
      const namen = groups.filter((g) => mine.has(g.id)).map((g) => g.name)
      return namen.length > 0 ? namen.join(', ') : 'ohne Gruppe'
    },
    [groups, membership],
  )

  // Angehakte Standorte, die es noch gibt — Loeschungen anderswo duerfen die
  // Zahl in der Leiste nicht zu einer Behauptung machen.
  const selectedForBulk = useMemo(() => {
    const known = new Set(locations.map((l) => l.id))
    return checkedIds.filter((id) => known.has(id))
  }, [checkedIds, locations])

  // Als Menge, damit die Liste auch bei einigen hundert Eintraegen nicht in
  // eine quadratische Suche laeuft.
  const checkedSet = useMemo(() => new Set(checkedIds), [checkedIds])
  const allVisibleChecked = visible.length > 0 && visible.every((l) => checkedSet.has(l.id))

  useEffect(() => {
    if (!draftPoint) return
    setDraftPoint(null)
    if (!canEdit) return
    const pendingId = pendingPickRef.current?.location?.id ?? null
    pendingPickRef.current = null
    const target = pendingId
      ? useStore.getState().locations.find((l) => l.id === pendingId) ?? null
      : null
    setForm({ location: target, point: draftPoint })
  }, [draftPoint, canEdit, setDraftPoint])

  useEffect(() => {
    if (!editingLocationId) return
    setEditingLocation(null)
    if (!canEdit) return
    const target = useStore.getState().locations.find((l) => l.id === editingLocationId)
    if (target) {
      pendingPickRef.current = null
      setForm({ location: target, point: null })
    }
  }, [editingLocationId, canEdit, setEditingLocation])

  // Die drei Rueckrufe unten landen als `onClose` in Modal. Dessen Effekt
  // haengt an der Identitaet dieser Funktion und holt bei jedem Durchlauf den
  // Fokus zurueck an den Dialoganfang — eine bei jedem Render neu gebaute
  // Funktion wuerde die Eingabe unbenutzbar machen.

  /** Jeder ausdrueckliche Weg ins Formular verwirft einen alten Kartenauftrag. */
  const openForm = useCallback((state: FormState) => {
    pendingPickRef.current = null
    setForm(state)
  }, [])

  const closeForm = useCallback(() => {
    pendingPickRef.current = useUi.getState().pickingPoint ? formRef.current : null
    setForm(null)
  }, [])

  const closeIo = useCallback(() => setIoOpen(false), [])

  function open(location: MapLocation) {
    selectLocation(location.id)
    focusPoint({ lat: location.lat, lng: location.lng })
  }

  function toggleAllVisible(on: boolean) {
    if (on) setChecked([...new Set([...checkedIds, ...visible.map((l) => l.id)])])
    else {
      const shown = new Set(visible.map((l) => l.id))
      setChecked(checkedIds.filter((id) => !shown.has(id)))
    }
  }

  async function addToGroup() {
    if (!bulkGroupId || selectedForBulk.length === 0) return
    setBulkBusy(true)
    try {
      await db.addLocationsToGroup(selectedForBulk, bulkGroupId)
      await refreshLocations()
      notify(
        'success',
        `${pluralize(selectedForBulk.length, 'Standort', 'Standorte')} zur Gruppe hinzugefuegt.`,
      )
    } catch (e) {
      reportError(e)
    } finally {
      setBulkBusy(false)
    }
  }

  async function removeFromGroup() {
    if (!bulkGroupId || selectedForBulk.length === 0) return
    setBulkBusy(true)
    try {
      await db.removeLocationsFromGroup(selectedForBulk, bulkGroupId)
      await refreshLocations()
      notify(
        'success',
        `${pluralize(selectedForBulk.length, 'Standort', 'Standorte')} aus der Gruppe entfernt.`,
      )
    } catch (e) {
      reportError(e)
    } finally {
      setBulkBusy(false)
    }
  }

  function askBulkDelete() {
    const ids = selectedForBulk
    if (ids.length === 0) return
    confirm(
      'Standorte loeschen',
      <>
        Sollen <strong>{pluralize(ids.length, 'Standort', 'Standorte')}</strong> wirklich geloescht
        werden? Sie verschwinden damit auch aus allen Routen und Gruppen.
      </>,
      async () => {
        try {
          for (let i = 0; i < ids.length; i += DELETE_CONCURRENCY) {
            await Promise.all(ids.slice(i, i + DELETE_CONCURRENCY).map((id) => db.deleteLocation(id)))
          }
          await refreshLocations()
          if (selectedId && ids.includes(selectedId)) selectLocation(null)
          clearChecked()
          notify('success', `${pluralize(ids.length, 'Standort', 'Standorte')} geloescht.`)
        } catch (e) {
          reportError(e)
        }
      },
    )
  }

  const total = locations.length
  // Zahlen durchgaengig ueber pluralize: sonst stuende die ungruppierte
  // Trefferzahl ("1234") neben der gruppierten Gesamtzahl ("5.678").
  const countLabel = isFilterActive(filter)
    ? `${pluralize(visible.length, 'Treffer', 'Treffer')} von ${pluralize(total, 'Standort', 'Standorten')}`
    : pluralize(total, 'Standort', 'Standorte')

  return (
    <>
      <div className="sidebar-head">
        <FilterBar />

        <div className="row-between" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 7, minWidth: 0 }}>
            {canEdit && visible.length > 0 && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={allVisibleChecked}
                  aria-label="Alle angezeigten Standorte auswaehlen"
                  onChange={(e) => toggleAllVisible(e.target.checked)}
                />
              </label>
            )}
            <span className="small muted truncate">{countLabel}</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {canEdit && (
              <Button size="sm" variant="primary" onClick={() => openForm({ location: null, point: null })}>
                Neu
              </Button>
            )}
            <Button size="sm" onClick={() => setIoOpen(true)}>
              Import / Export
            </Button>
          </div>
        </div>
      </div>

      <div className="sidebar-scroll">
        {loading && locations.length === 0 ? (
          <div className="row" style={{ justifyContent: 'center', padding: 24 }}>
            <Spinner />
          </div>
        ) : total === 0 ? (
          <EmptyState>
            Noch keine Standorte.
            {canEdit ? (
              <>
                <br />
                Lege einen an, klicke auf die Karte oder importiere eine Datei.
              </>
            ) : null}
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState>Kein Standort passt zum Filter.</EmptyState>
        ) : (
          <div className="list">
            {visible.map((l) => {
              const category = l.category_id ? catById.get(l.category_id) ?? null : null
              const checked = checkedSet.has(l.id)
              return (
                <div
                  key={l.id}
                  className={`list-item ${l.id === selectedId ? 'is-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={l.id === selectedId}
                  onClick={() => open(l)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      open(l)
                    }
                  }}
                >
                  {canEdit && (
                    <label
                      className="checkbox"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={`${l.name} auswaehlen`}
                        onChange={() => toggleChecked(l.id)}
                      />
                    </label>
                  )}

                  <GroupStripe colors={colorsOf(l, category)} label={groupLabel(l)} />

                  <div className="list-item-main">
                    <div className="list-item-title">{l.name}</div>
                    <div className="list-item-sub">
                      {l.address?.trim() || formatLatLng({ lat: l.lat, lng: l.lng })}
                    </div>
                    {(!l.is_active || l.visibility !== 'workspace' || l.time_windows.length > 0) && (
                      <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                        {!l.is_active && <Badge tone="danger">inaktiv</Badge>}
                        <VisibilityBadge visibility={l.visibility} />
                        {l.time_windows.length > 0 && (
                          <span title={formatTimeWindows(l.time_windows)}>
                            <Badge tone="accent">
                              {pluralize(l.time_windows.length, 'Zeitfenster', 'Zeitfenster')}
                            </Badge>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {canEdit && (
                    <div className="list-item-actions">
                      <IconButton
                        label={`${l.name} bearbeiten`}
                        onClick={(e) => {
                          e.stopPropagation()
                          openForm({ location: l, point: null })
                        }}
                      >
                        ✎
                      </IconButton>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {canEdit && selectedForBulk.length > 0 && (
        <div className="sidebar-foot">
          <div className="row-between" style={{ marginBottom: 6 }}>
            <strong className="small">
              {pluralize(selectedForBulk.length, 'Standort', 'Standorte')} ausgewaehlt
            </strong>
            <div className="row" style={{ gap: 4 }}>
              <Button size="sm" variant="danger" disabled={bulkBusy} onClick={askBulkDelete}>
                Loeschen
              </Button>
              <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={clearChecked}>
                Auswahl aufheben
              </Button>
            </div>
          </div>

          {groups.length === 0 ? (
            <span className="small faint">
              Noch keine Gruppen angelegt — im Reiter „Kategorien & Gruppen“ lassen sich welche anlegen.
            </span>
          ) : (
            <div className="row" style={{ gap: 6 }}>
              <select
                className="select grow"
                value={bulkGroupId}
                aria-label="Gruppe fuer die ausgewaehlten Standorte"
                onChange={(e) => setBulkGroupId(e.target.value)}
              >
                <option value="">Gruppe waehlen …</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!bulkGroupId || bulkBusy}
                busy={bulkBusy}
                onClick={() => void addToGroup()}
              >
                Hinzufuegen
              </Button>
              <Button size="sm" disabled={!bulkGroupId || bulkBusy} onClick={() => void removeFromGroup()}>
                Entfernen
              </Button>
            </div>
          )}
        </div>
      )}

      {form && (
        <LocationForm
          key={`${form.location?.id ?? 'neu'}:${form.point ? `${form.point.lat},${form.point.lng}` : ''}`}
          location={form.location}
          initialPoint={form.point}
          onClose={closeForm}
        />
      )}

      {ioOpen && <ImportExportDialog onClose={closeIo} />}

      {confirmElement}
    </>
  )
}
