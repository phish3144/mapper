/**
 * GeoJSON-Export und -Import fuer Standorte.
 *
 * In diesem Modul liegen zusaetzlich die gemeinsamen Wertkonvertierungen des
 * Datenaustauschs (Zeitfenster, Listen, Ja/Nein, Zahlen). GeoJSON- und
 * CSV-Import muessen dieselben Schreibweisen akzeptieren; da der Austausch nur
 * aus diesen beiden Modulen besteht, ist hier der gemeinsame Ort dafuer.
 */
import type { Category, Group, MapLocation, TimeWindow } from '@/types/domain'
import { isValidLatLng } from '@/lib/geo'

/** Ein aus einer Datei gelesener Standort, noch ohne Bezug zur Datenbank. */
export interface ParsedLocation {
  name: string
  lat: number
  lng: number
  address?: string
  notes?: string
  tags: string[]
  serviceMinutes: number
  timeWindows: TimeWindow[]
  categoryName?: string
  groupNames: string[]
  isActive: boolean
}

/** Ergebnis eines Imports: verwertbare Zeilen und Meldungen zu den uebrigen. */
export interface ImportResult {
  rows: ParsedLocation[]
  errors: string[]
}

export interface GeoJsonTimeWindow {
  dow: number
  von: string
  bis: string
}

export interface GeoJsonLocationProperties {
  name: string
  kategorie: string | null
  gruppen: string[]
  adresse: string | null
  notizen: string | null
  tags: string[]
  aufenthalt_minuten: number
  aktiv: boolean
  zeitfenster: GeoJsonTimeWindow[]
}

export interface GeoJsonPointFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: GeoJsonLocationProperties
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonPointFeature[]
}

const DOW_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

/** ISO-Wochentage (1 = Montag ... 7 = Sonntag) unter allen gaengigen Schreibweisen. */
const DOW_BY_NAME: Record<string, number> = {
  mo: 1, mon: 1, montag: 1, monday: 1,
  di: 2, die: 2, dienstag: 2, tue: 2, tues: 2, tuesday: 2,
  mi: 3, mit: 3, mittwoch: 3, wed: 3, wednesday: 3,
  do: 4, don: 4, donnerstag: 4, thu: 4, thurs: 4, thursday: 4,
  fr: 5, fre: 5, freitag: 5, fri: 5, friday: 5,
  sa: 6, sam: 6, samstag: 6, sonnabend: 6, sat: 6, saturday: 6,
  so: 7, son: 7, sonntag: 7, sun: 7, sunday: 7,
}

const TRUE_WORDS = new Set(['ja', 'j', 'true', 'wahr', 'x', 'yes', 'y', 'aktiv', '1'])
const FALSE_WORDS = new Set(['nein', 'n', 'false', 'falsch', 'no', 'inaktiv', '0'])

const CLOCK = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/
/** "Mo 08:00-12:00", "1 8:00 bis 12:00", "Montag 08:00 – 12:00". */
const TIME_WINDOW = /^(.+?)[\s:]+(\d{1,2}[:.]\d{2}(?::\d{2})?)\s*(?:-|–|—|bis)\s*(\d{1,2}[:.]\d{2}(?::\d{2})?)$/i

/** Vergleichsform fuer Schluessel und Woerter: klein, ohne Umlaute und Sonderzeichen. */
export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '')
}

/** Zahl aus Text mit Komma ODER Punkt als Dezimaltrennzeichen. */
export function parseNumberLoose(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  let text = value.trim().replace(/\s/g, '')
  if (text === '') return null
  if (text.includes(',') && text.includes('.')) {
    // Beide Zeichen vorhanden: das hintere ist das Dezimaltrennzeichen.
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '')
  } else {
    text = text.replace(',', '.')
  }
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/** Ja/Nein in allen ueblichen Schreibweisen; null, wenn unverstaendlich. */
export function parseBooleanish(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value !== 'string') return null
  const word = normalizeKey(value)
  if (word === '') return null
  if (TRUE_WORDS.has(word)) return true
  if (FALSE_WORDS.has(word)) return false
  return null
}

