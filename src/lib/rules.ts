/**
 * Regelbasiertes Fuellen von Routen (routes.mode === 'rule').
 *
 * Die Regel liegt in der Datenbank als jsonb und kann deshalb beliebigen Inhalt
 * haben. Jede exportierte Funktion normalisiert ihre Eingabe zuerst, damit
 * Auswahl und Beschreibung immer dieselbe Sicht auf die Regel haben.
 */
import type { Category, Group, LatLng, MapLocation, RouteRule } from '@/types/domain'
import { haversineKm, isValidLatLng, withinRadius } from '@/lib/geo'

/** RouteRule mit ausgefuellten Vorgaben - erspart den Aufrufern jedes `?? []`. */
interface NormalizedRule {
  categoryIds: string[]
  groupIds: string[]
  tags: string[]
  tagMatch: 'any' | 'all'
  center: LatLng | null
  radiusKm: number | null
  onlyActive: boolean
  maxStops: number | null
}

function emptyRule(): NormalizedRule {
  return {
    categoryIds: [],
    groupIds: [],
    tags: [],
    tagMatch: 'any',
    center: null,
    radiusKm: null,
    onlyActive: true,
    maxStops: null,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** Getrimmte, eindeutige Kennungen; alles andere faellt weg. */
function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Wie idList, aber doppelte Tags fallen unabhaengig von der Schreibweise weg. */
function tagList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const tag = entry.trim()
    if (tag === '') continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Ganzzahlige Obergrenze >= 1; alles andere bedeutet "keine Begrenzung". */
function stopLimit(value: unknown): number | null {
  const n = positiveNumber(value)
  if (n === null) return null
  const floored = Math.floor(n)
  return floored >= 1 ? floored : null
}

function normalize(value: unknown): NormalizedRule {
  const raw = asRecord(value)
  if (!raw) return emptyRule()
  const center = raw.center
  return {
    categoryIds: idList(raw.categoryIds),
    groupIds: idList(raw.groupIds),
    tags: tagList(raw.tags),
    tagMatch: raw.tagMatch === 'all' ? 'all' : 'any',
    center: isValidLatLng(center) ? { lat: center.lat, lng: center.lng } : null,
    radiusKm: positiveNumber(raw.radiusKm),
    onlyActive: typeof raw.onlyActive === 'boolean' ? raw.onlyActive : true,
    maxStops: stopLimit(raw.maxStops),
  }
}

/**
 * Baut aus einem jsonb-Wert eine gueltige Regel. Unbekannte Felder und Werte mit
 * falschem Typ werden verworfen, fehlende Felder erhalten ihre Vorgabe.
 */
export function normalizeRule(rule: unknown): RouteRule {
  return normalize(rule)
}

/** Umkreissuche greift nur, wenn Mittelpunkt und Radius zusammen vorliegen. */
function hasRadiusFilter(rule: NormalizedRule): boolean {
  return rule.center !== null && rule.radiusKm !== null
}

/**
 * `onlyActive` zaehlt hier bewusst nicht mit: `true` ist die Vorgabe und `false`
 * schraenkt nichts ein - eine Regel, die nur daran ruehrt, waehlt weiterhin alles.
 */
function isEmpty(rule: NormalizedRule): boolean {
  return (
    rule.categoryIds.length === 0 &&
    rule.groupIds.length === 0 &&
    rule.tags.length === 0 &&
    rule.maxStops === null &&
    !hasRadiusFilter(rule)
  )
}

/** True, wenn die Regel die Auswahl nicht einschraenkt. */
export function isEmptyRule(rule: RouteRule): boolean {
  return isEmpty(normalize(rule))
}

function matchesTags(locationTags: string[], wanted: string[], mode: 'any' | 'all'): boolean {
  const own = new Set(locationTags.map((tag) => tag.trim().toLowerCase()))
  if (mode === 'all') return wanted.every((tag) => own.has(tag))
  return wanted.some((tag) => own.has(tag))
}

/** Name zuerst, danach die Kennung - damit Gleichstaende nicht von der Eingabereihenfolge abhaengen. */
function compareByName(a: MapLocation, b: MapLocation): number {
  const byName = a.name.localeCompare(b.name, 'de', { numeric: true })
  if (byName !== 0) return byName
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

function sortByDistance(items: MapLocation[], center: LatLng): MapLocation[] {
  const decorated = items.map((location) => {
    const km = haversineKm(center, { lat: location.lat, lng: location.lng })
    // Unbrauchbare Koordinaten wandern ans Ende, statt die Sortierung zu zerlegen.
    return { location, km: Number.isFinite(km) ? km : Number.POSITIVE_INFINITY }
  })
  decorated.sort((a, b) => (a.km !== b.km ? a.km - b.km : compareByName(a.location, b.location)))
  return decorated.map((entry) => entry.location)
}

/**
 * Waehlt die Standorte aus, auf die die Regel passt.
 *
 * `memberships` bildet die n:m-Tabelle location_groups ab: Standort-Kennung ->
 * Gruppen-Kennungen. Die Funktion ist rein; weder das uebergebene Array noch die
 * Standorte selbst werden veraendert.
 */
export function applyRule(
  rule: RouteRule,
  locations: MapLocation[],
  memberships: Map<string, string[]>,
): MapLocation[] {
  const normalized = normalize(rule)
  const categoryIds = new Set(normalized.categoryIds)
  const groupIds = new Set(normalized.groupIds)
  const tags = normalized.tags.map((tag) => tag.toLowerCase())
  const center = normalized.center
  const radiusKm = normalized.radiusKm

  const selected = locations.filter((location) => {
    if (normalized.onlyActive && !location.is_active) return false

    if (categoryIds.size > 0) {
      if (location.category_id === null || !categoryIds.has(location.category_id)) return false
    }

    if (groupIds.size > 0) {
      const own = memberships.get(location.id)
      if (!own || !own.some((groupId) => groupIds.has(groupId))) return false
    }

    if (tags.length > 0 && !matchesTags(location.tags, tags, normalized.tagMatch)) return false

    if (center !== null && radiusKm !== null) {
      if (!withinRadius(center, { lat: location.lat, lng: location.lng }, radiusKm)) return false
    }

    return true
  })

  const sorted = center !== null ? sortByDistance(selected, center) : selected.sort(compareByName)
  return normalized.maxStops !== null ? sorted.slice(0, normalized.maxStops) : sorted
}

/** Namen der Kennungen, alphabetisch und ohne Dopplungen. */
function nameList(ids: string[], entities: { id: string; name: string }[]): string[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity.name]))
  const names = new Set<string>()
  for (const id of ids) names.add(byId.get(id) ?? 'unbekannt')
  return [...names].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
}

