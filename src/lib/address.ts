/**
 * Zerlegung deutscher Adressen und Planung der Suchkaskade.
 *
 * Reine Logik, kein Netz — damit die Regeln pruefbar bleiben.
 *
 * Warum ueberhaupt eine Kaskade: Nominatim beantwortet eine freie Anfrage
 * entweder gut oder gar nicht. Findet es die Hausnummer nicht, kommt haeufig
 * eine leere Liste zurueck, obwohl Strasse und Ort sehr wohl bekannt sind.
 * Statt "Keine Adresse gefunden" zu melden, wird schrittweise gelockert und
 * das Ergebnis ehrlich als ungenauer ausgewiesen.
 *
 * Was hier bewusst NICHT passiert: Umlaute oder "Str." umschreiben. Gemessen
 * an echten Adressen findet Nominatim "Moenckebergstrasse 1", "Mönckebergstr. 1"
 * und "Mönckebergstraße 1" gleichermassen — eine eigene Normalisierung waere
 * wirkungslos und wuerde nur neue Fehlerquellen schaffen.
 */

export type SearchPrecision = 'exact' | 'street' | 'place'

export interface AddressParts {
  /** Strassenname ohne Hausnummer. */
  street: string | null
  /** "14", "14a", "14-16". */
  houseNumber: string | null
  postalCode: string | null
  city: string | null
  country: string | null
  /** Was sich keinem Feld zuordnen liess, etwa ein Bundesland. */
  rest: string[]
}

export interface SearchStep {
  kind: 'free' | 'structured'
  precision: SearchPrecision
  /** Bei kind 'free'. */
  query?: string
  /** Bei kind 'structured'; Nominatims Felder street/postalcode/city/country. */
  params?: Record<string, string>
}

const COUNTRIES: Record<string, string> = {
  deutschland: 'de',
  germany: 'de',
  de: 'de',
  brd: 'de',
  oesterreich: 'at',
  österreich: 'at',
  austria: 'at',
  at: 'at',
  schweiz: 'ch',
  switzerland: 'ch',
  ch: 'ch',
}

/**
 * Bundeslaender sind fuer die Suche wertlos bis schaedlich: Nominatim braucht
 * sie nicht, und in der strukturierten Suche verengen sie das Ergebnis.
 */
const STATES = new Set([
  'baden-wuerttemberg', 'baden-württemberg', 'bayern', 'berlin', 'brandenburg',
  'bremen', 'hamburg', 'hessen', 'mecklenburg-vorpommern', 'niedersachsen',
  'nordrhein-westfalen', 'nrw', 'rheinland-pfalz', 'saarland', 'sachsen',
  'sachsen-anhalt', 'schleswig-holstein', 'thueringen', 'thüringen',
])

/** "14", "14a", "14-16", "14/2" — auch mit Leerzeichen davor. */
const HOUSE_NUMBER = /^(\d+\s*[-/]\s*\d+[a-zA-Z]?|\d+\s*[a-zA-Z]?)$/
const POSTAL_CODE = /^\d{5}$/

function normalizeSegment(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Entfernt Schlusskommata und doppelte Trenner, die beim Kopieren entstehen. */
export function cleanQuery(input: string): string {
  return input
    .replace(/\s+/g, ' ')
    .split(',')
    .map(normalizeSegment)
    .filter((part) => part !== '')
    .join(', ')
    .trim()
}

/** Trennt "Horstwiesen 14" in Strasse und Hausnummer. */
function splitStreet(segment: string): { street: string; houseNumber: string | null } {
  const tokens = segment.split(' ')
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1]
    if (HOUSE_NUMBER.test(last)) {
      return { street: tokens.slice(0, -1).join(' '), houseNumber: last }
    }
    // Franzoesische/englische Reihenfolge: "14 Horstwiesen".
    const first = tokens[0]
    if (HOUSE_NUMBER.test(first) && tokens.length >= 2) {
      return { street: tokens.slice(1).join(' '), houseNumber: first }
    }
  }
  return { street: segment, houseNumber: null }
}

/**
 * Zerlegt eine frei eingegebene Adresse. Die Zuordnung ist bewusst
 * nachsichtig: fehlende Teile bleiben null, nichts wird erzwungen.
 */
