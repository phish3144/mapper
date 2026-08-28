/**
 * Adresssuche (Geocoding) und Rueckwaertssuche ueber Nominatim/OpenStreetMap.
 *
 * Die Nutzungsbedingungen des oeffentlichen Dienstes erlauben hoechstens eine
 * Anfrage pro Sekunde (https://operations.osmfoundation.org/policies/nominatim/).
 * Deshalb laufen saemtliche Anfragen dieses Moduls durch eine Warteschlange:
 * sie werden serialisiert und auf mindestens MIN_REQUEST_INTERVAL_MS Abstand
 * gebracht. Der ebenfalls verlangte eigene User-Agent-Header laesst sich im
 * Browser nicht setzen - fetch verbietet ihn, der Versuch wuerde die Anfrage
 * scheitern lassen. Was bleibt, um den Dienst zu schonen: Entprellung
 * (createAddressSearch), Ergebnis-Cache und die Ratenbegrenzung.
 *
 * Keine der exportierten Funktionen wirft: Netzwerk-, HTTP- und Formatfehler
 * enden in einem leeren Ergebnis. Die Adresssuche ist eine Hilfestellung, kein
 * kritischer Pfad - die Oberflaeche soll daran nicht zerbrechen.
 */

import type { LatLng } from '@/types/domain'
import type { Bounds } from '@/lib/geo'
import { photonFeatures, photonSearchUrl, photonToHit } from '@/lib/photon'
import {
  buildSearchSteps,
  parseGermanAddress,
  precisionNote,
  type SearchPrecision,
  type SearchStep,
} from '@/lib/address'
import { formatLatLng, isValidLatLng } from '@/lib/geo'

export interface GeocodeHit {
  /** Vollstaendige Bezeichnung, wie Nominatim sie liefert (display_name). */
  label: string
  lat: number
  lng: number
  /** Art des Treffers, z. B. "house", "street", "city". Null, wenn unbekannt. */
  type: string | null
  /** Umschliessendes Rechteck des Treffers, sofern die Antwort eines enthaelt. */
  boundingBox: Bounds | null
  /**
   * Hausnummer laut Nominatim (address.house_number). Der verlaesslichste
   * Hinweis darauf, ob wirklich ein Haus getroffen wurde - der Typ allein
   * genuegt nicht, weil er je nach Objekt 'house', 'building' oder 'yes' heisst.
   */
  houseNumber: string | null
  /** Strassenname laut Nominatim (address.road). */
  road: string | null
}

export interface AddressSearchOptions {
  /** Hoechstzahl der Treffer, 1 bis 40 (Nominatims Obergrenze). Vorgabe 8. */
  limit?: number
  signal?: AbortSignal
  /** Laenderfilter als ISO-3166-1-alpha-2-Liste, z. B. "de,at,ch". */
  countryCodes?: string
}

export type AddressSearchCallback = (result: AddressLookup, query: string) => void

export interface DebouncedAddressSearch {
  (
    query: string,
    callback: AddressSearchCallback,
    opts?: Omit<AddressSearchOptions, 'signal'>,
  ): void
  /** Bricht eine wartende Entprellung und eine laufende Anfrage ab. */
  cancel(): void
}

export const NOMINATIM_PUBLIC_URL = 'https://nominatim.openstreetmap.org'

/** Mindestabstand zwischen zwei Anfragen. Etwas ueber einer Sekunde als Puffer. */
export const MIN_REQUEST_INTERVAL_MS = 1100

export const DEFAULT_SEARCH_LIMIT = 8

/** Nominatim beantwortet hoechstens 40 Treffer pro Anfrage. */
export const MAX_SEARCH_LIMIT = 40

export const GEOCODE_CACHE_LIMIT = 100

/**
 * Liest eine Vite-Variable. Der Zugriff laeuft ueber einen Cast, weil
 * `import.meta.env` nur mit den Vite-Client-Typen bekannt ist und in reinen
 * Node-Laeufen ganz fehlen kann.
 */
function readEnv(name: string): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env
  const value = env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export const NOMINATIM_BASE_URL = stripTrailingSlash(
  readEnv('VITE_NOMINATIM_BASE_URL') || NOMINATIM_PUBLIC_URL,
)

