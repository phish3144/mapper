/**
 * Standorte aus Dateien uebernehmen und wieder herausgeben.
 *
 * Der Import zeigt erst eine Vorschau und importiert dann in Bloecken. Beides
 * mit Absicht: eine Datei mit tausend Zeilen soll weder blind noch in einem
 * einzigen, unteilbaren Aufruf in die Datenbank laufen. Was nicht gelesen
 * werden konnte, wird benannt statt verschwiegen.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { Badge, Button, Checkbox, Field, Modal, PALETTE, SelectField, Tabs } from '@/components/ui'
import { buildMembershipMap, useCanEdit, useCurrentWorkspace, useStore } from '@/lib/store'
import { filterLocations, useUi } from '@/lib/uiStore'
import * as db from '@/lib/db'
import { describeError } from '@/lib/supabase'
import {
  downloadText,
  locationsToGeoJson,
  normalizeKey,
  parseCsv,
  parseGeoJson,
  toCsv,
} from '@/lib/io'
import type { ImportResult, ParsedLocation } from '@/lib/io'
import { pluralize } from '@/lib/format'
import type { Group } from '@/types/domain'

type ExportFormat = 'geojson' | 'csv'
type ExportScope = 'all' | 'filtered'

const TABS = [
  { id: 'export' as const, label: 'Export' },
  { id: 'import' as const, label: 'Import' },
]

/** Blockgroesse eines Imports — gross genug fuer Tempo, klein genug fuer Fortschritt. */
const CHUNK_SIZE = 200
/** Gleichzeitige Gruppenzuordnungen; mehr bringt nichts und belastet nur die Datenbank. */
const GROUP_CONCURRENCY = 8
const PREVIEW_ROWS = 10
const MAX_SHOWN_ERRORS = 15

interface ImportReport {
  created: number
  skipped: number
  failed: number
  errors: string[]
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Dateinamen aus dem Bereichsnamen: klein, ohne Umlaute, mit Bindestrichen. */
function fileSlug(name: string): string {
  const parts = name.split(/\s+/).map(normalizeKey).filter((part) => part !== '')
  return parts.length > 0 ? parts.join('-') : 'arbeitsbereich'
}

function uniqueNames(values: readonly (string | undefined)[]): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    const name = value?.trim()
    if (!name) continue
    const key = normalizeKey(name)
    if (key !== '' && !seen.has(key)) seen.set(key, name)
  }
  return [...seen.values()]
}

