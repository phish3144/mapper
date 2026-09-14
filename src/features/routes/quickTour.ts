/**
 * Netzfreie Logik hinter "Tour aus Adressen".
 *
 * Der Dialog macht die Netzaufrufe, hier steht alles, was ohne sie auskommt:
 * Zeilen lesen, vorhandene Standorte wiederfinden, einen Geocoder-Treffer
 * bewerten. Getrennt, damit genau die Entscheidungen pruefbar sind, an denen
 * ein Fehler teuer waere - ein Stopp am falschen Fleck faellt spaeter
 * niemandem mehr auf.
 */
import { cleanQuery, parseGermanAddress } from '@/lib/address'
import { haversineKm } from '@/lib/geo'
import type { AddressLookup, AddressMatch, GeocodeProblem } from '@/lib/geocode'
import type { LatLng, MapLocation } from '@/types/domain'

/** So viele Zeilen arbeitet ein Lauf ab. Der Rest bleibt stehen, statt zu verschwinden. */
export const MAX_ADDRESSES = 25

/** Naeher als das, und es ist derselbe Ort - nicht ein zweiter daneben. */
export const REUSE_RADIUS_KM = 0.05

/** Liegen die beiden besten Treffer weiter auseinander, ist die Eingabe mehrdeutig. */
export const AMBIGUOUS_DISTANCE_KM = 20

/** Grobes Rechteck um Deutschland, Oesterreich und die Schweiz. */
export const DACH_BOUNDS = { minLat: 45.5, maxLat: 55.5, minLng: 5.5, maxLng: 17.2 }

/** Laenger beschriftet kein Stopp - der Rest waere in jeder Liste abgeschnitten. */
const MAX_LABEL_LENGTH = 160

/**
 * Was aus einer Zeile geworden ist.
 *
 * `new` heisst: die Adresse wurde gefunden, aber es gibt keinen gespeicherten
 * Standort dazu - und es entsteht auch keiner. Der Stopp traegt seine
 * Koordinate selbst. `reused` heisst: die Zeile zeigt auf einen Standort, den
 * es in diesem Arbeitsbereich schon gibt.
 */
export type LineKind = 'new' | 'reused' | 'unsure' | 'missing'

export interface ResolvedLine {
  /** Die Zeile, wie sie eingegeben wurde. */
  raw: string
  kind: LineKind
  /** Kennung des vorhandenen Standorts; null, wenn die Zeile nur in der Tour lebt. */
  locationId: string | null
  point: LatLng | null
  /** Beschriftung des Treffers oder Name des wiederverwendeten Standorts. */
  label: string | null
  /** Warnung zur Genauigkeit oder Grund des Fehlschlags; sonst null. */
  hint: string | null
}

export interface ParsedInput {
  /** Zeilen, die dieser Lauf abarbeitet. */
  lines: string[]
  /** Zeilen jenseits der Obergrenze - sie bleiben im Feld stehen. */
  rest: string[]
}

/**
 * Zerlegt das Textfeld. Leerzeilen und Dubletten fallen weg; der Rest jenseits
 * der Obergrenze wird nicht verworfen, sondern getrennt zurueckgegeben. Was
 * abgeschnitten wird, muss der Nutzer wiederbekommen - die Zwischenablage ist
 * bis dahin laengst ueberschrieben.
 */
export function parseAddressLines(input: string, max: number = MAX_ADDRESSES): ParsedInput {
  const seen = new Set<string>()
  const alle: string[] = []
  for (const roh of input.split(/\r?\n/)) {
    const zeile = cleanQuery(roh)
    if (zeile === '') continue
    const key = normalizeAddressKey(zeile)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    alle.push(zeile)
  }
  return { lines: alle.slice(0, max), rest: alle.slice(max) }
}

