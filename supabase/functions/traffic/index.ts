/**
 * traffic — Sperrungen und Baustellen der deutschen Autobahnen.
 *
 * Quelle ist die offene API der Autobahn GmbH des Bundes. Sie ist kostenlos,
 * braucht keinen Schluessel und erlaubt sogar den Zugriff aus dem Browser -
 * trotzdem laeuft sie hier ueber den Server, und zwar aus einem Grund: sie
 * kennt keinen Sammelabruf. Ein vollstaendiger Stand kostet 216 Anfragen
 * (108 Autobahnen mal zwei Meldungsarten). Das kann man einem Browser nicht
 * antun und dem Dienst erst recht nicht.
 *
 * Hier passiert es einmal je zehn Minuten fuer alle Nutzer zusammen.
 *
 * Was zurueckkommt, ist bewusst klein: die Rohantworten sind zusammen mehrere
 * Megabyte, gebraucht wird davon ein Bruchteil. Sperrungen behalten ihre
 * Linie - man will sehen, WELCHER Abschnitt dicht ist -, Baustellen nur ihren
 * Punkt.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-region, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const BASIS = 'https://verkehr.autobahn.de/o/autobahn'
const CACHE_KEY = 'autobahn'
/** Kurz genug fuer eine frische Vollsperrung, lang genug fuer die fremde API. */
const TTL_MS = 10 * 60_000
/** Gleichzeitige Anfragen nach draussen. Gemessen: 216 Abrufe in rund 4 s. */
const PARALLEL = 12
const UPSTREAM_TIMEOUT_MS = 20_000
/** Koordinaten auf 5 Stellen: rund 1 m, mehr ist bei einer Baustelle Schein. */
const STELLEN = 5

type Art = 'closure' | 'roadworks'
const ARTEN: Art[] = ['closure', 'roadworks']

