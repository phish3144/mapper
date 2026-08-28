/**
 * Einheitliche deutsche Formatierung fuer Oberflaeche und Exporte.
 *
 * Alle Funktionen sind rein und deterministisch. Zahlen, Datums- und
 * Zeitangaben werden bewusst von Hand zusammengesetzt statt ueber Intl mit
 * 'de-DE': die ICU-Daten unterscheiden sich je nach Node-/Browser-Version
 * (schmales geschuetztes Leerzeichen vor Einheiten, wechselnde
 * Wochentagskuerzel), was Snapshots, Tests und CSV-Exporte unzuverlaessig
 * macht. Die hier erzeugten Schreibweisen folgen der deutschen Konvention:
 * Komma als Dezimaltrennzeichen, Punkt als Tausendertrennzeichen.
 *
 * Datumsangaben werden in der lokalen Zeitzone des Browsers ausgegeben -
 * dieselbe Sicht, in der die Planung ihre Uhrzeiten berechnet.
 */
import type { TimeWindow } from '@/types/domain'

/** Halbgeviertstrich: Platzhalter fuer fehlende Werte und Trenner in Bereichen. */
const DASH = '–'
const MINUTES_PER_DAY = 1440

export const WEEKDAYS_SHORT: readonly string[] = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

export const WEEKDAYS_LONG: readonly string[] = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
]

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** Tausenderpunkte in eine reine Ziffernfolge einziehen. */
function groupDigits(digits: string): string {
  // Ab 1e21 liefert toString/toFixed Exponentialschreibweise ("1e+21"). Dort
  // ergaeben Tausenderpunkte Unsinn, also bleibt die Zeichenkette unangetastet.
  if (!/^\d+$/.test(digits)) return digits
  let out = ''
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.'
    out += digits[i]
  }
  return out
}

function formatInteger(value: number): string {
  const rounded = Math.round(value)
  const sign = rounded < 0 ? '-' : ''
  return sign + groupDigits(Math.abs(rounded).toString())
}

function formatDecimal(value: number, digits: number): string {
  const fixed = Math.abs(value).toFixed(digits)
  // Kein Vorzeichen, wenn das Runden alles auf Null zieht ("-0,0").
  const sign = value < 0 && /[1-9]/.test(fixed) ? '-' : ''
  const dot = fixed.indexOf('.')
  if (dot === -1) return sign + groupDigits(fixed)
  return `${sign}${groupDigits(fixed.slice(0, dot))},${fixed.slice(dot + 1)}`
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

/** Wochentag nach ISO-8601: 1 = Montag ... 7 = Sonntag. */
function isoDayOfWeek(date: Date): number {
  const day = date.getDay()
  return day === 0 ? 7 : day
}

/** Gemeinsame Ausgabe fuer Dauern in vollen Minuten. */
function joinHoursMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${formatInteger(minutes)} Min.`
  if (minutes === 0) return `${formatInteger(hours)} Std.`
  return `${formatInteger(hours)} Std. ${formatInteger(minutes)} Min.`
}

/** Fahrzeiten aus dem Routing kommen in Sekunden. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 Min.'
  if (seconds < 60) return '< 1 Min.'
  return joinHoursMinutes(Math.round(seconds / 60))
}

/** Service-, Warte- und Pufferzeiten werden in Minuten gepflegt. */
export function formatMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '0 Min.'
  return joinHoursMinutes(Math.round(min))
}

/** Unter 1 km metergenau, darueber in Kilometern mit einer Nachkommastelle. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m'
  const rounded = Math.round(meters)
  if (rounded < 1000) return `${formatInteger(rounded)} m`
  return `${formatDecimal(meters / 1000, 1)} km`
}

export function formatTime(d: Date | null): string {
  if (!isValidDate(d)) return DASH
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function formatDateShort(d: Date | null): string {
  if (!isValidDate(d)) return DASH
  const year = String(d.getFullYear()).padStart(4, '0')
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${year}`
}

export function formatDateTime(d: Date | null): string {
  if (!isValidDate(d)) return DASH
  const weekday = WEEKDAYS_SHORT[isoDayOfWeek(d) - 1]
  return `${weekday}., ${formatDateShort(d)}, ${formatTime(d)}`
}

/** Erlaubt "H:MM", "HH:MM" und "HH:MM:SS"; Sekunden werden verworfen. */
const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::\d{2})?$/

/**
 * "08:30" -> 510. Alles ausserhalb von 00:00 bis 23:59 gilt als ungueltig,
 * auch das gelegentlich als Tagesende genutzte "24:00".
 */