// --- Antwort auswerten ------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Nominatim liefert Zahlen in JSON haeufig als Strings ("52.52"). */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

/** Das Feld `boundingbox` ist [sued, nord, west, ost] - als Strings. */
function parseBoundingBox(value: unknown): Bounds | null {
  if (!Array.isArray(value) || value.length < 4) return null
  const south = toFiniteNumber(value[0])
  const north = toFiniteNumber(value[1])
  const west = toFiniteNumber(value[2])
  const east = toFiniteNumber(value[3])
  if (south === null || north === null || west === null || east === null) return null
  // Eine Box ueber den 180. Laengengrad hinweg hat west > east - das ist
  // zulaessig und wird deshalb nicht geprueft, Sued ueber Nord dagegen nicht.
  if (south > north) return null
  if (!isValidLatLng({ lat: south, lng: west }) || !isValidLatLng({ lat: north, lng: east })) {
    return null
  }
  return { north, south, east, west }
}

function parseHit(value: unknown): GeocodeHit | null {
  const raw = asRecord(value)
  if (!raw) return null
  const lat = toFiniteNumber(raw.lat)
  const lng = toFiniteNumber(raw.lon)
  if (lat === null || lng === null) return null
  const point: LatLng = { lat, lng }
  if (!isValidLatLng(point)) return null
  const address = asRecord(raw.address)
  return {
    label: firstNonEmptyString(raw.display_name, raw.name) ?? formatLatLng(point),
    lat,
    lng,
    type: firstNonEmptyString(raw.type, raw.addresstype, raw.category),
    boundingBox: parseBoundingBox(raw.boundingbox),
    houseNumber: address ? firstNonEmptyString(address.house_number) : null,
    road: address ? firstNonEmptyString(address.road, address.pedestrian, address.footway) : null,
  }
}

// --- Zustand des Moduls -----------------------------------------------------

/** Ende der Warteschlange: erfuellt, sobald die letzte Anfrage durch ist. */
let queueTail: Promise<unknown> = Promise.resolve()

/** Zeitpunkt der letzten abgeschickten Anfrage (Date.now()). */
let lastRequestAt = 0

/**
 * Ergebnis-Cache.
 * Schluessel ist die normalisierte Anfrage, ergaenzt um die Parameter, die das
 * Ergebnis veraendern (Trefferzahl, Laenderfilter) - sonst wuerde eine Suche
 * mit limit=1 die Antwort fuer limit=8 vergiften.
 */
const cache = new Map<string, GeocodeHit[]>()

/**
 * Kopien herausgeben, damit Aufrufer den Cache-Inhalt nicht veraendern koennen.
 * Eine flache Kopie der Liste genuegt dafuer nicht: die Treffer selbst wandern
 * sonst als gemeinsame Objekte durch die Oberflaeche.
 */
function copyHits(hits: readonly GeocodeHit[]): GeocodeHit[] {
  return hits.map((hit) => ({
    ...hit,
    boundingBox: hit.boundingBox === null ? null : { ...hit.boundingBox },
  }))
}

function readCache(key: string): GeocodeHit[] | null {
  const hits = cache.get(key)
  if (!hits) return null
  // Gelesene Eintraege wandern ans Ende: es verfaellt der am laengsten
  // ungenutzte Eintrag, nicht der aelteste.
  cache.delete(key)
  cache.set(key, hits)
  return copyHits(hits)
}

