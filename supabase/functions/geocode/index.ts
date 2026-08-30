/**
 * geocode — Bote fuer die Adresssuche.
 *
 * Warum es das gibt: der Browser fragte die Geocoder bisher unmittelbar. Im
 * Netz mancher Anwenderin ist nominatim.openstreetmap.org gesperrt — durch
 * einen Werbeblocker, einen DNS-Filter oder eine Firewall. Von aussen laesst
 * sich das weder erkennen noch beheben. Ueber diese Funktion spricht der
 * Browser nur noch mit der Supabase-Adresse, die er ohnehin schon erreicht.
 *
 * Drei Dinge kommen hinzu, die im Browser nicht moeglich sind:
 *
 * 1. Ein Zwischenspeicher, den ALLE Nutzer teilen. Die zweite Suche nach
 *    derselben Strasse braucht keinen Anruf nach draussen mehr.
 * 2. Eine ehrliche Kennung (User-Agent). Nominatims Nutzungsrichtlinie
 *    verlangt sie; Browser verbieten es, diesen Kopf zu setzen.
 * 3. Eine gemeinsame Bremse. Sobald der Server fragt, teilen sich alle Nutzer
 *    eine Kennung — ohne Absprache ueberschritten schon drei gleichzeitige
 *    Suchen Nominatims Grenze von einer Anfrage je Sekunde.
 *
 * Ausdruecklich NICHT hier: das Auswerten der Antworten. Die Funktion reicht
 * den Rohtext des Dienstes durch, damit die Auswertung an einer Stelle bleibt
 * — im Client, wo sie getestet ist.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

type Client = SupabaseClient

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-region, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

/** Nominatims Nutzungsrichtlinie verlangt eine Kennung, die die Anwendung benennt. */
const USER_AGENT = 'mapper/1.0 (Standort- und Routenplanung; +https://github.com/phish3144/mapper)'

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
const PHOTON_URL = 'https://photon.komoot.io'

/** Nominatim: hoechstens eine Anfrage je Sekunde. Etwas Luft eingerechnet. */
const NOMINATIM_MIN_MS = 1100
/** Photon kennt keine solche Grenze; ein kleiner Abstand bleibt hoeflich. */
const PHOTON_MIN_MS = 200

/** Adressen aendern sich selten. */
const CACHE_TTL_HIT_MS = 30 * 24 * 60 * 60_000
/**
 * Leere Antworten deutlich kuerzer: eine Adresse, die heute fehlt, kann morgen
 * in OpenStreetMap stehen. Ganz ohne Merken wuerde eine unbekannte Adresse den
 * Dienst bei jedem Tastendruck erneut belasten.
 */
const CACHE_TTL_MISS_MS = 60 * 60_000

const UPSTREAM_TIMEOUT_MS = 8000

type Provider = 'nominatim' | 'photon'

interface RequestBody {
  q?: unknown
  structured?: unknown
  limit?: unknown
  provider?: unknown
}

function json(payload: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  })
}

function fail(message: string, status: number): Response {
  return json({ error: message }, status)
}

/**
 * Der Gateway prueft bereits die Signatur — aber ein gueltiger Token ist auch
 * der oeffentliche anon-Schluessel, und der traegt kein Subjekt. Hier wird
 * deshalb verlangt, dass wirklich ein angemeldetes Konto dahintersteht, sonst
 * waere der Bote ein offener Geocoding-Dienst fuer jedermann.
 */
function hasUserToken(authorization: string | null): boolean {
  if (!authorization) return false
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))) as {
      sub?: unknown
      role?: unknown
    }
    return typeof payload.sub === 'string' && payload.sub !== '' && payload.role === 'authenticated'
  } catch {
    return false
  }
}

function clampLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 8
  return Math.min(20, Math.max(1, Math.trunc(n)))
}

function structuredFields(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const allowed = ['street', 'postalcode', 'city', 'country', 'state', 'county']
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.includes(key)) continue
    if (typeof raw === 'string' && raw.trim() !== '') out[key] = raw.trim().slice(0, 200)
  }
  return out
}

/** Gleiche Anfrage, gleicher Schluessel — unabhaengig von Schreibweise und Feldreihenfolge. */
function cacheKey(provider: Provider, query: string, fields: Record<string, string>, limit: number): string {
  const structured = Object.entries(fields)
    .map(([k, v]) => `${k}=${v.toLowerCase()}`)
    .sort()
    .join('&')
  const normalized = query.trim().replace(/\s+/g, ' ').toLowerCase()
  return `${provider}|${limit}|${normalized}|${structured}`
}

function buildUrl(
  provider: Provider,
  query: string,
  fields: Record<string, string>,
  limit: number,
): string | null {
  if (provider === 'photon') {
    // Photon kennt keine strukturierte Suche; die Felder werden zu einer
    // Textanfrage zusammengezogen.
    const text =
      query.trim() !== ''
        ? query.trim()
        : ['street', 'postalcode', 'city'].map((f) => fields[f] ?? '').filter(Boolean).join(', ')
    if (text === '') return null
    const params = new URLSearchParams({ q: text, limit: String(limit), lang: 'de' })
    return `${PHOTON_URL}/api?${params.toString()}`
  }

  const params = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limit),
    'accept-language': 'de',
  })
  if (query.trim() !== '') params.set('q', query.trim())
  for (const [field, value] of Object.entries(fields)) params.set(field, value)
  if (!params.has('q') && Object.keys(fields).length === 0) return null
  return `${NOMINATIM_URL}/search?${params.toString()}`
}

