/**
 * CSV-Export und -Import. Das Ausgabeformat ist auf deutsches Excel
 * abgestimmt: Semikolon als Trennzeichen, Komma als Dezimaltrennzeichen und
 * ein vorangestelltes BOM, damit Excel die Datei als UTF-8 erkennt.
 * Der Import ist bewusst toleranter als der Export.
 */
import type { Category, Group, MapLocation } from '@/types/domain'
import { isValidLatLng } from '@/lib/geo'
import type { ImportResult, ParsedLocation } from './geojson'
import {
  categoryNameIndex,
  formatTimeWindows,
  normalizeKey,
  parseBooleanish,
  parseNumberLoose,
  parseTimeWindows,
  splitList,
} from './geojson'

export const CSV_BOM = '\uFEFF'

export const CSV_HEADER: readonly string[] = [
  'Name',
  'Kategorie',
  'Gruppen',
  'Breite',
  'Laenge',
  'Adresse',
  'Notizen',
  'Tags',
  'Aufenthalt (min)',
  'Aktiv',
  'Zeitfenster',
  'Symbol',
]

const DELIMITER = ';'
const NEWLINE = '\r\n'
/** Trennzeichen innerhalb einer Zelle (Gruppen, Tags, Zeitfenster). */
const LIST_SEPARATOR = '|'
const DELIMITER_CANDIDATES = [';', ',', '\t']

/** Dezimaltrennzeichen Komma (deutsches Excel), ohne Genauigkeitsverlust. */
function formatNumber(value: number): string {
  return String(value).replace('.', ',')
}

function escapeCsv(value: string): string {
  if (/["\r\n]/.test(value) || value.includes(DELIMITER)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** Standorte als CSV-Text mit BOM, Semikolon und CRLF. */
export function toCsv(
  locations: readonly MapLocation[],
  categories: readonly Category[],
  groupsByLocation: ReadonlyMap<string, Group[]>,
): string {
  const categoryNames = categoryNameIndex(categories)
  const lines: string[] = [CSV_HEADER.map(escapeCsv).join(DELIMITER)]
  for (const location of locations) {
    const groups = (groupsByLocation.get(location.id) ?? []).map((group) => group.name)
    const categoryName = location.category_id === null
      ? ''
      : categoryNames.get(location.category_id) ?? ''
    const cells = [
      location.name,
      categoryName,
      groups.join(LIST_SEPARATOR),
      formatNumber(location.lat),
      formatNumber(location.lng),
      location.address ?? '',
      location.notes ?? '',
      location.tags.join(LIST_SEPARATOR),
      formatNumber(location.service_minutes),
      location.is_active ? 'ja' : 'nein',
      formatTimeWindows(location.time_windows),
      location.icon ?? '',
    ]
    lines.push(cells.map(escapeCsv).join(DELIMITER))
  }
  return CSV_BOM + lines.join(NEWLINE) + NEWLINE
}

interface CsvRecord {
  fields: string[]
  /** Physische Zeile, in der der Datensatz beginnt (1-basiert). */
  line: number
}

/**
 * Trennzeichen anhand der Kopfzeile raten; Anfuehrungszeichen werden
 * uebersprungen. Ein Anfuehrungszeichen zaehlt - genau wie im Zerleger - nur
 * am Feldanfang als solches. Sonst wuerde ein einzelnes Zoll-Zeichen in der
 * Kopfzeile ("12\" Rampe") den Rest der Zeile verschlucken und das Trennzeichen
 * der ganzen Datei falsch raten.
 */
function detectDelimiter(text: string): string {
  const counts = new Map<string, number>()
  for (const candidate of DELIMITER_CANDIDATES) counts.set(candidate, 0)
  let inQuotes = false
  let atFieldStart = true
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') i += 1
        else inQuotes = false
      }
      continue
    }
    if (char === '"' && atFieldStart) {
      inQuotes = true
      atFieldStart = false
      continue
    }
    if (char === '\n' || char === '\r') break
    const seen = counts.get(char)
    if (seen !== undefined) {
      counts.set(char, seen + 1)
      atFieldStart = true
      continue
    }
    atFieldStart = false
  }
  let best = DELIMITER
  let bestCount = 0
  for (const candidate of DELIMITER_CANDIDATES) {
    const count = counts.get(candidate) ?? 0
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

/**
 * Eigener Zerleger: beherrscht Anfuehrungszeichen, verdoppelte
 * Anfuehrungszeichen und Zeilenumbrueche innerhalb eines Feldes.
 */
function parseRecords(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = []
  let fields: string[] = []
  let field = ''
  let inQuotes = false
  let line = 1
  let recordLine = 1
  let started = false

  const endRecord = () => {
    fields.push(field)
    records.push({ fields, line: recordLine })
    fields = []
    field = ''
    started = false
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
        continue
      }
      if (char === '\r') {
        // Zeilenumbrueche im Feld einheitlich als \n ablegen.
        if (text[i + 1] === '\n') continue
        field += '\n'
        line += 1
        continue
      }
      if (char === '\n') line += 1
      field += char
      continue
    }
    if (char === '"' && field === '') {
      inQuotes = true
      started = true
      continue
    }
    if (char === delimiter) {
      fields.push(field)
      field = ''
      started = true
      continue
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      endRecord()
      line += 1
      recordLine = line
      continue
    }
    field += char
    started = true
  }
  if (started || field !== '' || fields.length > 0) endRecord()
  return records
}

