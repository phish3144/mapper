/**
 * Zeitfenster eines Standorts.
 *
 * Gespeichert wird je Wochentag ein eigenes Fenster (so erwartet es die
 * Planung), bedient wird aber in Zeilen: eine Uhrzeitspanne und die Tage, an
 * denen sie gilt. Wer "Mo-Fr 08:00-17:00" eintraegt, will nicht fuenfmal
 * dieselbe Uhrzeit tippen.
 *
 * Die Zeilen liegen in einem eigenen Zustand und nicht nur als Ableitung aus
 * `value`: eine Zeile ohne Wochentag und eine Zeile mit noch leerer Uhrzeit
 * ergeben kein gueltiges Fenster, muessen beim Bearbeiten aber stehen bleiben
 * duerfen — sonst verschwindet die Zeile unter den Haenden.
 */
import { useEffect, useRef, useState } from 'react'
import { Badge, Button, IconButton } from '@/components/ui'
import { WEEKDAYS_LONG, WEEKDAYS_SHORT, formatTimeWindows } from '@/lib/format'
import type { TimeWindow } from '@/types/domain'

/** ISO-8601: 1 = Montag ... 7 = Sonntag, wie in TimeWindow.dow. */
const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7]
const WORKDAYS = [1, 2, 3, 4, 5]
const DEFAULT_FROM = '08:00'
const DEFAULT_TO = '17:00'

interface Row {
  /** Nur fuer den React-Schluessel — Zeilen ohne Tage haben keinen fachlichen. */
  key: number
  from: string
  to: string
  days: number[]
}

let nextRowKey = 0

function dayShort(dow: number): string {
  return dow >= 1 && dow <= 7 ? WEEKDAYS_SHORT[dow - 1] : String(dow)
}

function dayLong(dow: number): string {
  return dow >= 1 && dow <= 7 ? WEEKDAYS_LONG[dow - 1] : String(dow)
}

/** Fenster mit gleicher Uhrzeitspanne zu einer Zeile zusammenfassen. */
function groupWindows(windows: readonly TimeWindow[]): Row[] {
  const rows: Row[] = []
  const byTime = new Map<string, Row>()
  for (const w of windows) {
    const key = `${w.from}|${w.to}`
    let row = byTime.get(key)
    if (!row) {
      row = { key: ++nextRowKey, from: w.from, to: w.to, days: [] }
      byTime.set(key, row)
      rows.push(row)
    }
    if (!row.days.includes(w.dow)) row.days.push(w.dow)
  }
  for (const row of rows) row.days.sort((a, b) => a - b)
  return rows
}

function flatten(rows: readonly Row[]): TimeWindow[] {
  const out: TimeWindow[] = []
  for (const row of rows) {
    if (row.from === '' || row.to === '') continue
    for (const dow of [...row.days].sort((a, b) => a - b)) {
      out.push({ dow, from: row.from, to: row.to })
    }
  }
  return out
}

function serialize(windows: readonly TimeWindow[]): string {
  return windows.map((w) => `${w.dow}|${w.from}|${w.to}`).join(';')
}

/** "22:00-06:00" laeuft ueber Mitternacht — Zeichenketten "HH:MM" sind vergleichbar. */
function crossesMidnight(row: Row): boolean {
  return row.from !== '' && row.to !== '' && row.to <= row.from
}