/**
 * Lesen und Zaehlen erledigt Postgres in einem Zug: der Ablauf wird an der
 * Quelle geprueft, und der Treffer wird gleich vermerkt. Ein abgelaufener
 * Eintrag liefert null, genau wie ein fehlender.
 */
async function readCache(service: Client, key: string): Promise<unknown | null> {
  const { data, error } = await service.rpc('geocode_cache_read', { p_key: key })
  if (error) {
    console.error(`geocode: Zwischenspeicher nicht lesbar (${error.code ?? 'ohne Code'})`)
    return null
  }
  return data ?? null
}

async function writeCache(service: Client, key: string, payload: unknown, empty: boolean): Promise<void> {
  const ttl = empty ? CACHE_TTL_MISS_MS : CACHE_TTL_HIT_MS
  const { error } = await service.from('geocode_cache').upsert(
    {
      key,
      payload,
      expires_at: new Date(Date.now() + ttl).toISOString(),
    },
    { onConflict: 'key' },
  )
  // Ein misslungener Schreibvorgang darf die Antwort nicht gefaehrden - der
  // Zwischenspeicher ist Beschleunigung, nicht Voraussetzung.
  if (error) console.error(`geocode: Zwischenspeicher nicht beschreibbar (${error.code ?? 'ohne Code'})`)
}

async function mayCall(service: Client, provider: Provider): Promise<boolean> {
  const { data, error } = await service.rpc('geocode_may_call', {
    p_provider: provider,
    p_min_ms: provider === 'nominatim' ? NOMINATIM_MIN_MS : PHOTON_MIN_MS,
  })
  if (error) {
    console.error(`geocode: Bremse nicht lesbar (${error.code ?? 'ohne Code'})`)
    // Im Zweifel durchlassen: eine defekte Bremse darf die Suche nicht
    // lahmlegen. Der Client faellt sonst auf den Direktweg zurueck.
    return true
  }
  return data === true
}

interface Fetched {
  body: unknown
  empty: boolean
}

async function callProvider(provider: Provider, url: string): Promise<Fetched> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Accept-Language': 'de', 'User-Agent': USER_AGENT },
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const body = (await response.json()) as unknown
    const empty = Array.isArray(body)
      ? body.length === 0
      : Array.isArray((body as { features?: unknown }).features)
        ? ((body as { features: unknown[] }).features.length === 0)
        : true
    return { body, empty }
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return fail('Nur POST wird unterstuetzt.', 405)

  if (!hasUserToken(req.headers.get('Authorization'))) {
    return fail('Nicht angemeldet.', 401)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return fail('Der Dienst ist nicht vollstaendig eingerichtet.', 500)
  const service = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return fail('Der Anfragerumpf ist kein gueltiges JSON.', 400)
  }

  const query = typeof body.q === 'string' ? body.q.slice(0, 300) : ''
  const fields = structuredFields(body.structured)
  const limit = clampLimit(body.limit)
  if (query.trim() === '' && Object.keys(fields).length === 0) {
    return fail('Es wurde keine Anfrage uebergeben.', 400)
  }

  const wanted = body.provider === 'nominatim' || body.provider === 'photon' ? body.provider : 'auto'
  const order: Provider[] = wanted === 'auto' ? ['nominatim', 'photon'] : [wanted]

  // 1. Zwischenspeicher — beide Dienste, denn welcher geantwortet hat, ist der
  //    Anruferin gleich.
  for (const provider of order) {
    const key = cacheKey(provider, query, fields, limit)
    const cached = await readCache(service, key)
    if (cached !== null) {
      void service.rpc('geocode_cache_sweep').then(() => undefined, () => undefined)
      return json({ data: { provider, body: cached, cached: true } }, 200)
    }
  }

  // 2. Nach draussen, aber nur wenn die Bremse es erlaubt.
  let lastError = ''
  for (const provider of order) {
    const target = buildUrl(provider, query, fields, limit)
    if (target === null) continue

    if (wanted === 'auto' && !(await mayCall(service, provider))) {
      // Nicht warten, sondern den naechsten Dienst nehmen - Warten waere
      // genau die Verzoegerung, die diese Funktion beseitigen soll.
      lastError = `${provider} ist gerade gebremst`
      continue
    }
    if (wanted !== 'auto') {
      await mayCall(service, provider)
    }

    try {
      const fetched = await callProvider(provider, target)
      await writeCache(service, cacheKey(provider, query, fields, limit), fetched.body, fetched.empty)
      return json({ data: { provider, body: fetched.body, cached: false } }, 200)
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'unbekannter Fehler'
      console.error(`geocode: ${provider} fehlgeschlagen (${lastError})`)
    }
  }

  return fail(`Kein Adressdienst hat geantwortet (${lastError || 'ohne naehere Angabe'}).`, 502)
})
