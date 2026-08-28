/**
 * Seitenleiste fuer Kategorien und Gruppen.
 *
 * Beide Listen sind nicht nur Verwaltung, sondern auch Einstieg: ein Klick
 * setzt den Filter der Standortliste und wechselt dorthin. Ohne diesen Weg
 * waere eine Gruppierung eine Angabe ohne Wirkung.
 */
import { useMemo, useState, type KeyboardEvent } from 'react'
import { Badge, Button, Dot, EmptyState, IconButton, Spinner, useConfirm } from '@/components/ui'
import { useCanEdit, useStore } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import * as db from '@/lib/db'
import { pluralize } from '@/lib/format'
import CategoryEditor, { categoryIconEmoji } from './CategoryEditor'
import GroupEditor from './GroupEditor'
import type { Category, Group, VisibilityLevel } from '@/types/domain'

function countLabel(n: number): string {
  return pluralize(n, 'Standort', 'Standorte')
}

/**
 * Die Zeile ist selbst bedienbar und enthaelt zugleich Schaltflaechen. Ohne
 * diese Pruefung wuerde die Zeile die Tastendruecke ihrer eigenen Knoepfe
 * abfangen: Enter auf "Bearbeiten" landete im Filter statt im Dialog.
 */
function isRowKey(e: KeyboardEvent<HTMLElement>): boolean {
  return e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')
}

function VisibilityBadge({ visibility }: { visibility: VisibilityLevel }) {
  if (visibility === 'workspace') return null
  return <Badge tone="warning">{visibility === 'private' ? 'privat' : 'eingeschraenkt'}</Badge>
}