function writeCache(key: string, hits: GeocodeHit[]): void {
  cache.delete(key)
  cache.set(key, hits)
  while (cache.size > GEOCODE_CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

/** Leert den Ergebnis-Cache, etwa um eine Suche bewusst zu wiederholen. */
export function clearGeocodeCache(): void {
  cache.clear()
}

/**
 * Setzt Cache, Warteschlange und Ratenbegrenzung zurueck. Gedacht fuer Tests -
 * im laufenden Betrieb genuegt clearGeocodeCache().
 */
export function resetGeocodeState(): void {
  cache.clear()
  queueTail = Promise.resolve()
  lastRequestAt = 0
  preferredProvider = 'nominatim'
  providerDownAt.clear()
}

// --- Warteschlange mit Mindestabstand ---------------------------------------

function noop(): void {
  /* Ergebnisse und Fehler der Vorgaenger interessieren die Warteschlange nicht. */
}

/** Haengt eine Aufgabe hinten an die Warteschlange an. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const slot = queueTail.then(task)
  queueTail = slot.then(noop, noop)
  return slot
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    // Ein Abbruch beendet die Wartezeit sofort und gibt den Platz in der
    // Warteschlange frei, statt ihn bis zum Ablauf zu blockieren.
    signal?.addEventListener('abort', done, { once: true })
  })
}

function createAbortError(): Error {
  const error = new Error('Die Adresssuche wurde abgebrochen.')
  error.name = 'AbortError'
  return error
}

/**
 * Warum ein eigener Fehlertyp: eine gedrosselte Anfrage (429) und ein
 * gesperrter Zugriff (403) sehen fuer den Aufrufer sonst genauso aus wie
 * "nichts gefunden". Die Oberflaeche behauptete dann, es gebe die Adresse
 * nicht — obwohl der Dienst nur gebremst hat.
 */
export type GeocodeProblem = 'rate-limit' | 'blocked' | 'network' | 'bad-response'

export class GeocodeError extends Error {
  readonly problem: GeocodeProblem
  constructor(problem: GeocodeProblem, message: string) {
    super(message)
    this.name = 'GeocodeError'
    this.problem = problem
  }
}

function problemForStatus(status: number): GeocodeProblem {
  if (status === 429) return 'rate-limit'
  if (status === 403 || status === 401) return 'blocked'
  return 'network'
}

async function fetchJson(
  url: string,
  signal: AbortSignal | undefined,
  minIntervalMs: number = MIN_REQUEST_INTERVAL_MS,
): Promise<unknown> {
  return enqueue(async () => {
    if (signal?.aborted) throw createAbortError()
    // Nach oben begrenzt, damit eine zurueckgestellte Systemuhr die
    // Warteschlange nicht dauerhaft anhaelt.
    const waitMs = Math.min(minIntervalMs, lastRequestAt + minIntervalMs - Date.now())
    if (waitMs > 0) await sleep(waitMs, signal)
    if (signal?.aborted) throw createAbortError()

    lastRequestAt = Date.now()
    const response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json', 'Accept-Language': 'de' },
    })
    if (!response.ok) {
      throw new GeocodeError(
        problemForStatus(response.status),
        `Nominatim antwortet mit HTTP ${response.status}.`,
      )
    }
    return (await response.json()) as unknown
  })
}

// --- Oeffentliche Suche -----------------------------------------------------

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * "DE, AT" wird zu "de,at". Leere Glieder fallen weg - Nominatim wertet ein
 * "de,,at" sonst als unbekannten Laendercode und liefert nichts.
 * Die Reihenfolge bleibt, wie der Aufrufer sie gesetzt hat.
 */
function normalizeCountryCodes(codes: string | undefined): string {
  return (codes ?? '')
    .toLowerCase()
    .split(',')
    .map((code) => code.replace(/\s+/g, ''))
    .filter((code) => code !== '')
    .join(',')
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT
  return Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(limit)))
}

function round6(value: number): string {
  return String(Number(value.toFixed(6)))
}

/**
 * Sucht Adressen und Orte. Liefert bei leerer Anfrage, bei Abbruch und bei
 * jedem Fehler eine leere Liste - nie eine Ausnahme.
 */
/** Ergebnis eines einzelnen Abrufs samt Grund, falls er nicht klappte. */
interface RawLookup {
  hits: GeocodeHit[]
  problem: GeocodeProblem | null
}

/**
 * Fuehrt einen Abruf aus und meldet den Grund eines Fehlschlags mit, statt ihn
 * zu einer leeren Trefferliste einzuebnen.
 */