/** Liste aus Array oder aus einem mit | ; , oder Zeilenumbruch getrennten Text. */
export function splitList(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== null && entry !== undefined)
      .map((entry) => String(entry).trim())
      .filter((entry) => entry !== '')
  }
  if (typeof value === 'number') return [String(value)]
  if (typeof value !== 'string') return []
  return value
    .split(/[|;,\n\r]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

function parseDow(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return null
    if (value === 0) return 7
    return value >= 1 && value <= 7 ? value : null
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  if (/^\d+$/.test(text)) return parseDow(Number(text))
  const found = DOW_BY_NAME[normalizeKey(text)]
  return found === undefined ? null : found
}

/** Uhrzeit auf "HH:MM" normieren; Sekunden werden verworfen. */
function parseClockText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = CLOCK.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function parseTimeWindowText(value: string): TimeWindow | null {
  const match = TIME_WINDOW.exec(value.trim())
  if (!match) return null
  const dow = parseDow(match[1])
  const from = parseClockText(match[2])
  const to = parseClockText(match[3])
  if (dow === null || from === null || to === null) return null
  return { dow, from, to }
}

function parseTimeWindowObject(value: unknown): TimeWindow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const fields = normalizeRecord(value as Record<string, unknown>)
  const dow = parseDow(pick(fields, ['dow', 'tag', 'wochentag', 'day', 'weekday']))
  const from = parseClockText(pickText(fields, ['von', 'from', 'start', 'beginn', 'ab']))
  const to = parseClockText(pickText(fields, ['bis', 'to', 'ende', 'end']))
  if (dow === null || from === null || to === null) return null
  return { dow, from, to }
}

/**
 * Zeitfenster aus Text ("Mo 08:00-12:00|Di 09:00-17:00") oder aus einem Array
 * von Objekten bzw. Texten. Gibt null zurueck, sobald ein Eintrag unlesbar ist.
 */
export function parseTimeWindows(value: unknown): TimeWindow[] | null {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') {
    const entries = value
      .split(/[|;\n\r]+|,(?![^,]*\d{1,2}[:.]\d{2}\s*$)/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
    const windows: TimeWindow[] = []
    for (const entry of entries) {
      const parsed = parseTimeWindowText(entry)
      if (!parsed) return null
      windows.push(parsed)
    }
    return windows
  }
  if (Array.isArray(value)) {
    const windows: TimeWindow[] = []
    for (const entry of value) {
      const parsed = typeof entry === 'string'
        ? parseTimeWindowText(entry)
        : parseTimeWindowObject(entry)
      if (!parsed) return null
      windows.push(parsed)
    }
    return windows
  }
  return null
}

/** Textform der Zeitfenster fuer CSV: "Mo 08:00-12:00|Di 09:00-17:00". */
export function formatTimeWindows(windows: readonly TimeWindow[]): string {
  return windows
    .map((window) => {
      const day = window.dow >= 1 && window.dow <= 7
        ? DOW_SHORT[window.dow - 1]
        : String(window.dow)
      return `${day} ${window.from}-${window.to}`
    })
    .join('|')
}

/** Nachschlagetabelle Kategorie-Id zu Kategoriename. */
export function categoryNameIndex(categories: readonly Category[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const category of categories) index.set(category.id, category.name)
  return index
}

function normalizeRecord(source: Record<string, unknown>): Map<string, unknown> {
  const normalized = new Map<string, unknown>()
  for (const [key, value] of Object.entries(source)) {
    const cleanKey = normalizeKey(key)
    if (!normalized.has(cleanKey)) normalized.set(cleanKey, value)
  }
  return normalized
}