export function parseTimeToMinutes(hhmm: string): number | null {
  if (typeof hhmm !== 'string') return null
  const match = TIME_PATTERN.exec(hhmm.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** 510 -> "08:30". Werte ausserhalb eines Tages werden auf 24 h normalisiert. */
export function minutesToTime(min: number): string {
  if (!Number.isFinite(min)) return '00:00'
  const normalized = ((Math.round(min) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`
}

interface DaySpan {
  from: string
  to: string
  sortKey: number
}

/** Uhrzeit auf "HH:MM" vereinheitlichen; unlesbare Werte bleiben unveraendert. */
function canonicalTime(raw: string): string {
  const minutes = parseTimeToMinutes(raw)
  return minutes === null ? raw.trim() : minutesToTime(minutes)
}

function spanLabel(span: DaySpan): string {
  return `${span.from}${DASH}${span.to}`
}

/**
 * "Mo–Fr 08:00–17:00, Sa 09:00–13:00".
 *
 * Nur unmittelbar aufeinanderfolgende Wochentage mit identischen Zeiten
 * werden zu einem Bereich zusammengefasst; die Woche beginnt am Montag und
 * wird zwischen Sonntag und Montag nicht umgebrochen. Mehrere Fenster
 * desselben Tages werden mit "u." verbunden, damit das Komma eindeutig die
 * Gruppen trennt.
 */
export function formatTimeWindows(windows: readonly TimeWindow[]): string {
  const perDay = new Map<number, DaySpan[]>()
  for (const window of windows) {
    if (!window) continue
    const dow = window.dow
    if (!Number.isInteger(dow) || dow < 1 || dow > 7) continue
    // time_windows kommt als JSONB aus der Datenbank: fehlende Felder wuerden
    // sonst als "undefined" in der Oberflaeche landen.
    if (typeof window.from !== 'string' || typeof window.to !== 'string') continue
    const from = canonicalTime(window.from)
    const to = canonicalTime(window.to)
    if (from === '' || to === '') continue
    const spans = perDay.get(dow) ?? []
    if (spans.some((span) => span.from === from && span.to === to)) continue
    spans.push({ from, to, sortKey: parseTimeToMinutes(from) ?? Number.MAX_SAFE_INTEGER })
    perDay.set(dow, spans)
  }

  const entries: Array<{ dow: number; label: string }> = []
  for (let dow = 1; dow <= 7; dow += 1) {
    const spans = perDay.get(dow)
    if (!spans || spans.length === 0) continue
    const sorted = [...spans].sort((a, b) => (a.sortKey - b.sortKey) || spanLabel(a).localeCompare(spanLabel(b)))
    entries.push({ dow, label: sorted.map(spanLabel).join(' u. ') })
  }
  if (entries.length === 0) return 'jederzeit'

  const parts: string[] = []
  let start = 0
  while (start < entries.length) {
    let end = start
    while (
      end + 1 < entries.length &&
      entries[end + 1].dow === entries[end].dow + 1 &&
      entries[end + 1].label === entries[start].label
    ) {
      end += 1
    }
    const firstDay = WEEKDAYS_SHORT[entries[start].dow - 1]
    const days = end === start ? firstDay : `${firstDay}${DASH}${WEEKDAYS_SHORT[entries[end].dow - 1]}`
    parts.push(`${days} ${entries[start].label}`)
    start = end + 1
  }
  return parts.join(', ')
}

function formatCount(count: number): string {
  if (!Number.isFinite(count)) return '0'
  return Number.isInteger(count) ? formatInteger(count) : formatDecimal(count, 1)
}

/** "1 Standort" / "3 Standorte" - die Zahl ist Teil der Ausgabe. */
export function pluralize(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`
}

interface RelativeUnit {
  value: number
  one: string
  many: string
}

function relativeUnit(seconds: number): RelativeUnit {
  if (seconds < 3600) {
    return { value: Math.max(1, Math.floor(seconds / 60)), one: 'Minute', many: 'Minuten' }
  }
  if (seconds < 86400) {
    return { value: Math.floor(seconds / 3600), one: 'Stunde', many: 'Stunden' }
  }
  const days = Math.floor(seconds / 86400)
  if (days < 7) return { value: days, one: 'Tag', many: 'Tagen' }
  if (days < 35) return { value: Math.floor(days / 7), one: 'Woche', many: 'Wochen' }
  const months = Math.floor(days / 30)
  if (months < 12) return { value: months, one: 'Monat', many: 'Monaten' }
  return { value: Math.max(1, Math.floor(days / 365)), one: 'Jahr', many: 'Jahren' }
}

/**
 * "vor 5 Minuten", "in 2 Tagen", "gerade eben". `now` wird uebergeben, damit
 * die Funktion rein bleibt und Tests einen festen Bezugspunkt setzen koennen.
 */
export function formatRelativeTime(d: Date | null, now: Date | null): string {
  if (!isValidDate(d) || !isValidDate(now)) return DASH
  const diffMs = now.getTime() - d.getTime()
  const seconds = Math.abs(diffMs) / 1000
  if (seconds < 45) return 'gerade eben'
  const unit = relativeUnit(seconds)
  const label = `${formatInteger(unit.value)} ${unit.value === 1 ? unit.one : unit.many}`
  return diffMs >= 0 ? `vor ${label}` : `in ${label}`
}