async function runLookup(
  key: string,
  params: URLSearchParams,
  opts: AddressSearchOptions,
): Promise<RawLookup> {
  const cached = readCache(key)
  if (cached) return { hits: cached, problem: null }

  let body: unknown
  try {
    body = await fetchJson(`${NOMINATIM_BASE_URL}/search?${params.toString()}`, opts.signal)
  } catch (error) {
    if (isAbort(error)) return { hits: [], problem: null }
    // Fehlgeschlagene Anfragen kommen nicht in den Cache: der naechste
    // Versuch soll den Dienst erneut fragen duerfen.
    return { hits: [], problem: error instanceof GeocodeError ? error.problem : 'network' }
  }
  if (!Array.isArray(body)) return { hits: [], problem: 'bad-response' }

  const hits: GeocodeHit[] = []
  for (const entry of body) {
    const hit = parseHit(entry)
    if (hit) hits.push(hit)
  }
  writeCache(key, hits)
  return { hits: copyHits(hits), problem: null }
}

/**
 * Photon kennt keine Ein-Sekunden-Regel wie Nominatim; ein kleiner Abstand
 * genuegt, um hoeflich zu bleiben.
 */
const PHOTON_MIN_INTERVAL_MS = 300

/** Sucht bei Photon. Gleiche Ergebnisform wie bei Nominatim. */
async function photonLookup(query: string, opts: AddressSearchOptions): Promise<RawLookup> {
  const normalized = normalizeQuery(query)
  const leer: RawLookup = { hits: [], problem: null }
  if (normalized === '') return leer
  if (opts.signal?.aborted) return leer

  const limit = clampLimit(opts.limit)
  const key = `photon|${limit}|${normalized}`
  const cached = readCache(key)
  if (cached) return { hits: cached, problem: null }

  let body: unknown
  try {
    body = await fetchJson(
      photonSearchUrl(query.trim(), limit),
      opts.signal,
      PHOTON_MIN_INTERVAL_MS,
    )
  } catch (error) {
    if (isAbort(error)) return leer
    return { hits: [], problem: error instanceof GeocodeError ? error.problem : 'network' }
  }

  const hits: GeocodeHit[] = []
  for (const feature of photonFeatures(body)) {
    const hit = photonToHit(feature)
    if (hit) hits.push(hit)
  }
  writeCache(key, hits)
  return { hits: copyHits(hits), problem: null }
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

export async function searchAddress(
  query: string,
  opts: AddressSearchOptions = {},
): Promise<GeocodeHit[]> {
  return (await searchAddressRaw(query, opts)).hits
}

async function searchAddressRaw(
  query: string,
  opts: AddressSearchOptions = {},
): Promise<RawLookup> {
  const normalized = normalizeQuery(query)
  const leer: RawLookup = { hits: [], problem: null }
  if (normalized === '') return leer
  // Vor dem Cache pruefen: eine abgebrochene Anfrage darf auch dann kein
  // Ergebnis melden, wenn die Antwort zufaellig schon vorliegt.
  if (opts.signal?.aborted) return leer

  const limit = clampLimit(opts.limit)
  const countryCodes = normalizeCountryCodes(opts.countryCodes)
  const params = new URLSearchParams({
    q: query.trim(),
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limit),
    'accept-language': 'de',
  })
  if (countryCodes !== '') params.set('countrycodes', countryCodes)

  return runLookup(`search|${countryCodes}|${limit}|${normalized}`, params, opts)
}

/**
 * Sucht die Adresse zu einer Koordinate. Liefert null, wenn der Punkt
 * ungueltig ist, nichts gefunden wurde oder die Anfrage fehlschlaegt.
 */