function pick(source: Map<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = source.get(key)
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function pickText(source: Map<string, unknown>, keys: readonly string[]): string {
  const value = pick(source, keys)
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

const NAME_KEYS = ['name', 'bezeichnung', 'titel', 'title', 'label', 'standort']
const CATEGORY_KEYS = ['kategorie', 'category', 'kategoriename', 'categoryname']
const GROUP_KEYS = ['gruppen', 'gruppe', 'groups', 'group', 'groupnames']
const ADDRESS_KEYS = ['adresse', 'anschrift', 'address']
const NOTES_KEYS = ['notizen', 'notiz', 'notes', 'note', 'bemerkung', 'bemerkungen', 'kommentar', 'beschreibung', 'description']
const TAG_KEYS = ['tags', 'tag', 'schlagworte', 'schlagwoerter', 'stichworte', 'labels']
const SERVICE_KEYS = ['aufenthaltminuten', 'aufenthaltmin', 'aufenthalt', 'aufenthaltsdauer', 'serviceminutes', 'servicetime', 'standzeit', 'dauer']
const ACTIVE_KEYS = ['aktiv', 'active', 'isactive']
const WINDOW_KEYS = ['zeitfenster', 'timewindows', 'oeffnungszeiten', 'openinghours', 'zeiten']

/** FeatureCollection mit Punkt-Geometrien in GeoJSON-Reihenfolge [lng, lat]. */
export function locationsToGeoJson(
  locations: readonly MapLocation[],
  categories: readonly Category[],
  groupsByLocation: ReadonlyMap<string, Group[]>,
): GeoJsonFeatureCollection {
  const categoryNames = categoryNameIndex(categories)
  return {
    type: 'FeatureCollection',
    features: locations.map((location) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
      properties: {
        name: location.name,
        kategorie: location.category_id === null
          ? null
          : categoryNames.get(location.category_id) ?? null,
        gruppen: (groupsByLocation.get(location.id) ?? []).map((group) => group.name),
        adresse: location.address,
        notizen: location.notes,
        tags: [...location.tags],
        aufenthalt_minuten: location.service_minutes,
        aktiv: location.is_active,
        zeitfenster: location.time_windows.map((window) => ({
          dow: window.dow,
          von: window.from,
          bis: window.to,
        })),
      },
    })),
  }
}

type FeatureOutcome = { ok: true; row: ParsedLocation } | { ok: false; error: string }

function collectFeatures(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data
  if (typeof data !== 'object' || data === null) return null
  const root = data as Record<string, unknown>
  const type = typeof root.type === 'string' ? root.type.toLowerCase() : ''
  if (type === 'featurecollection') {
    return Array.isArray(root.features) ? root.features : []
  }
  if (type === 'feature' || root.geometry !== undefined) return [data]
  return null
}