interface ColumnMap {
  name?: number
  category?: number
  groups?: number
  lat?: number
  lng?: number
  address?: number
  notes?: number
  tags?: number
  serviceMinutes?: number
  active?: number
  timeWindows?: number
  icon?: number
}

const COLUMN_ALIASES: [keyof ColumnMap, string[]][] = [
  ['name', ['name', 'bezeichnung', 'titel', 'title', 'label', 'standort']],
  ['category', ['kategorie', 'category', 'kategoriename', 'categoryname']],
  ['groups', ['gruppen', 'gruppe', 'groups', 'group', 'groupnames']],
  ['lat', ['breite', 'breitengrad', 'lat', 'latitude', 'geobreite']],
  ['lng', ['laenge', 'laengengrad', 'lng', 'lon', 'long', 'longitude', 'geolaenge']],
  ['address', ['adresse', 'anschrift', 'address']],
  ['notes', ['notizen', 'notiz', 'notes', 'note', 'bemerkung', 'bemerkungen', 'kommentar', 'beschreibung', 'description']],
  ['tags', ['tags', 'tag', 'schlagworte', 'schlagwoerter', 'stichworte', 'labels']],
  ['serviceMinutes', ['aufenthaltmin', 'aufenthaltminuten', 'aufenthalt', 'aufenthaltsdauer', 'serviceminutes', 'servicetime', 'standzeit', 'dauer']],
  ['active', ['aktiv', 'active', 'isactive']],
  ['timeWindows', ['zeitfenster', 'timewindows', 'oeffnungszeiten', 'openinghours', 'zeiten']],
  ['icon', ['symbol', 'icon', 'kartensymbol']],
]

/** Spalten anhand der Kopfzeile zuordnen, unabhaengig von Schreibweise und Umlauten. */
function mapColumns(header: readonly string[]): ColumnMap {
  const columns: ColumnMap = {}
  header.forEach((cell, index) => {
    const key = normalizeKey(cell)
    if (key === '') return
    for (const [target, aliases] of COLUMN_ALIASES) {
      if (columns[target] === undefined && aliases.includes(key)) {
        columns[target] = index
        return
      }
    }
  })
  return columns
}

function hasContent(record: CsvRecord): boolean {
  return record.fields.some((cell) => cell.trim() !== '')
}