export async function reverseGeocode(
  point: LatLng,
  signal?: AbortSignal,
): Promise<GeocodeHit | null> {
  if (!isValidLatLng(point)) return null
  if (signal?.aborted) return null

  const lat = round6(point.lat)
  const lon = round6(point.lng)
  const key = `reverse|${lat},${lon}`
  const cached = readCache(key)
  // Ein leerer Eintrag ist die gemerkte Antwort "hier liegt nichts".
  if (cached) return cached[0] ?? null

  const params = new URLSearchParams({
    lat,
    lon,
    format: 'jsonv2',
    'accept-language': 'de',
  })

  let body: unknown
  try {
    body = await fetchJson(`${NOMINATIM_BASE_URL}/reverse?${params.toString()}`, signal)
  } catch {
    return null
  }

  const record = asRecord(body)
  if (!record) return null
  // Ohne Treffer antwortet Nominatim mit { "error": "Unable to geocode" }. Das
  // ist eine gueltige, dauerhafte Auskunft ueber diesen Punkt und wird gemerkt:
  // sonst kostet jeder Klick ins offene Meer eine neue Anfrage.
  if (record.error !== undefined) {
    writeCache(key, [])
    return null
  }

  const hit = parseHit(record)
  if (!hit) return null
  writeCache(key, [hit])
  return copyHits([hit])[0] ?? null
}

/**
 * Baut eine entprellte Adresssuche fuer Eingabefelder. Jede neue Eingabe
 * verwirft die wartende und bricht eine bereits laufende Anfrage ab; die
 * Rueckmeldung erhaelt ausschliesslich die zuletzt gestellte Anfrage.
 * Eine leere Eingabe meldet sofort und ohne Netzanfrage eine leere Liste.
 */
export function createAddressSearch(delayMs = 500): DebouncedAddressSearch {
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  // Zaehlt jede Anfrage und jeden Abbruch mit, damit Antworten ueberholter
  // Anfragen die Rueckmeldung nicht mehr erreichen.
  let generation = 0

  const cancel = (): void => {
    generation++
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (controller !== null) {
      controller.abort()
      controller = null
    }
  }

  const run = (
    query: string,
    callback: AddressSearchCallback,
    opts?: Omit<AddressSearchOptions, 'signal'>,
  ): void => {
    cancel()
    const trimmed = query.trim()
    if (trimmed === '') {
      callback({ matches: [], problem: null }, '')
      return
    }

    const generationAtStart = generation
    const own = new AbortController()
    controller = own
    timer = setTimeout(() => {
      timer = null
      // findAddress statt searchAddress: die entprellte Suche der Oberflaeche
      // soll dieselbe Lockerung durchlaufen wie ein direkter Aufruf.
      void findAddress(trimmed, { ...opts, signal: own.signal }).then((result) => {
        if (generationAtStart !== generation) return
        controller = null
        try {
          callback(result, trimmed)
        } catch (error) {
          // Ein Fehler aus dem Callback gehoert in den globalen Fehlerkanal,
          // nicht in diese Promise-Kette - dort wuerde er als unbehandelte
          // Rejection versickern und den Fehlersuchenden nichts sagen.
          setTimeout(() => {
            throw error
          })
        }
      })
    }, Math.max(0, delayMs))
  }

  return Object.assign(run, { cancel })
}

// --- Suchkaskade ------------------------------------------------------------

/**
 * Ein Treffer samt Angabe, wie genau er die Eingabe trifft. Ohne diese Angabe
 * koennte eine Strassenmitte als exakte Hausnummer durchgehen — und der
 * Standort landete stillschweigend am falschen Fleck.
 */
export interface AddressMatch extends GeocodeHit {
  precision: SearchPrecision
  /** Hinweistext, wenn der Treffer ungenauer ist als gesucht; sonst null. */
  note: string | null
}

/**
 * Strukturierte Suche (street/postalcode/city/country). Sie greift dort, wo
 * die freie Suche an der Wortstellung scheitert, weil Nominatim die Felder
 * dann nicht mehr raten muss.
 */
export async function searchStructured(
  fields: Record<string, string>,
  opts: AddressSearchOptions = {},
): Promise<GeocodeHit[]> {
  return (await searchStructuredRaw(fields, opts)).hits
}

async function searchStructuredRaw(
  fields: Record<string, string>,
  opts: AddressSearchOptions = {},
): Promise<RawLookup> {
  const entries = Object.entries(fields).filter(([, value]) => value.trim() !== '')
  const leer: RawLookup = { hits: [], problem: null }
  if (entries.length === 0) return leer
  if (opts.signal?.aborted) return leer

  const limit = clampLimit(opts.limit)
  const key = `struct|${limit}|${entries.map(([k, v]) => `${k}=${v.toLowerCase()}`).sort().join('&')}`
  const params = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limit),
    'accept-language': 'de',
  })
  for (const [field, value] of entries) params.set(field, value.trim())

  return runLookup(key, params, opts)
}