export default function TimeWindowsEditor({
  value,
  onChange,
}: {
  value: TimeWindow[]
  onChange: (next: TimeWindow[]) => void
}) {
  const [rows, setRows] = useState<Row[]>(() => groupWindows(value))
  const emittedRef = useRef<string>(serialize(value))

  // Von aussen gesetzte Werte uebernehmen (z. B. beim Zuruecksetzen des
  // Formulars), die eigene Meldung aber nicht als Fremdaenderung missdeuten.
  useEffect(() => {
    const incoming = serialize(value)
    if (incoming === emittedRef.current) return
    emittedRef.current = incoming
    setRows(groupWindows(value))
  }, [value])

  function apply(next: Row[]) {
    setRows(next)
    const windows = flatten(next)
    emittedRef.current = serialize(windows)
    onChange(windows)
  }

  function patchRow(index: number, patch: Partial<Row>) {
    apply(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function toggleDay(index: number, dow: number) {
    const row = rows[index]
    const days = row.days.includes(dow) ? row.days.filter((d) => d !== dow) : [...row.days, dow]
    patchRow(index, { days: days.sort((a, b) => a - b) })
  }

  function addRow() {
    apply([...rows, { key: ++nextRowKey, from: DEFAULT_FROM, to: DEFAULT_TO, days: [...WORKDAYS] }])
  }

  function removeRow(index: number) {
    apply(rows.filter((_, i) => i !== index))
  }

  const summary = formatTimeWindows(value)

  return (
    <div className="field">
      <span className="small muted" style={{ fontWeight: 600 }}>
        Zeitfenster
      </span>

      {rows.length === 0 ? (
        <div className="panel panel-pad" style={{ background: 'var(--bg-subtle)' }}>
          <div className="small">Keine Zeitfenster — der Standort gilt als jederzeit erreichbar.</div>
        </div>
      ) : (
        <>
          <div className="tw-row small muted" aria-hidden="true">
            <span>Wochentage</span>
            <span>Von</span>
            <span>Bis</span>
            <span />
          </div>

          {rows.map((row, index) => (
            <div key={row.key} style={{ marginBottom: 8 }}>
              <div className="tw-row">
                <div className="dow-picker" role="group" aria-label={`Wochentage des ${index + 1}. Zeitfensters`}>
                  {ISO_DAYS.map((dow) => {
                    const on = row.days.includes(dow)
                    return (
                      <button
                        key={dow}
                        type="button"
                        className={`dow-btn ${on ? 'is-on' : ''}`}
                        aria-pressed={on}
                        aria-label={dayLong(dow)}
                        onClick={() => toggleDay(index, dow)}
                      >
                        {dayShort(dow)}
                      </button>
                    )
                  })}
                </div>
                <input
                  className="input"
                  type="time"
                  style={{ width: 104 }}
                  value={row.from}
                  aria-label={`Beginn des ${index + 1}. Zeitfensters`}
                  onChange={(e) => patchRow(index, { from: e.target.value })}
                />
                <input
                  className="input"
                  type="time"
                  style={{ width: 104 }}
                  value={row.to}
                  aria-label={`Ende des ${index + 1}. Zeitfensters`}
                  onChange={(e) => patchRow(index, { to: e.target.value })}
                />
                <IconButton
                  label={`${index + 1}. Zeitfenster entfernen`}
                  onClick={() => removeRow(index)}
                >
                  ✕
                </IconButton>
              </div>

              {(row.days.length === 0 || row.from === '' || row.to === '' || crossesMidnight(row)) && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                  {row.days.length === 0 && (
                    <Badge tone="warning">Kein Wochentag gewaehlt — wirkt nicht</Badge>
                  )}
                  {(row.from === '' || row.to === '') && (
                    <Badge tone="warning">Uhrzeit fehlt — wirkt nicht</Badge>
                  )}
                  {crossesMidnight(row) && <Badge tone="accent">laeuft ueber Mitternacht</Badge>}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <div className="row" style={{ marginTop: 4 }}>
        <Button size="sm" onClick={addRow}>
          Zeitfenster hinzufuegen
        </Button>
        {value.length > 0 && <span className="small mono truncate grow">{summary}</span>}
      </div>

      <span className="field-hint">
        Ohne Zeitfenster ist der Standort jederzeit erreichbar. Liegt das Ende vor dem Beginn, gilt
        das Fenster als ueber Mitternacht laufend (z. B. 22:00–06:00).
      </span>
    </div>
  )
}