interface Meldung {
  /** 'c' = Sperrung, 'b' = Baustelle. Ein Buchstabe, weil es 3.800-mal vorkommt. */
  k: 'c' | 'b'
  r: string
  t: string
  s: string
  lat: number
  lng: number
  /** Zeitraum als "Beginn|Ende", soweit die Beschreibung ihn hergibt. */
  z?: string
  /** Gesperrter Abschnitt, nur bei Sperrungen. Flach: [lat,lng,lat,lng,...]. */
  g?: number[]
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/** Wie bei geocode: der Gateway laesst auch den anon-Schluessel durch. */
function hasUserToken(authorization: string | null): boolean {
  if (!authorization) return false
  const parts = authorization.replace(/^Bearer\s+/i, '').trim().split('.')
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

const rund = (n: number): number => Number(n.toFixed(STELLEN))

const RE_BEGINN = /Beginn:\s*([^()]+?)\s*(?:Ende:|$)/
const RE_ENDE = /\bEnde:\s*([^()]+?)\s*(?:\(|Zeitraum|$)/

/**
 * Der Zeitraum steckt nur im Fliesstext der Beschreibung - ein Endfeld gibt
 * es in der API nicht. Gelingt das Herausloesen nicht, bleibt der Zeitraum
 * eben leer; ein falsch geratener waere schlimmer als keiner.
 */
function zeitraum(beschreibung: string): string | undefined {
  const b = RE_BEGINN.exec(beschreibung)?.[1]?.trim()
  const e = RE_ENDE.exec(beschreibung)?.[1]?.trim()
  return b || e ? `${b ?? ''}|${e ?? ''}` : undefined
}

interface RohMeldung {
  title?: unknown
  subtitle?: unknown
  coordinate?: { lat?: unknown; long?: unknown }
  description?: unknown
  geometry?: { type?: unknown; coordinates?: unknown }
}

function umwandeln(roh: RohMeldung, art: Art, strasse: string): Meldung | null {
  const lat = Number(roh.coordinate?.lat)
  const lng = Number(roh.coordinate?.long)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const titel = typeof roh.title === 'string' ? roh.title : ''
  const beschreibung = Array.isArray(roh.description)
    ? roh.description.filter((z): z is string => typeof z === 'string').join(' ')
    : ''

  const meldung: Meldung = {
    k: art === 'closure' ? 'c' : 'b',
    r: strasse,
    // Der Titel beginnt fast immer mit "A2 | " - die Strasse steht schon in r.
    t: titel.replace(new RegExp(`^${strasse}\\s*\\|\\s*`), '').trim(),
    s: typeof roh.subtitle === 'string' ? roh.subtitle.trim() : '',
    lat: rund(lat),
    lng: rund(lng),
  }
  const z = zeitraum(beschreibung)
  if (z) meldung.z = z

  // Nur Sperrungen bekommen die Linie: bei 3.200 Baustellen waere sie der
  // groesste Teil der Nutzlast, ohne etwas zu beantworten.
  if (art === 'closure' && roh.geometry?.type === 'LineString' && Array.isArray(roh.geometry.coordinates)) {
    const flach: number[] = []
    for (const paar of roh.geometry.coordinates as unknown[]) {
      if (!Array.isArray(paar) || paar.length < 2) continue
      const x = Number(paar[0])
      const y = Number(paar[1])
      // Die API liefert [lon,lat]; hier wird auf [lat,lng] gedreht, weil
      // Leaflet das so erwartet und die Umrechnung sonst 17.000-mal im
      // Browser passierte.
      if (Number.isFinite(x) && Number.isFinite(y)) flach.push(rund(y), rund(x))
    }
    if (flach.length >= 4) meldung.g = flach
  }
  return meldung
}

/** null heisst "Abruf misslungen"; eine leere Liste heisst "nichts los". */
async function holeArt(strasse: string, art: Art): Promise<Meldung[] | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASIS}/${strasse}/services/${art}`, { signal: controller.signal })
    if (!res.ok) return null
    const body = (await res.json()) as Record<string, unknown>
    const liste = body[art]
    if (!Array.isArray(liste)) return null
    const raus: Meldung[] = []
    for (const eintrag of liste) {
      const m = umwandeln(eintrag as RohMeldung, art, strasse)
      if (m) raus.push(m)
    }
    return raus
  } catch {
    // Eine fehlende Autobahn ist besser als gar keine Karte. Wie viele
    // fehlen, steht im Zaehler unten.
    return null
  } finally {
    clearTimeout(timer)
  }
}

interface Stand {
  fetchedAt: string
  items: Meldung[]
  /** Wie viele der 216 Abrufe nichts lieferten - Ehrlichkeit ueber Luecken. */
  failed: number
  roads: number
}

async function holeAlles(): Promise<Stand> {
  const res = await fetch(`${BASIS}/`)
  const { roads } = (await res.json()) as { roads?: unknown }
  const strassen = Array.isArray(roads) ? roads.filter((r): r is string => typeof r === 'string') : []

  const auftraege: [string, Art][] = []
  for (const s of strassen) for (const a of ARTEN) auftraege.push([s, a])

  const items: Meldung[] = []
  let failed = 0
  let i = 0
  async function arbeiter(): Promise<void> {
    while (i < auftraege.length) {
      const [strasse, art] = auftraege[i++]
      const teil = await holeArt(strasse, art)
      // Unterscheidung, die zaehlt: keine Meldungen ist ein Ergebnis,
      // kein Abruf ist eine Luecke.
      if (teil === null) failed++
      else items.push(...teil)
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, arbeiter))

  return { fetchedAt: new Date().toISOString(), items, failed, roads: strassen.length }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (!hasUserToken(req.headers.get('Authorization'))) {
    return json({ error: 'Nicht angemeldet.' }, 401)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'Der Dienst ist nicht vollständig eingerichtet.' }, 500)
  const service: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data } = await service
    .from('traffic_cache')
    .select('payload, fetched_at')
    .eq('key', CACHE_KEY)
    .maybeSingle()

  if (data) {
    const row = data as { payload: Stand; fetched_at: string }
    const alter = Date.now() - new Date(row.fetched_at).getTime()
    if (alter < TTL_MS) return json({ data: { ...row.payload, cached: true } }, 200)
  }

  try {
    const stand = await holeAlles()
    const { error } = await service
      .from('traffic_cache')
      .upsert({ key: CACHE_KEY, payload: stand, fetched_at: stand.fetchedAt }, { onConflict: 'key' })
    if (error) console.error(`traffic: nicht zwischenspeicherbar (${error.code ?? 'ohne Code'})`)
    return json({ data: { ...stand, cached: false } }, 200)
  } catch (error) {
    // Lieber ein veralteter Stand als gar keiner: eine Sperrung von vor einer
    // Stunde ist fast immer noch eine Sperrung.
    if (data) {
      const row = data as { payload: Stand }
      return json({ data: { ...row.payload, cached: true, stale: true } }, 200)
    }
    const text = error instanceof Error ? error.message : 'unbekannter Fehler'
    return json({ error: `Verkehrsmeldungen nicht erreichbar (${text}).` }, 502)
  }
})