/**
 * Sucht eine Adresse und lockert die Anfrage schrittweise, solange nichts
 * gefunden wird: wie eingegeben, dann strukturiert, dann ohne Hausnummer,
 * zuletzt nur der Ort. Es wird beim ersten Treffer aufgehoert — die spaeteren
 * Schritte kosten je eine weitere Sekunde Wartezeit und werden nur gegangen,
 * wenn sonst gar nichts herauskaeme.
 */
export interface AddressLookup {
  matches: AddressMatch[]
  /** Welcher Dienst geantwortet hat; null, wenn keiner etwas geliefert hat. */
  provider?: GeocodeProvider
  /**
   * Grund, falls die Suche nicht durchgefuehrt werden konnte. Ohne diese
   * Unterscheidung meldete die Oberflaeche "Keine Adresse gefunden", obwohl
   * der Dienst nur gedrosselt hatte - die Adresse existiert sehr wohl.
   */
  problem: GeocodeProblem | null
}

export type GeocodeProvider = 'nominatim' | 'photon'

/**
 * Merkt sich, welcher Dienst zuletzt geantwortet hat. Ist Nominatim im Netz
 * der Anwenderin gesperrt, soll nicht jede Suche erst in dessen Fehler laufen.
 */
let preferredProvider: GeocodeProvider = 'nominatim'

/**
 * Wann ein Dienst zuletzt am TRANSPORT gescheitert ist - also nicht "nichts
 * gefunden", sondern "hat nicht geantwortet, war gesperrt oder gedrosselt".
 *
 * Ohne dieses Gedaechtnis kostet ein toter Dienst bei JEDER Adresse erneut die
 * volle Schrittkaskade, und der Mindestabstand von gut einer Sekunde wird auch
 * dann eingehalten, wenn ueberhaupt keine Antwort kommt. Bei zehn eingefuegten
 * Adressen summiert sich das auf ueber eine halbe Minute Warten auf einen
 * Dienst, von dem schon nach der ersten Zeile feststeht, dass er stumm bleibt.
 * Die Vorliebe oben half dagegen nicht: sie wird nur im Trefferfall gesetzt.
 */
const providerDownAt = new Map<GeocodeProvider, number>()

/** Wie lange ein gescheiterter Dienst hintanstehen muss, ehe er wieder vorn steht. */
export const PROVIDER_COOLDOWN_MS = 5 * 60_000

function providerIsDown(provider: GeocodeProvider, now: number): boolean {
  const since = providerDownAt.get(provider)
  return since !== undefined && now - since < PROVIDER_COOLDOWN_MS
}

export function resetProviderPreference(): void {
  preferredProvider = 'nominatim'
  providerDownAt.clear()
}

/** Arbeitet die Kaskade mit Nominatim ab. */
async function runNominatim(
  steps: readonly SearchStep[],
  opts: AddressSearchOptions,
): Promise<RawLookup> {
  let problem: GeocodeProblem | null = null
  for (const step of steps) {
    if (opts.signal?.aborted) return { hits: [], problem: null }
    const result =
      step.kind === 'free'
        ? await searchAddressRaw(step.query ?? '', opts)
        : await searchStructuredRaw(step.params ?? {}, opts)
    if (result.hits.length > 0) return result
    if (result.problem !== null) {
      problem = result.problem
      // Bei Drosselung oder Sperre haben weitere Schritte bei DIESEM Dienst
      // keinen Zweck - sie wuerden die Lage nur verschlimmern.
      if (problem === 'rate-limit' || problem === 'blocked') break
    }
  }
  return { hits: [], problem }
}

/**
 * Arbeitet dieselbe Kaskade mit Photon ab. Photon kennt keine strukturierte
 * Suche, deshalb werden die Felder zu einer Textanfrage zusammengesetzt.
 */