function labelled(singular: string, plural: string, names: string[]): string {
  return `${names.length === 1 ? singular : plural} ${names.join(', ')}`
}

/** Kilometer mit deutschem Dezimalkomma, ohne ueberfluessige Nullen. */
function formatKm(km: number): string {
  return String(Math.round(km * 100) / 100).replace('.', ',')
}

/** Ein deutscher Satz, der die Regel fuer die Anzeige zusammenfasst. */
export function describeRule(rule: RouteRule, categories: Category[], groups: Group[]): string {
  const normalized = normalize(rule)
  if (isEmpty(normalized)) return 'Alle Standorte'

  const parts: string[] = []

  if (normalized.categoryIds.length > 0) {
    parts.push(labelled('Kategorie', 'Kategorien', nameList(normalized.categoryIds, categories)))
  }

  if (normalized.groupIds.length > 0) {
    parts.push(labelled('Gruppe', 'Gruppen', nameList(normalized.groupIds, groups)))
  }

  if (normalized.tags.length === 1) {
    parts.push(`Tag ${normalized.tags[0]}`)
  } else if (normalized.tags.length > 1) {
    const glue = normalized.tagMatch === 'all' ? ' und ' : ' oder '
    parts.push(`Tags ${normalized.tags.join(glue)}`)
  }

  if (normalized.radiusKm !== null && normalized.center !== null) {
    parts.push(`im Umkreis von ${formatKm(normalized.radiusKm)} km`)
  }

  parts.push(normalized.onlyActive ? 'nur aktive' : 'auch inaktive')

  if (normalized.maxStops !== null) {
    parts.push(`max. ${normalized.maxStops} ${normalized.maxStops === 1 ? 'Stopp' : 'Stopps'}`)
  }

  return parts.join(' · ')
}