/**
 * Vergleichsform einer Adresse: Kleinschreibung, keine Satzzeichen, einfache
 * Abstaende. "Bahnhofstr. 5, 29336 Nienhagen" und "bahnhofstr 5 29336
 * nienhagen" sind damit dasselbe - "Bahnhofstrasse 5" bleibt bewusst etwas
 * anderes. Hier wird Schreibweise geglaettet, nicht geraten.
 */
export function normalizeAddressKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Nachschlagewerk ueber Adresse UND Name - beides kann die Zeile getroffen haben. */
export function buildAddressIndex(locations: readonly MapLocation[]): Map<string, MapLocation> {
  const index = new Map<string, MapLocation>()
  for (const location of locations) {
    for (const kandidat of [location.address, location.name]) {
      const key = kandidat ? normalizeAddressKey(kandidat) : ''
      // Der erste Eintrag gewinnt: bei zwei gleichnamigen Standorten ist jede
      // Wahl willkuerlich, aber eine stabile ist besser als eine wechselnde.
      if (key !== '' && !index.has(key)) index.set(key, location)
    }
  }
  return index
}

export function findByText(line: string, index: ReadonlyMap<string, MapLocation>): MapLocation | null {
  return index.get(normalizeAddressKey(line)) ?? null
}

/**
 * Sucht einen vorhandenen Standort am selben Fleck. Faengt die Faelle, die der
 * Textabgleich nicht kennt: "Bahnhofstr. 5" und "Bahnhofstrasse 5" fuehren zu
 * denselben Koordinaten, aber zu verschiedenen Schluesseln.
 */
export function findByPoint(
  point: LatLng,
  locations: readonly MapLocation[],
  radiusKm: number = REUSE_RADIUS_KM,
): MapLocation | null {
  let beste: MapLocation | null = null
  let besteEntfernung = radiusKm
  for (const location of locations) {
    const km = haversineKm(point, { lat: location.lat, lng: location.lng })
    if (km <= besteEntfernung) {
      beste = location
      besteEntfernung = km
    }
  }
  return beste
}

export function problemHint(problem: GeocodeProblem | null): string {
  switch (problem) {
    case 'rate-limit':
      return 'Der Adressdienst hat gedrosselt - später noch einmal versuchen.'
    case 'blocked':
      return 'Der Adressdienst hat die Anfrage abgewiesen.'
    case 'network':
      return 'Der Adressdienst war nicht erreichbar.'
    case 'bad-response':
      return 'Der Adressdienst hat unverständlich geantwortet.'
    default:
      return 'Keine Adresse gefunden.'
  }
}

export interface AddressCheck {
  /** Der Treffer, der uebernommen wird; null, wenn nichts gefunden wurde. */
  match: AddressMatch | null
  /** Grund zur Vorsicht - der Treffer wird trotzdem uebernommen. */
  hint: string | null
}

/**
 * Bewertet, was der Geocoder geliefert hat. Uebernommen wird immer der erste
 * Treffer; der Hinweis sagt, warum man ihn ansehen sollte. Nichts wird
 * stillschweigend verworfen, aber auch nichts stillschweigend geglaubt.
 */
export function checkMatch(lookup: AddressLookup): AddressCheck {
  const match = lookup.matches[0] ?? null
  if (!match) return { match: null, hint: problemHint(lookup.problem) }

  const gruende: string[] = []
  if (match.note) gruende.push(match.note)

  const zweiter = lookup.matches[1]
  if (zweiter && haversineKm(match, zweiter) > AMBIGUOUS_DISTANCE_KM) {
    gruende.push('Mehrdeutig - es gibt einen weiteren Treffer weit entfernt')
  }

  if (
    match.lat < DACH_BOUNDS.minLat ||
    match.lat > DACH_BOUNDS.maxLat ||
    match.lng < DACH_BOUNDS.minLng ||
    match.lng > DACH_BOUNDS.maxLng
  ) {
    // Photon kennt keinen Laenderfilter. Eine Zeile ohne Ort trifft sonst
    // widerspruchslos irgendwo in Europa, und die Tour bekommt eine
    // 700-km-Etappe, die niemand bestellt hat.
    gruende.push('Liegt außerhalb von Deutschland, Oesterreich und der Schweiz')
  }

  return { match, hint: gruende.length > 0 ? gruende.join(' · ') : null }
}