/** Liest CSV/TSV mit automatisch erkanntem Trennzeichen; fehlerhafte Zeilen werden gemeldet. */
export function parseCsv(text: string): ImportResult {
  const rows: ParsedLocation[] = []
  const errors: string[] = []
  const content = text.replace(/^\uFEFF/, '')
  if (content.trim() === '') return { rows, errors: ['Die Datei ist leer.'] }

  const delimiter = detectDelimiter(content)
  const records = parseRecords(content, delimiter).filter(hasContent)
  if (records.length === 0) return { rows, errors: ['Die Datei ist leer.'] }

  const header = records[0]
  const columns = mapColumns(header.fields)
  const missing: string[] = []
  if (columns.name === undefined) missing.push('Name')
  if (columns.lat === undefined) missing.push('Breite')
  if (columns.lng === undefined) missing.push('Laenge')
  if (missing.length > 0) {
    const list = missing.map((entry) => `"${entry}"`).join(', ')
    errors.push(`Die Kopfzeile enthaelt keine Spalte fuer ${list}.`)
    return { rows, errors }
  }
  if (records.length === 1) {
    errors.push('Die Datei enthaelt ausser der Kopfzeile keine Daten.')
    return { rows, errors }
  }

  const columnCount = header.fields.length
  for (let i = 1; i < records.length; i += 1) {
    const record = records[i]
    const at = `Zeile ${record.line}`
    if (record.fields.length !== columnCount) {
      errors.push(`${at}: ${record.fields.length} Felder gefunden, erwartet wurden ${columnCount}.`)
      continue
    }
    const cell = (index: number | undefined): string =>
      index === undefined ? '' : record.fields[index].trim()

    const name = cell(columns.name)
    if (name === '') {
      errors.push(`${at}: Der Name fehlt.`)
      continue
    }
    const latText = cell(columns.lat)
    const lngText = cell(columns.lng)
    if (latText === '' || lngText === '') {
      errors.push(`${at}: Breite oder Laenge fehlt.`)
      continue
    }
    const lat = parseNumberLoose(latText)
    const lng = parseNumberLoose(lngText)
    if (lat === null || lng === null || !isValidLatLng({ lat, lng })) {
      errors.push(`${at}: Ungueltige Koordinaten ("${latText}" / "${lngText}").`)
      continue
    }

    let serviceMinutes = 0
    const serviceText = cell(columns.serviceMinutes)
    if (serviceText !== '') {
      const parsed = parseNumberLoose(serviceText)
      if (parsed === null || parsed < 0) {
        errors.push(`${at}: Ungueltige Aufenthaltsdauer "${serviceText}".`)
        continue
      }
      serviceMinutes = parsed
    }

    let isActive = true
    const activeText = cell(columns.active)
    if (activeText !== '') {
      const parsed = parseBooleanish(activeText)
      if (parsed === null) {
        errors.push(`${at}: Unbekannter Wert fuer "Aktiv": "${activeText}".`)
        continue
      }
      isActive = parsed
    }

    const windowsText = cell(columns.timeWindows)
    const timeWindows = parseTimeWindows(windowsText)
    if (timeWindows === null) {
      errors.push(`${at}: Zeitfenster "${windowsText}" konnten nicht gelesen werden.`)
      continue
    }

    const row: ParsedLocation = {
      name,
      lat,
      lng,
      tags: splitList(cell(columns.tags)),
      serviceMinutes,
      timeWindows,
      groupNames: splitList(cell(columns.groups)),
      isActive,
    }
    const address = cell(columns.address)
    if (address !== '') row.address = address
    const notes = cell(columns.notes)
    if (notes !== '') row.notes = notes
    const categoryName = cell(columns.category)
    if (categoryName !== '') row.categoryName = categoryName
    const icon = cell(columns.icon)
    if (icon !== '') row.icon = icon
    rows.push(row)
  }

  return { rows, errors }
}