export default function ImportExportDialog({ onClose }: { onClose: () => void }) {
  const canEdit = useCanEdit()
  const workspace = useCurrentWorkspace()
  const workspaceId = useStore((s) => s.currentWorkspaceId)
  const locations = useStore((s) => s.locations)
  const categories = useStore((s) => s.categories)
  const groups = useStore((s) => s.groups)
  const locationGroups = useStore((s) => s.locationGroups)
  const refreshLocations = useStore((s) => s.refreshLocations)
  const reloadWorkspaceData = useStore((s) => s.reloadWorkspaceData)
  const notify = useStore((s) => s.notify)
  const reportError = useStore((s) => s.reportError)
  const filter = useUi((s) => s.filter)

  const [tab, setTab] = useState<'export' | 'import'>('export')
  const [format, setFormat] = useState<ExportFormat>('geojson')
  const [scope, setScope] = useState<ExportScope>('all')

  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [createMissing, setCreateMissing] = useState(true)
  const [skipExisting, setSkipExisting] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [report, setReport] = useState<ImportReport | null>(null)
  // Der Lauf steht zusaetzlich in einer Referenz, damit `requestClose` ueber
  // alle Renderdurchlaeufe hinweg dieselbe Funktion bleiben kann: Modal haengt
  // seinen Effekt an die Identitaet von onClose und zieht den Fokus bei jedem
  // Durchlauf zurueck an den Dialoganfang. Eine bei jedem Tastendruck neu
  // gebaute Funktion machte das Textfeld unbenutzbar.
  const runningRef = useRef(false)

  const requestClose = useCallback(() => {
    if (runningRef.current) return
    onClose()
  }, [onClose])

  const membership = useMemo(() => buildMembershipMap(locationGroups), [locationGroups])
  const filtered = useMemo(
    () => filterLocations(locations, filter, membership),
    [locations, filter, membership],
  )

  const groupsByLocation = useMemo(() => {
    const byId = new Map(groups.map((g) => [g.id, g]))
    const map = new Map<string, Group[]>()
    for (const lg of locationGroups) {
      const group = byId.get(lg.group_id)
      if (!group) continue
      const list = map.get(lg.location_id)
      if (list) list.push(group)
      else map.set(lg.location_id, [group])
    }
    return map
  }, [groups, locationGroups])

  const parsed = useMemo<ImportResult | null>(() => {
    const content = text.trim()
    if (content === '') return null
    return content.startsWith('{') || content.startsWith('[') ? parseGeoJson(text) : parseCsv(text)
  }, [text])

  const detectedFormat = useMemo(() => {
    const content = text.trim()
    if (content === '') return null
    return content.startsWith('{') || content.startsWith('[') ? 'GeoJSON' : 'CSV'
  }, [text])

  function runExport() {
    const list = scope === 'filtered' ? filtered : locations
    if (list.length === 0) {
      notify('info', 'Es gibt nichts zu exportieren.')
      return
    }
    const base = `${fileSlug(workspace?.name ?? '')}-standorte-${today()}`
    try {
      if (format === 'geojson') {
        const content = JSON.stringify(
          locationsToGeoJson(list, categories, groupsByLocation),
          null,
          2,
        )
        downloadText(`${base}.geojson`, 'application/geo+json', content)
      } else {
        downloadText(`${base}.csv`, 'text/csv;charset=utf-8', toCsv(list, categories, groupsByLocation))
      }
      notify('success', `${pluralize(list.length, 'Standort', 'Standorte')} exportiert.`)
    } catch (e) {
      reportError(e)
    }
  }

  async function readFile(file: File) {
    try {
      const content = await file.text()
      setFileName(file.name)
      setText(content)
      setReport(null)
    } catch (e) {
      reportError(e)
    }
  }

  function toInput(row: ParsedLocation, categoryId: string | null): db.LocationInput {
    return {
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      address: row.address ?? null,
      notes: row.notes ?? null,
      category_id: categoryId,
      service_minutes: Math.round(row.serviceMinutes),
      time_windows: row.timeWindows,
      tags: row.tags,
      is_active: row.isActive,
      visibility: 'workspace',
    }
  }

  async function runImport() {
    if (!workspaceId || !parsed || parsed.rows.length === 0) return

    runningRef.current = true
    setRunning(true)
    setReport(null)
    setProgress({ done: 0, total: 0 })
    const errors = [...parsed.errors]
    let created = 0
    let skipped = 0
    // Nicht lesbare Zeilen zaehlen von Anfang an als fehlerhaft.
    let failed = parsed.errors.length

    try {
      const categoryByKey = new Map(categories.map((c) => [normalizeKey(c.name), c.id]))
      const groupByKey = new Map(groups.map((g) => [normalizeKey(g.name), g.id]))
      let catalogChanged = false

      if (createMissing) {
        const missingCategories = uniqueNames(parsed.rows.map((r) => r.categoryName)).filter(
          (name) => !categoryByKey.has(normalizeKey(name)),
        )
        const missingGroups = uniqueNames(parsed.rows.flatMap((r) => r.groupNames)).filter(
          (name) => !groupByKey.has(normalizeKey(name)),
        )
        let colorIndex = categories.length
        for (const name of missingCategories) {
          const category = await db.createCategory(workspaceId, {
            name,
            color: PALETTE[colorIndex++ % PALETTE.length],
            icon: 'pin',
          })
          categoryByKey.set(normalizeKey(name), category.id)
          catalogChanged = true
        }
        colorIndex = groups.length
        for (const name of missingGroups) {
          const group = await db.createGroup(workspaceId, {
            name,
            color: PALETTE[colorIndex++ % PALETTE.length],
          })
          groupByKey.set(normalizeKey(name), group.id)
          catalogChanged = true
        }
      }

      // Bereits vorhandene Namen (und Dubletten innerhalb der Datei) heraushalten.
      const knownNames = new Set(locations.map((l) => normalizeKey(l.name)))
      const queue: ParsedLocation[] = []
      for (const row of parsed.rows) {
        const key = normalizeKey(row.name)
        if (skipExisting && knownNames.has(key)) {
          skipped++
          continue
        }
        knownNames.add(key)
        queue.push(row)
      }

      setProgress({ done: 0, total: queue.length })

      for (let start = 0; start < queue.length; start += CHUNK_SIZE) {
        const chunk = queue.slice(start, start + CHUNK_SIZE)
        try {
          const inserted = await db.createLocations(
            workspaceId,
            chunk.map((row) =>
              toInput(row, row.categoryName ? categoryByKey.get(normalizeKey(row.categoryName)) ?? null : null),
            ),
          )
          created += inserted.length
          if (inserted.length < chunk.length) {
            const missing = chunk.length - inserted.length
            failed += missing
            errors.push(
              `Ein Block kam unvollstaendig zurueck: ${pluralize(missing, 'Zeile', 'Zeilen')} ohne Bestaetigung.`,
            )
          }

          if (inserted.length === chunk.length) {
            const assignments: { locationId: string; groupIds: string[] }[] = []
            inserted.forEach((row, index) => {
              const ids = chunk[index].groupNames
                .map((name) => groupByKey.get(normalizeKey(name)))
                .filter((id): id is string => id !== undefined)
              if (ids.length > 0) assignments.push({ locationId: row.id, groupIds: ids })
            })
            for (let i = 0; i < assignments.length; i += GROUP_CONCURRENCY) {
              await Promise.all(
                assignments
                  .slice(i, i + GROUP_CONCURRENCY)
                  .map((a) => db.setLocationGroups(a.locationId, a.groupIds)),
              )
            }
          } else if (chunk.some((row) => row.groupNames.length > 0)) {
            // Ohne verlaessliche Zuordnung lieber keine Gruppen setzen als falsche.
            errors.push('Die Gruppenzuordnung dieses Blocks wurde deshalb ausgelassen.')
          }
        } catch (e) {
          failed += chunk.length
          errors.push(describeError(e))
        }
        setProgress({ done: Math.min(start + CHUNK_SIZE, queue.length), total: queue.length })
      }

      if (catalogChanged) await reloadWorkspaceData()
      else await refreshLocations()

      setReport({ created, skipped, failed, errors })
      if (created > 0) {
        notify('success', `${pluralize(created, 'Standort', 'Standorte')} importiert.`)
      } else if (failed === 0 && skipped > 0) {
        notify('info', 'Nichts importiert — alle Zeilen waren bereits vorhanden.')
      }
    } catch (e) {
      reportError(e)
      setReport({ created, skipped, failed, errors: [...errors, describeError(e)] })
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }

  const previewRows = parsed?.rows.slice(0, PREVIEW_ROWS) ?? []
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Modal
      title="Import und Export"
      width={640}
      onClose={requestClose}
      footer={
        <>
          <Button onClick={requestClose} disabled={running}>
            Schliessen
          </Button>
          {tab === 'export' ? (
            <Button variant="primary" onClick={runExport}>
              Exportieren
            </Button>
          ) : (
            <Button
              variant="primary"
              busy={running}
              disabled={!parsed || parsed.rows.length === 0}
              onClick={() => void runImport()}
            >
              {parsed && parsed.rows.length > 0
                ? `${pluralize(parsed.rows.length, 'Zeile', 'Zeilen')} importieren`
                : 'Importieren'}
            </Button>
          )}
        </>
      }
    >
      {canEdit && (
        <div style={{ marginBottom: 14 }}>
          <Tabs
            tabs={TABS}
            active={tab}
            onChange={(id) => {
              if (!running) setTab(id)
            }}
          />
        </div>
      )}

      {tab === 'export' ? (
        <>
          <SelectField
            label="Format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            hint={
              format === 'geojson'
                ? 'GeoJSON — fuer Karten- und GIS-Programme, verlustfrei.'
                : 'CSV mit Semikolon und Komma als Dezimaltrennzeichen — fuer deutsches Excel.'
            }
          >
            <option value="geojson">GeoJSON</option>
            <option value="csv">CSV</option>
          </SelectField>

          <SelectField
            label="Umfang"
            value={scope}
            onChange={(e) => setScope(e.target.value as ExportScope)}
          >
            <option value="all">
              Alle Standorte ({locations.length})
            </option>
            <option value="filtered">
              Nur die gefilterten ({filtered.length})
            </option>
          </SelectField>

          <div className="panel panel-pad" style={{ background: 'var(--bg-subtle)' }}>
            <div className="small">
              Ausgegeben werden Name, Kategorie, Gruppen, Koordinaten, Adresse, Notizen, Tags,
              Aufenthaltsdauer, Status und Zeitfenster.
            </div>
            <div className="small faint" style={{ marginTop: 4 }}>
              Dateiname: {fileSlug(workspace?.name ?? '')}-standorte-{today()}.
              {format === 'geojson' ? 'geojson' : 'csv'}
            </div>
          </div>
        </>
      ) : (
        <>
          <Field label="Datei waehlen" hint="GeoJSON (.json, .geojson) oder CSV (.csv, .txt)">
            {(id) => (
              <input
                id={id}
                className="input"
                type="file"
                accept=".json,.geojson,.csv,.txt"
                disabled={running}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  // Zuruecksetzen, damit dieselbe Datei erneut gewaehlt werden kann.
                  e.target.value = ''
                  if (file) void readFile(file)
                }}
              />
            )}
          </Field>

          <Field
            label="Oder Text einfuegen"
            hint={
              detectedFormat
                ? `Erkanntes Format: ${detectedFormat}`
                : 'Beginnt der Inhalt mit { oder [, wird er als GeoJSON gelesen, sonst als CSV.'
            }
          >
            {(id) => (
              <textarea
                id={id}
                className="textarea"
                rows={5}
                value={text}
                disabled={running}
                placeholder="Inhalt hier einfuegen …"
                onChange={(e) => {
                  setText(e.target.value)
                  setFileName(null)
                  setReport(null)
                }}
              />
            )}
          </Field>

          {fileName && (
            <div className="small muted" style={{ marginTop: -6, marginBottom: 10 }}>
              Gelesen aus <span className="mono">{fileName}</span>
            </div>
          )}

          {parsed && (
            <div className="panel panel-pad" style={{ marginBottom: 12 }}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <strong className="small">
                  {pluralize(parsed.rows.length, 'Zeile', 'Zeilen')} erkannt
                </strong>
                {parsed.errors.length > 0 && (
                  <Badge tone="danger">
                    {pluralize(parsed.errors.length, 'Fehler', 'Fehler')}
                  </Badge>
                )}
              </div>

              {parsed.errors.length > 0 && (
                <ul className="small scroll-y" style={{ maxHeight: 120, margin: '0 0 10px', paddingLeft: 18 }}>
                  {parsed.errors.slice(0, MAX_SHOWN_ERRORS).map((message, index) => (
                    <li key={index} style={{ color: 'var(--danger)' }}>
                      {message}
                    </li>
                  ))}
                  {parsed.errors.length > MAX_SHOWN_ERRORS && (
                    <li className="faint">
                      … und {parsed.errors.length - MAX_SHOWN_ERRORS} weitere
                    </li>
                  )}
                </ul>
              )}

              {previewRows.length > 0 && (
                <div className="scroll-y" style={{ maxHeight: 220, overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {['Name', 'Kategorie', 'Gruppen', 'Koordinaten'].map((head) => (
                          <th
                            key={head}
                            style={{
                              textAlign: 'left',
                              padding: '4px 6px',
                              borderBottom: '1px solid var(--border)',
                              color: 'var(--text-muted)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, index) => (
                        <tr key={index}>
                          <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>
                            {row.name}
                          </td>
                          <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>
                            {row.categoryName ?? '—'}
                          </td>
                          <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>
                            {row.groupNames.length > 0 ? row.groupNames.join(', ') : '—'}
                          </td>
                          <td
                            className="mono"
                            style={{
                              padding: '4px 6px',
                              borderBottom: '1px solid var(--border)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.lat.toFixed(4)} / {row.lng.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.rows.length > previewRows.length && (
                    <div className="small faint" style={{ padding: '6px 6px 0' }}>
                      … und {parsed.rows.length - previewRows.length} weitere Zeilen
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <Checkbox
            label="Fehlende Kategorien und Gruppen anlegen"
            checked={createMissing}
            disabled={running}
            onChange={setCreateMissing}
          />
          <div style={{ height: 6 }} />
          <Checkbox
            label="Standorte mit bereits vorhandenem Namen ueberspringen"
            checked={skipExisting}
            disabled={running}
            onChange={setSkipExisting}
          />

          {running && (
            <div style={{ marginTop: 14 }}>
              <div className="row-between small muted" style={{ marginBottom: 4 }}>
                <span>
                  Importiere {progress.done} von {progress.total} …
                </span>
                <span>{percent} %</span>
              </div>
              <div
                style={{ height: 6, borderRadius: 999, background: 'var(--bg-subtle)', overflow: 'hidden' }}
                role="progressbar"
                aria-label="Fortschritt des Imports"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent)' }} />
              </div>
            </div>
          )}

          {report && !running && (
            <div className="panel panel-pad" style={{ marginTop: 14 }}>
              <div className="stats" style={{ marginBottom: 8 }}>
                <div className="stat">
                  <div className="stat-value">{report.created}</div>
                  <div className="stat-label">angelegt</div>
                </div>
                <div className="stat">
                  <div className="stat-value">{report.skipped}</div>
                  <div className="stat-label">uebersprungen</div>
                </div>
                <div className="stat">
                  <div className="stat-value">{report.failed}</div>
                  <div className="stat-label">fehlerhaft</div>
                </div>
              </div>
              {report.errors.length > 0 && (
                <ul className="small scroll-y" style={{ maxHeight: 120, margin: 0, paddingLeft: 18 }}>
                  {report.errors.slice(0, MAX_SHOWN_ERRORS).map((message, index) => (
                    <li key={index} style={{ color: 'var(--danger)' }}>
                      {message}
                    </li>
                  ))}
                  {report.errors.length > MAX_SHOWN_ERRORS && (
                    <li className="faint">… und {report.errors.length - MAX_SHOWN_ERRORS} weitere</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