function parseFeature(feature: unknown, label: string): FeatureOutcome {
  if (typeof feature !== 'object' || feature === null || Array.isArray(feature)) {
    return { ok: false, error: `${label}: Kein gueltiges Feature-Objekt.` }
  }
  const source = feature as Record<string, unknown>
  const geometry = source.geometry
  if (typeof geometry !== 'object' || geometry === null || Array.isArray(geometry)) {
    return { ok: false, error: `${label}: Die Geometrie fehlt.` }
  }
  const geo = geometry as Record<string, unknown>
  const geoType = typeof geo.type === 'string' ? geo.type.toLowerCase() : ''
  if (geoType !== 'point') {
    return { ok: false, error: `${label}: Nur Punkt-Geometrien werden unterstuetzt (gefunden: "${String(geo.type)}").` }
  }
  const coordinates = geo.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return { ok: false, error: `${label}: Die Koordinaten fehlen oder sind unvollstaendig.` }
  }
  const first = parseNumberLoose(coordinates[0])
  const second = parseNumberLoose(coordinates[1])
  if (first === null || second === null) {
    return { ok: false, error: `${label}: Die Koordinaten sind keine Zahlen.` }
  }
  // GeoJSON schreibt [lng, lat] vor. Nur wenn diese Lesart unmoeglich ist, die
  // umgekehrte aber gueltig waere, wird getauscht (Wert ueber 90 kann keine
  // geografische Breite sein).
  let lng = first
  let lat = second
  if (!isValidLatLng({ lat, lng }) && isValidLatLng({ lat: first, lng: second })) {
    lat = first
    lng = second
  }
  if (!isValidLatLng({ lat, lng })) {
    return { ok: false, error: `${label}: Ungueltige Koordinaten (${first} / ${second}).` }
  }

  const rawProperties = source.properties
  const properties = normalizeRecord(
    typeof rawProperties === 'object' && rawProperties !== null && !Array.isArray(rawProperties)
      ? (rawProperties as Record<string, unknown>)
      : {},
  )

  const name = pickText(properties, NAME_KEYS)
  if (name === '') return { ok: false, error: `${label}: Der Name fehlt.` }

  let serviceMinutes = 0
  const rawService = pick(properties, SERVICE_KEYS)
  if (rawService !== undefined && String(rawService).trim() !== '') {
    const parsed = parseNumberLoose(rawService)
    if (parsed === null || parsed < 0) {
      return { ok: false, error: `${label}: Ungueltige Aufenthaltsdauer "${String(rawService)}".` }
    }
    serviceMinutes = parsed
  }

  let isActive = true
  const rawActive = pick(properties, ACTIVE_KEYS)
  if (rawActive !== undefined && String(rawActive).trim() !== '') {
    const parsed = parseBooleanish(rawActive)
    if (parsed === null) {
      return { ok: false, error: `${label}: Unbekannter Wert fuer "aktiv": "${String(rawActive)}".` }
    }
    isActive = parsed
  }

  const timeWindows = parseTimeWindows(pick(properties, WINDOW_KEYS))
  if (timeWindows === null) {
    return { ok: false, error: `${label}: Die Zeitfenster konnten nicht gelesen werden.` }
  }

  const row: ParsedLocation = {
    name,
    lat,
    lng,
    tags: splitList(pick(properties, TAG_KEYS)),
    serviceMinutes,
    timeWindows,
    groupNames: splitList(pick(properties, GROUP_KEYS)),
    isActive,
  }
  const address = pickText(properties, ADDRESS_KEYS)
  if (address !== '') row.address = address
  const notes = pickText(properties, NOTES_KEYS)
  if (notes !== '') row.notes = notes
  const categoryName = pickText(properties, CATEGORY_KEYS)
  if (categoryName !== '') row.categoryName = categoryName
  return { ok: true, row }
}

/**
 * Liest eine FeatureCollection oder ein einzelnes Feature. Unbrauchbare
 * Features werden gesammelt gemeldet, der Rest wird uebernommen.
 */
export function parseGeoJson(text: string): ImportResult {
  const rows: ParsedLocation[] = []
  const errors: string[] = []
  const content = text.replace(/^﻿/, '').trim()
  if (content === '') return { rows, errors: ['Die Datei ist leer.'] }

  let data: unknown
  try {
    data = JSON.parse(content)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { rows, errors: [`Die Datei enthaelt kein gueltiges JSON: ${reason}`] }
  }

  const features = collectFeatures(data)
  if (features === null) {
    return {
      rows,
      errors: ['Unerwarteter Aufbau: erwartet wird eine FeatureCollection oder ein einzelnes Feature.'],
    }
  }
  if (features.length === 0) {
    return { rows, errors: ['Die Datei enthaelt keine Features.'] }
  }

  features.forEach((feature, index) => {
    const outcome = parseFeature(feature, `Feature ${index + 1}`)
    if (outcome.ok) rows.push(outcome.row)
    else errors.push(outcome.error)
  })
  return { rows, errors }
}
