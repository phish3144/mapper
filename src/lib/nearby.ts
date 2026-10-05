/**
 * Umgebungssuche: welche gespeicherten Standorte liegen einer gesuchten
 * Adresse am naechsten?
 *
 * Bewusst rein und ohne Seiteneffekte - kein React, kein Netz, kein Speicher.
 * Fahrzeiten kommen von aussen (Routing-Matrix) und werden erst nachtraeglich
 * ueber withTravel angehaengt. Dadurch bleibt die Rangfolge auch dann gueltig,
 * wenn der Routing-Anbieter nicht antwortet: die Luftlinie steht immer.
 */
import type { LatLng, MapLocation } from '@/types/domain'
import { haversineKm, isValidLatLng } from '@/lib/geo'

export type CompassPoint = 'N' | 'NO' | 'O' | 'SO' | 'S' | 'SW' | 'W' | 'NW'

export interface NearbyEntry {
  location: MapLocation
  /** Luftlinie in Kilometern. */
  airKm: number
  /** Himmelsrichtung VOM Suchpunkt ZUM Standort. */
  direction: CompassPoint
  /** Fahrzeit in Sekunden, sofern angereichert. */
  travelSec: number | null
  /** Fahrstrecke in Metern, sofern angereichert. */
  travelMeters: number | null
}

export interface NearbyOptions {
  /** Hoechstzahl der Treffer, Vorgabe 8; Infinity bedeutet ohne Grenze. */
  limit?: number
  /**
   * Obergrenze der Luftlinie in Kilometern; null bedeutet ohne Grenze.
   * Sie greift vor dem Limit: erst wird abgeschnitten, dann gezaehlt.
   */
  maxKm?: number | null
  /** Nur aktive Standorte beruecksichtigen. */
  onlyActive?: boolean
}

const DEFAULT_LIMIT = 8

const toRad = (deg: number): number => (deg * Math.PI) / 180
const toDeg = (rad: number): number => (rad * 180) / Math.PI

/** Auf 0..360 bringen. Unbrauchbare Werte gelten als Norden, nie als NaN. */
function normalizeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0
  return ((degrees % 360) + 360) % 360
}

/**
 * Rechtweisende Anfangspeilung 0..360 (0 = Norden, 90 = Osten).
 *
 * Grosskreisformel statt der naiven Differenz der Koordinaten: ein Laengengrad
 * ist in hohen Breiten viel kuerzer als ein Breitengrad, deshalb liegt die
 * naive Rechnung dort um zweistellige Gradzahlen daneben.
 */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const dLng = toRad(to.lng - from.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  // atan2(0, 0) ist 0: identische Punkte ergeben Norden und nicht NaN.
  return normalizeDegrees(toDeg(Math.atan2(y, x)))
}

const COMPASS_ORDER: readonly CompassPoint[] = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']

/** Achtelt den Kreis; Norden reicht von 337,5 bis 22,5 Grad. */
export function compassPoint(degrees: number): CompassPoint {
  const normalized = normalizeDegrees(degrees)
  // Der halbe Sektor Versatz legt die Sektormitte auf den vollen Achtelschritt.
  const index = Math.floor(((normalized + 22.5) % 360) / 45)
  return COMPASS_ORDER[index % COMPASS_ORDER.length]
}

const COMPASS_LABELS: Record<CompassPoint, string> = {
  N: 'Norden',
  NO: 'Nordosten',
  O: 'Osten',
  SO: 'Südosten',
  S: 'Süden',
  SW: 'Südwesten',
  W: 'Westen',
  NW: 'Nordwesten',
}

/** Ausgeschriebene Himmelsrichtung fuer die Anzeige. */
export function directionLabel(point: CompassPoint): string {
  return COMPASS_LABELS[point]
}

/** Zwischenstand: nur Entfernung, die Peilung kommt erst fuer die Treffer. */
interface Candidate {
  location: MapLocation
  target: LatLng
  airKm: number
}

/**
 * Name vor Kennung: gleiche Entfernungen kommen bei runden Koordinaten haeufig
 * vor, und die Reihenfolge darf nicht von der Eingabereihenfolge abhaengen.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.airKm !== b.airKm) return a.airKm - b.airKm
  const byName = a.location.name.localeCompare(b.location.name, 'de', { numeric: true })
  if (byName !== 0) return byName
  if (a.location.id === b.location.id) return 0
  return a.location.id < b.location.id ? -1 : 1
}

function resolveLimit(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return DEFAULT_LIMIT
  // Unendlich heisst "alle" - dieselbe Aussage, die maxKm mit null trifft.
  // Minus unendlich ist eine Untergrenze wie jede andere negative Zahl: nichts.
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY
  if (value === Number.NEGATIVE_INFINITY) return 0
  return Math.max(0, Math.floor(value))
}

function resolveMaxKm(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

/**
 * Die naechstgelegenen Standorte zu einem Punkt, aufsteigend nach Luftlinie.
 *
 * Die Eingabe wird nicht veraendert; travelSec und travelMeters bleiben null,
 * bis withTravel sie fuellt.
 */