/** Zeilen ohne Ortsangabe treffen fast alles - die gehoeren immer angesehen. */
export function needsReview(line: string): boolean {
  const teile = parseGermanAddress(line)
  return teile.postalCode === null && teile.city === null
}

/**
 * Woran ein Stopp wiedererkannt wird, bevor er eine eigene Kennung hat.
 *
 * Ueber den Standort, wo es einen gibt - sonst ueber die Koordinate, denn ein
 * Stopp ohne Standort hat nichts anderes, was schon vor dem Speichern
 * feststeht. Dieselbe Form fuer vorhandene Stopps wie fuer aufgeloeste Zeilen,
 * damit beide Seiten vergleichbar sind.
 *
 * Fuenf Nachkommastellen sind rund ein Meter: nahe genug, dass dieselbe
 * Adresse denselben Schluessel bekommt, weit genug, dass zwei Hausnummern
 * nicht zusammenfallen. Standortkennungen sind UUIDs und koennen deshalb nie
 * wie ein Koordinatenpaar aussehen - die beiden Formen vermischen sich nicht.
 */
export function stoppSchluessel(locationId: string | null, lat: number, lng: number): string {
  return locationId ?? `${lat.toFixed(5)},${lng.toFixed(5)}`
}

/** Beschriftung eines Stopps: aufgeraeumt und auf eine lesbare Laenge gekuerzt. */
export function stoppName(line: string): string {
  const sauber = cleanQuery(line)
  return sauber.length <= MAX_LABEL_LENGTH
    ? sauber
    : sauber.slice(0, MAX_LABEL_LENGTH - 1).trimEnd() + '…'
}

/**
 * Was ein Stopp mitbringt.
 *
 * Deckungsgleich mit db.StopPlace, aber ohne dessen Modul: hier soll nichts
 * hineinragen, was eine Verbindung braucht.
 */
export interface StoppOrt {
  locationId: string | null
  lat: number
  lng: number
  label: string
}

/**
 * Welche Stopps aus den uebernommenen Zeilen neu entstehen.
 *
 * Zeilen ohne Koordinate fallen weg, und was schon in der Tour steht, kommt
 * nicht ein zweites Mal hinein. Standorte entstehen dabei keine - eine Zeile,
 * hinter der keiner steckt, wird ein Stopp mit eigener Koordinate und eigener
 * Beschriftung. Genau das ist der Unterschied zu frueher, und genau deshalb
 * steht die Entscheidung hier und nicht im Dialog.
 */
export function neueStopps(
  lines: readonly ResolvedLine[],
  vorhandene: readonly { location_id: string | null; lat: number; lng: number }[],
): StoppOrt[] {
  const schonDrin = new Set(vorhandene.map((s) => stoppSchluessel(s.location_id, s.lat, s.lng)))
  const out: StoppOrt[] = []
  for (const l of lines) {
    if (l.point === null) continue
    const schluessel = stoppSchluessel(l.locationId, l.point.lat, l.point.lng)
    if (schonDrin.has(schluessel)) continue
    schonDrin.add(schluessel)
    out.push({
      locationId: l.locationId,
      lat: l.point.lat,
      lng: l.point.lng,
      // Die Rohzeile rettet die Beschriftung, wenn der Geocoder keine liefert -
      // ein Stopp ohne Namen hiesse in der Liste "Gelöschter Standort".
      label: stoppName(l.label?.trim() || l.raw),
    })
  }
  return out
}

export function tourName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Tour vom ${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`
}

/** Reihenfolge erhalten, Dubletten weg - zwei Zeilen koennen denselben Standort treffen. */
export function orderedUnique(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
