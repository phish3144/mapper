/**
 * Der Verlauf der Adresssuche.
 *
 * Gemerkt wird erst, was wirklich uebernommen wurde - nicht jeder
 * Tastenanschlag. Ein Verlauf aus halbfertigen Eingaben waere kein Verlauf,
 * sondern ein Protokoll.
 *
 * Er liegt allein im Browser der Anwenderin (localStorage) und geht nie an
 * den Server: gesuchte Adressen sind eine Spur davon, wo jemand hinwollte,
 * und die gehoert niemandem sonst. Ein Geraetewechsel faengt deshalb bei
 * null an - das ist hier der richtige Preis.
 *
 * Diese Datei ist frei von React und Browser-APIs, soweit es geht: der Kern
 * (zusammenfuehren, einlesen) ist rein und wird auch so geprueft.
 */
import type { LatLng } from '@/types/domain'

export const HISTORY_KEY = 'mapper.searchHistory'

/**
 * Acht Eintraege.
 *
 * Genug, um die Adressen eines Arbeitstages wiederzufinden, wenig genug,
 * dass die Aufklappflaeche nicht scrollen muss - darunter steht bei gesetztem
 * Punkt noch die Umgebungsliste.
 */
export const MAX_ENTRIES = 8

/** Nachkommastellen des Schluessels: 4 sind rund 11 m, also dieselbe Adresse. */
const KEY_STELLEN = 4

export interface SearchEntry {
  lat: number
  lng: number
  label: string
  /** Zeitpunkt der Uebernahme, als Millisekunden. */
  at: number
}

/**
 * Die Kennung eines Eintrags ist seine Lage, nicht sein Text.
 *
 * Dieselbe Adresse kommt je nach Dienst mit leicht anderer Schreibweise
 * zurueck ("Str." gegen "Straße"). Nach Text zu vergleichen fuellte den
 * Verlauf mit Dubletten desselben Ortes.
 */
export function entryKey(p: LatLng): string {
  return `${p.lat.toFixed(KEY_STELLEN)},${p.lng.toFixed(KEY_STELLEN)}`
}

/**
 * Setzt einen Eintrag nach vorn und wirft den aeltesten weg.
 *
 * Rein, damit die Regel pruefbar ist: neu gewonnen, gleiche Lage verdraengt
 * die alte (mitsamt ihrer Beschriftung - die neue ist die aktuellere), und
 * laenger als MAX_ENTRIES wird die Liste nie.
 */
export function mergeEntry(list: readonly SearchEntry[], entry: SearchEntry): SearchEntry[] {
  const key = entryKey(entry)
  return [entry, ...list.filter((e) => entryKey(e) !== key)].slice(0, MAX_ENTRIES)
}

function istEintrag(wert: unknown): wert is SearchEntry {
  const e = wert as SearchEntry | null
  return (
    !!e &&
    typeof e.label === 'string' &&
    e.label !== '' &&
    Number.isFinite(e.lat) &&
    Number.isFinite(e.lng) &&
    Number.isFinite(e.at)
  )
}

/**
 * Liest den gespeicherten Verlauf.
 *
 * Nachsichtig gegenueber Muell: im Speicher des Browsers kann alles stehen -
 * eine aeltere Fassung, eine halb geschriebene Zeile, eine fremde Erweiterung.
 * Ein kaputter Eintrag darf die Suche nicht lahmlegen, er faellt einfach raus.
 */
export function parseHistory(raw: string | null): SearchEntry[] {
  if (!raw) return []
  try {
    const gelesen: unknown = JSON.parse(raw)
    if (!Array.isArray(gelesen)) return []
    const sauber: SearchEntry[] = []
    const gesehen = new Set<string>()
    for (const wert of gelesen) {
      if (!istEintrag(wert)) continue
      const key = entryKey(wert)
      if (gesehen.has(key)) continue
      gesehen.add(key)
      sauber.push({ lat: wert.lat, lng: wert.lng, label: wert.label, at: wert.at })
      if (sauber.length >= MAX_ENTRIES) break
    }
    return sauber
  } catch {
    return []
  }
}

/**
 * Schreiben und Lesen koennen beide scheitern - im privaten Fenster, bei
 * abgeschalteten Website-Daten, bei vollem Speicher. Der Verlauf ist
 * Bequemlichkeit; faellt er aus, funktioniert die Suche weiter.
 */
function lies(): string | null {
  try {
    return localStorage.getItem(HISTORY_KEY)
  } catch {
    return null
  }
}

function schreib(list: readonly SearchEntry[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(HISTORY_KEY)
    else localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch {
    // Nichts zu tun: der Verlauf bleibt dann eben nur fuer diese Sitzung.
  }
}

export function readHistory(): SearchEntry[] {
  return parseHistory(lies())
}

/** Merkt eine uebernommene Adresse und gibt den neuen Verlauf zurueck. */
export function rememberSearch(point: LatLng & { label: string }, now = Date.now()): SearchEntry[] {
  const label = point.label.trim()
  // Ohne Beschriftung ist ein Eintrag nicht wiedererkennbar - dann lieber
  // keiner als eine Zeile aus zwei Zahlen.
  if (label === '') return readHistory()
  const next = mergeEntry(readHistory(), { lat: point.lat, lng: point.lng, label, at: now })
  schreib(next)
  return next
}

/** Vergisst einen einzelnen Eintrag und gibt den neuen Verlauf zurueck. */
export function forgetSearch(key: string): SearchEntry[] {
  const next = readHistory().filter((e) => entryKey(e) !== key)
  schreib(next)
  return next
}

/** Loescht den ganzen Verlauf. */
export function clearHistory(): SearchEntry[] {
  schreib([])
  return []
}