export function parseGermanAddress(input: string): AddressParts {
  const parts: AddressParts = {
    street: null,
    houseNumber: null,
    postalCode: null,
    city: null,
    country: null,
    rest: [],
  }
  const segments = cleanQuery(input).split(',').map(normalizeSegment).filter((s) => s !== '')
  if (segments.length === 0) return parts

  const remaining: string[] = []

  for (const segment of segments) {
    const lower = segment.toLowerCase()

    const country = COUNTRIES[lower]
    if (country !== undefined) {
      parts.country ??= country
      continue
    }
    if (STATES.has(lower)) {
      parts.rest.push(segment)
      continue
    }
    if (POSTAL_CODE.test(segment)) {
      parts.postalCode ??= segment
      continue
    }
    // "29336 Nienhagen" — Postleitzahl und Ort in einem Glied.
    const combined = /^(\d{5})\s+(.+)$/.exec(segment)
    if (combined) {
      parts.postalCode ??= combined[1]
      remaining.push(combined[2])
      continue
    }
    remaining.push(segment)
  }

  if (remaining.length > 0) {
    // Das erste verbleibende Glied ist die Strasse - so schreibt man Adressen.
    const split = splitStreet(remaining[0])
    parts.street = split.street
    parts.houseNumber = split.houseNumber
    // Das naechste ist der Ort; alles Weitere ist Beiwerk.
    if (remaining.length > 1) parts.city = remaining[1]
    for (const extra of remaining.slice(2)) parts.rest.push(extra)
  }

  // Steht nur ein Glied da und traegt es keine Hausnummer, ist es eher ein
  // Ort als eine Strasse ("Nienhagen").
  if (parts.city === null && parts.street !== null && parts.houseNumber === null && segments.length === 1) {
    parts.city = parts.street
    parts.street = null
  }
  return parts
}

function structuredParams(parts: AddressParts, withHouseNumber: boolean): Record<string, string> | null {
  const params: Record<string, string> = {}
  if (parts.street !== null) {
    params.street =
      withHouseNumber && parts.houseNumber !== null
        ? `${parts.street} ${parts.houseNumber}`
        : parts.street
  }
  if (parts.postalCode !== null) params.postalcode = parts.postalCode
  if (parts.city !== null) params.city = parts.city
  if (parts.country !== null) params.country = parts.country
  // Nominatim braucht mindestens ein Feld; ein einzelnes Land genuegt nicht.
  const meaningful = ['street', 'postalcode', 'city'].filter((key) => params[key] !== undefined)
  return meaningful.length > 0 ? params : null
}

/**
 * Plant die Suche: vom Genauen zum Groben. Der Aufrufer arbeitet die Schritte
 * der Reihe nach ab und hoert beim ersten Treffer auf.
 */
export function buildSearchSteps(input: string): SearchStep[] {
  const cleaned = cleanQuery(input)
  if (cleaned === '') return []

  const parts = parseGermanAddress(cleaned)
  const steps: SearchStep[] = []
  const seen = new Set<string>()

  const add = (step: SearchStep): void => {
    const key =
      step.kind === 'free'
        ? `free|${(step.query ?? '').toLowerCase()}`
        : `struct|${JSON.stringify(step.params ?? {})}`
    if (seen.has(key)) return
    seen.add(key)
    steps.push(step)
  }

  // 1. Wie eingegeben, nur von ueberfluessiger Zeichensetzung befreit.
  add({ kind: 'free', precision: 'exact', query: cleaned })

  // 2. Strukturiert - greift, wenn die freie Suche an der Wortstellung scheitert.
  const exact = structuredParams(parts, true)
  if (exact) add({ kind: 'structured', precision: 'exact', params: exact })

  // 3. Ohne Hausnummer: die Strasse gibt es meist auch dann, wenn die
  //    einzelne Hausnummer in OpenStreetMap fehlt.
  if (parts.houseNumber !== null && parts.street !== null) {
    const street = structuredParams(parts, false)
    if (street) add({ kind: 'structured', precision: 'street', params: street })
    add({
      kind: 'free',
      precision: 'street',
      query: [parts.street, [parts.postalCode, parts.city].filter(Boolean).join(' ')]
        .filter((piece) => piece !== '' && piece !== null)
        .join(', '),
    })
  }

  // 4. Nur der Ort - besser als gar kein Bezugspunkt, aber deutlich als solcher
  //    gekennzeichnet.
  if (parts.city !== null || parts.postalCode !== null) {
    const place: Record<string, string> = {}
    if (parts.postalCode !== null) place.postalcode = parts.postalCode
    if (parts.city !== null) place.city = parts.city
    if (parts.country !== null) place.country = parts.country
    add({ kind: 'structured', precision: 'place', params: place })
  }

  return steps
}

/** Hinweistext, wenn der Treffer ungenauer ist als gesucht. */
export function precisionNote(precision: SearchPrecision): string | null {
  if (precision === 'street') return 'Hausnummer nicht gefunden — Strassenmitte'
  if (precision === 'place') return 'Nur Ort gefunden — keine genaue Adresse'
  return null
}