export default function CatalogPanel() {
  const categories = useStore((s) => s.categories)
  const groups = useStore((s) => s.groups)
  const locations = useStore((s) => s.locations)
  const locationGroups = useStore((s) => s.locationGroups)
  const loading = useStore((s) => s.loadingWorkspace)
  const refreshCategories = useStore((s) => s.refreshCategories)
  const refreshGroups = useStore((s) => s.refreshGroups)
  const refreshLocations = useStore((s) => s.refreshLocations)
  const notify = useStore((s) => s.notify)
  const reportError = useStore((s) => s.reportError)
  const canEdit = useCanEdit()

  const patchFilter = useUi((s) => s.patchFilter)
  const setTab = useUi((s) => s.setTab)

  const [categoryDialog, setCategoryDialog] = useState<{ category: Category | null } | null>(null)
  const [groupDialog, setGroupDialog] = useState<{ group: Group | null } | null>(null)
  const { confirm, confirmElement } = useConfirm()

  const countByCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of locations) {
      if (l.category_id) map.set(l.category_id, (map.get(l.category_id) ?? 0) + 1)
    }
    return map
  }, [locations])

  const countByGroup = useMemo(() => {
    const map = new Map<string, number>()
    for (const lg of locationGroups) map.set(lg.group_id, (map.get(lg.group_id) ?? 0) + 1)
    return map
  }, [locationGroups])

  function showCategory(id: string) {
    patchFilter({ categoryIds: [id], groupIds: [] })
    setTab('locations')
  }

  function showGroup(id: string) {
    patchFilter({ groupIds: [id], categoryIds: [] })
    setTab('locations')
  }

  // Nach dem Loeschen darf kein Filter mehr auf ein verschwundenes Objekt
  // zeigen — sonst bliebe die Standortliste ohne erkennbaren Grund leer.
  function dropCategoryFromFilter(id: string) {
    const ids = useUi.getState().filter.categoryIds
    if (ids.includes(id)) patchFilter({ categoryIds: ids.filter((x) => x !== id) })
  }

  function dropGroupFromFilter(id: string) {
    const ids = useUi.getState().filter.groupIds
    if (ids.includes(id)) patchFilter({ groupIds: ids.filter((x) => x !== id) })
  }

  function askDeleteCategory(category: Category) {
    const used = countByCategory.get(category.id) ?? 0
    confirm(
      'Kategorie loeschen?',
      <>
        <p>
          Die Kategorie <strong>{category.name}</strong> wird geloescht.
        </p>
        <p className="muted">
          {used === 0
            ? 'Ihr ist derzeit kein Standort zugeordnet.'
            : used === 1
              ? 'Der zugeordnete Standort bleibt erhalten und steht danach ohne Kategorie da.'
              : `Die ${countLabel(used)} bleiben erhalten und stehen danach ohne Kategorie da.`}
        </p>
      </>,
      async () => {
        try {
          await db.deleteCategory(category.id)
          // Die Datenbank setzt locations.category_id auf NULL — die Standorte
          // im Speicher sind damit veraltet.
          await Promise.all([refreshCategories(), refreshLocations()])
          dropCategoryFromFilter(category.id)
          notify('success', 'Kategorie geloescht.')
        } catch (e) {
          reportError(e)
        }
      },
    )
  }

  function askDeleteGroup(group: Group) {
    const used = countByGroup.get(group.id) ?? 0
    confirm(
      'Gruppe loeschen?',
      <>
        <p>
          Die Gruppe <strong>{group.name}</strong> wird geloescht.
        </p>
        <p className="muted">
          {used === 0
            ? 'Ihr ist derzeit kein Standort zugeordnet.'
            : used === 1
              ? 'Der zugeordnete Standort bleibt erhalten, nur die Zuordnung zu dieser Gruppe entfaellt.'
              : `Die ${countLabel(used)} bleiben erhalten, nur die Zuordnung zu dieser Gruppe entfaellt.`}
        </p>
      </>,
      async () => {
        try {
          await db.deleteGroup(group.id)
          await refreshGroups()
          dropGroupFromFilter(group.id)
          notify('success', 'Gruppe geloescht.')
        } catch (e) {
          reportError(e)
        }
      },
    )
  }

  return (
    <>
      <div className="sidebar-head">
        <p className="small muted" style={{ marginBottom: 10 }}>
          Kategorien geben Farbe und Symbol auf der Karte — genau eine je Standort. Gruppen sind
          freie Sichten, ein Standort kann in mehreren liegen.
        </p>
      </div>

      <div className="sidebar-scroll">
        <section>
          <div className="row-between" style={{ padding: '10px 12px 6px' }}>
            <h2>
              Kategorien <span className="faint small">{categories.length}</span>
            </h2>
            {canEdit && (
              <Button size="sm" variant="primary" onClick={() => setCategoryDialog({ category: null })}>
                Neue Kategorie
              </Button>
            )}
          </div>

          {loading && categories.length === 0 ? (
            <div className="row" style={{ padding: '10px 12px' }}>
              <Spinner />
              <span className="small muted">Kategorien werden geladen …</span>
            </div>
          ) : categories.length === 0 ? (
            <EmptyState>
              Noch keine Kategorien.
              {canEdit ? (
                <>
                  <br />
                  Lege eine an, um Standorte auf der Karte unterscheidbar zu machen.
                </>
              ) : null}
            </EmptyState>
          ) : (
            <div className="list">
              {categories.map((c) => (
                <div
                  key={c.id}
                  className="list-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => showCategory(c.id)}
                  onKeyDown={(e) => {
                    if (isRowKey(e)) {
                      e.preventDefault()
                      showCategory(c.id)
                    }
                  }}
                >
                  <Dot color={c.color} />
                  <span aria-hidden="true">{categoryIconEmoji(c.icon)}</span>
                  <div className="list-item-main">
                    <div className="list-item-title">{c.name}</div>
                    <div className="list-item-sub">
                      {countLabel(countByCategory.get(c.id) ?? 0)}
                      {c.description ? ` · ${c.description}` : ''}
                    </div>
                  </div>
                  <VisibilityBadge visibility={c.visibility} />
                  {canEdit && (
                    <div className="list-item-actions">
                      <IconButton
                        label={`Kategorie ${c.name} bearbeiten`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setCategoryDialog({ category: c })
                        }}
                      >
                        ✎
                      </IconButton>
                      <IconButton
                        label={`Kategorie ${c.name} loeschen`}
                        onClick={(e) => {
                          e.stopPropagation()
                          askDeleteCategory(c)
                        }}
                      >
                        🗑
                      </IconButton>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <hr className="divider" />

        <section>
          <div className="row-between" style={{ padding: '10px 12px 6px' }}>
            <h2>
              Gruppen <span className="faint small">{groups.length}</span>
            </h2>
            {canEdit && (
              <Button size="sm" variant="primary" onClick={() => setGroupDialog({ group: null })}>
                Neue Gruppe
              </Button>
            )}
          </div>

          {loading && groups.length === 0 ? (
            <div className="row" style={{ padding: '10px 12px' }}>
              <Spinner />
              <span className="small muted">Gruppen werden geladen …</span>
            </div>
          ) : groups.length === 0 ? (
            <EmptyState>
              Noch keine Gruppen.
              {canEdit ? (
                <>
                  <br />
                  Gruppen buendeln Standorte quer zu den Kategorien — etwa fuer eine Tour.
                </>
              ) : null}
            </EmptyState>
          ) : (
            <div className="list">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="list-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => showGroup(g.id)}
                  onKeyDown={(e) => {
                    if (isRowKey(e)) {
                      e.preventDefault()
                      showGroup(g.id)
                    }
                  }}
                >
                  <Dot color={g.color} />
                  <div className="list-item-main">
                    <div className="list-item-title">{g.name}</div>
                    <div className="list-item-sub">
                      {countLabel(countByGroup.get(g.id) ?? 0)}
                      {g.description ? ` · ${g.description}` : ''}
                    </div>
                  </div>
                  <VisibilityBadge visibility={g.visibility} />
                  {canEdit && (
                    <div className="list-item-actions">
                      <IconButton
                        label={`Gruppe ${g.name} bearbeiten`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setGroupDialog({ group: g })
                        }}
                      >
                        ✎
                      </IconButton>
                      <IconButton
                        label={`Gruppe ${g.name} loeschen`}
                        onClick={(e) => {
                          e.stopPropagation()
                          askDeleteGroup(g)
                        }}
                      >
                        🗑
                      </IconButton>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="sidebar-foot">
        <span className="small muted">
          Ein Klick auf einen Eintrag zeigt die zugehoerigen Standorte in der Standortliste.
        </span>
      </div>

      {categoryDialog && (
        <CategoryEditor
          key={categoryDialog.category?.id ?? 'neu'}
          category={categoryDialog.category}
          onClose={() => setCategoryDialog(null)}
        />
      )}

      {groupDialog && (
        <GroupEditor
          key={groupDialog.group?.id ?? 'neu'}
          group={groupDialog.group}
          onClose={() => setGroupDialog(null)}
        />
      )}

      {confirmElement}
    </>
  )
}