async function runPhoton(
  steps: readonly SearchStep[],
  opts: AddressSearchOptions,
): Promise<RawLookup> {
  const queries: string[] = []
  for (const step of steps) {
    const query =
      step.kind === 'free'
        ? (step.query ?? '')
        : ['street', 'postalcode', 'city']
            .map((field) => step.params?.[field] ?? '')
            .filter((value) => value !== '')
            .join(', ')
    const trimmed = query.trim()
    if (trimmed !== '' && !queries.includes(trimmed)) queries.push(trimmed)
  }

  let problem: GeocodeProblem | null = null
  for (const query of queries) {
    if (opts.signal?.aborted) return { hits: [], problem: null }
    const result = await photonLookup(query, opts)
    if (result.hits.length > 0) return result
    if (result.problem !== null) {
      problem = result.problem
      if (problem === 'rate-limit' || problem === 'blocked') break
    }
  }
  return { hits: [], problem }
}

export async function findAddress(
  query: string,
  opts: AddressSearchOptions = {},
): Promise<AddressLookup> {
  const wanted = wantedPrecision(query)
  const steps = buildSearchSteps(query)
  if (steps.length === 0) return { matches: [], problem: null }

  const bevorzugt: GeocodeProvider[] =
    preferredProvider === 'photon' ? ['photon', 'nominatim'] : ['nominatim', 'photon']
  // Wer zuletzt am Transport gescheitert ist, rueckt nach hinten - versucht
  // wird er trotzdem noch, denn er kann sich inzwischen erholt haben.
  const jetzt = Date.now()
  const order: GeocodeProvider[] = [
    ...bevorzugt.filter((p) => !providerIsDown(p, jetzt)),
    ...bevorzugt.filter((p) => providerIsDown(p, jetzt)),
  ]

  let problem: GeocodeProblem | null = null
  for (const provider of order) {
    if (opts.signal?.aborted) return { matches: [], problem: null }
    const result = provider === 'photon' ? await runPhoton(steps, opts) : await runNominatim(steps, opts)

    if (result.hits.length > 0) {
      preferredProvider = provider
      providerDownAt.delete(provider)
      return {
        matches: result.hits.map((hit) => describeMatch(hit, wanted)),
        problem: null,
        provider,
      }
    }
    // Ein Transportfehler heisst: dieser Dienst ist gerade nicht zu gebrauchen.
    // "Nichts gefunden" heisst das ausdruecklich NICHT - dann bleibt er vorn.
    if (result.problem !== null) providerDownAt.set(provider, Date.now())
    // Der erste gemeldete Grund ist der aussagekraeftigste: er stammt vom
    // bevorzugten Dienst.
    if (problem === null) problem = result.problem
  }
  return { matches: [], problem }
}

const PRECISION_RANK: Record<SearchPrecision, number> = { place: 0, street: 1, exact: 2 }

/** Wie genau die Eingabe ueberhaupt sein kann. */
function wantedPrecision(query: string): SearchPrecision {
  const parts = parseGermanAddress(query)
  if (parts.houseNumber !== null) return 'exact'
  if (parts.street !== null) return 'street'
  return 'place'
}

/** Wie genau der Treffer tatsaechlich ist. */
function reachedPrecision(hit: GeocodeHit): SearchPrecision {
  if (hit.houseNumber !== null) return 'exact'
  if (hit.road !== null) return 'street'
  return 'place'
}

/**
 * Der springende Punkt: Nominatim liefert auf "Horstwiesen 999" bereitwillig
 * die Strasse zurueck, ohne das kenntlich zu machen. Wer nach einer Hausnummer
 * gefragt hat, muss erfahren, dass er die Strassenmitte bekommen hat - sonst
 * landet der Standort stillschweigend am falschen Fleck.
 */
function describeMatch(hit: GeocodeHit, wanted: SearchPrecision): AddressMatch {
  const reached = reachedPrecision(hit)
  const genau = PRECISION_RANK[reached] >= PRECISION_RANK[wanted]
  const precision = genau ? 'exact' : reached
  return { ...hit, precision, note: genau ? null : precisionNote(reached) }
}