export function nearestLocations(
  point: LatLng,
  locations: readonly MapLocation[],
  options: NearbyOptions = {},
): NearbyEntry[] {
  // Ohne gueltigen Bezugspunkt gibt es keine Entfernung, die man zeigen duerfte.
  if (!isValidLatLng(point)) return []

  const limit = resolveLimit(options.limit)
  if (limit <= 0) return []
  const maxKm = resolveMaxKm(options.maxKm)
  const onlyActive = options.onlyActive === true

  const candidates: Candidate[] = []
  for (const location of locations) {
    if (onlyActive && !location.is_active) continue
    const target: LatLng = { lat: location.lat, lng: location.lng }
    // Kaputte Koordinaten wuerden eine Entfernung von NaN erzeugen und die
    // gesamte Sortierung unbrauchbar machen.
    if (!isValidLatLng(target)) continue
    const airKm = haversineKm(point, target)
    if (!Number.isFinite(airKm)) continue
    if (maxKm !== null && airKm > maxKm) continue
    candidates.push({ location, target, airKm })
  }

  candidates.sort(compareCandidates)
  const top = candidates.length > limit ? candidates.slice(0, limit) : candidates

  // Die Peilung erst fuer die Treffer rechnen: sie kostet ein zweites Mal
  // Trigonometrie je Standort und interessiert nur bei den angezeigten.
  return top.map((candidate) => ({
    location: candidate.location,
    airKm: candidate.airKm,
    direction: compassPoint(bearingDegrees(point, candidate.target)),
    travelSec: null,
    travelMeters: null,
  }))
}

/** Nur endliche, nicht negative Zahlen sind eine brauchbare Reiseangabe. */
function usableValue(values: readonly number[], index: number): number | null {
  const raw: number | undefined = values[index]
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  return raw
}

/**
 * Haengt Fahrzeit und Fahrstrecke an: durations[i] und distances[i] gehoeren zu
 * entries[i].
 *
 * Fehlende oder unbrauchbare Werte bleiben null. Eine falsche Zahl waere hier
 * schlimmer als eine fehlende - die Umgebungsliste ist eine Entscheidungshilfe.
 * Kuerzere Arrays sind erlaubt, der Rest bleibt dann ohne Reiseangabe.
 */
export function withTravel(
  entries: readonly NearbyEntry[],
  durations: readonly number[],
  distances: readonly number[],
): NearbyEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    travelSec: usableValue(durations, index),
    travelMeters: usableValue(distances, index),
  }))
}

/**
 * Wie viele Kandidaten nach Luftlinie vorausgewaehlt werden, bevor die
 * Fahrzeit entscheidet.
 *
 * Die Luftlinie taugt nur zum Vorsortieren. Nachgemessen an 64 echten Paaren
 * (Suchpunkt -> HWP): die Strasse ist im Mittel 1,34-mal so lang, im
 * schlimmsten Fall 1,9-mal, und in sieben von acht Stichproben ordnete die
 * Fahrzeit die naechsten acht anders als die Luftlinie. Ein Ziel auf Platz 9
 * der Luftlinie kann deshalb das schnellste sein - nur wer es mitrechnet,
 * kann es zeigen. 25 Ziele sind fuer jeden Routendienst eine kleine Matrix.
 */
export const ROAD_CANDIDATES = 25

/**
 * Ordnet nach Fahrzeit, sobald es eine gibt, und kuerzt auf `limit`.
 *
 * Eintraege mit Fahrzeit stehen vorn, aufsteigend; Gleichstand entscheidet
 * die Luftlinie. Eintraege ohne Fahrzeit - der Dienst kennt keinen Weg, etwa
 * auf eine Insel ohne Faehre im Datensatz - folgen nach Luftlinie. Fehlt die
 * Fahrzeit bei ALLEN, ist das Ergebnis genau die Luftlinien-Reihenfolge.
 *
 * Die Eingabe wird nicht veraendert.
 */
export function rankByTravel<T extends { airKm: number; travelSec: number | null }>(
  entries: readonly T[],
  limit: number,
): T[] {
  const mitZeit = entries.filter((e) => e.travelSec !== null)
  const ohneZeit = entries.filter((e) => e.travelSec === null)
  mitZeit.sort((a, b) => (a.travelSec as number) - (b.travelSec as number) || a.airKm - b.airKm)
  ohneZeit.sort((a, b) => a.airKm - b.airKm)
  return [...mitZeit, ...ohneZeit].slice(0, Math.max(0, limit))
}
