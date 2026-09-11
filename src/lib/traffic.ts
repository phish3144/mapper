/**
 * Sperrungen und Baustellen der deutschen Autobahnen - die Clientseite.
 *
 * Die Daten kommen von der Edge Function `traffic`, die ihrerseits die offene
 * API der Autobahn GmbH des Bundes abfragt. Warum ueber den Server und nicht
 * unmittelbar, steht dort; hier zaehlt nur, was herauskommt.
 *
 * Diese Datei enthaelt absichtlich keine React- und keine Leaflet-Teile: die
 * Umrechnung der Geometrie und das Lesen des Zeitraums sind fuer sich pruefbar
 * und werden es auch.
 */
/**
 * Eine Meldung, so knapp wie sie ueber die Leitung geht.
 *
 * Die Einbuchstabennamen sind kein Geiz um des Geizes willen: der Stand
 * enthaelt rund 3.800 Meldungen, und ausgeschriebene Schluessel machten die
 * Antwort gut ein Drittel groesser. Die Bedeutung steht hier, ein einziges
 * Mal, und stimmt mit supabase/functions/traffic/index.ts ueberein.
 */
export interface Verkehrsmeldung {
  /** 'c' = Sperrung, 'b' = Baustelle. */
  k: 'c' | 'b'
  /** Autobahn, z.B. "A3". */
  r: string
  /** Ueberschrift, ohne das vorangestellte "A3 | ". */
  t: string
  /** Zweite Zeile der Quelle - meist Anschlussstellen oder Fahrtrichtung. */
  s: string
  lat: number
  lng: number
  /** Zeitraum als "Beginn|Ende", soweit die Beschreibung ihn hergab. */
  z?: string
  /** Gesperrter Abschnitt, nur bei Sperrungen. Flach: [lat,lng,lat,lng,...]. */
  g?: number[]
}

/** Ein vollstaendiger Stand, so wie ihn die Edge Function liefert. */
export interface Verkehrsstand {
  fetchedAt: string
  items: Verkehrsmeldung[]
  /** Wie viele Abrufe nach draussen nichts lieferten - Luecken benennen. */
  failed: number
  /** Wie viele Autobahnen befragt wurden. */
  roads: number
  /** Kam aus dem Zwischenspeicher des Servers. */
  cached?: boolean
  /** Der Zwischenspeicher war abgelaufen, die Quelle aber nicht erreichbar. */
  stale?: boolean
}

/**
 * Wie lange ein einmal geholter Stand im Browser genuegt.
 *
 * Kuerzer als die zehn Minuten des Servers waere sinnlos - dann kaeme
 * ohnehin dieselbe Antwort zurueck. Fuenf Minuten heisst also: wer die Ebene
 * aus- und gleich wieder einschaltet, laedt nicht neu; wer sie nach einer
 * Kaffeepause wieder einschaltet, bekommt den neuen Stand.
 */
export const CLIENT_TTL_MS = 5 * 60_000

let gemerkt: { stand: Verkehrsstand; geholt: number } | null = null
let laeuft: Promise<Verkehrsstand> | null = null

/** Nur fuer Tests: den Modulspeicher leeren. */
export function resetVerkehrCache(): void {
  gemerkt = null
  laeuft = null
}

/** Der zuletzt geholte Stand, ohne etwas anzustossen. */
export function gemerkterStand(): Verkehrsstand | null {
  if (!gemerkt) return null
  return Date.now() - gemerkt.geholt < CLIENT_TTL_MS ? gemerkt.stand : null
}

function istStand(wert: unknown): wert is Verkehrsstand {
  const s = wert as Verkehrsstand | null
  return !!s && Array.isArray(s.items) && typeof s.fetchedAt === 'string'
}

async function frageAb(): Promise<Verkehrsstand> {
  // Dynamisch wie in geocode.ts: so bleibt supabase aus dem Modulgraphen der
  // Tests, und die Auswertung hier ist ohne Anmeldung pruefbar.
  const { supabase } = await import('./supabase')
  const { data, error } = await supabase.functions.invoke('traffic', { body: {} })

  if (error) {
    // Die Funktion legt ihre eigene Meldung in den Rumpf; supabase-js
    // verpackt sie in einen allgemeinen FunctionsHttpError.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = (await ctx.json()) as { error?: string }
        if (payload?.error) throw new Error(payload.error)
      } catch (leseFehler) {
        if (leseFehler instanceof Error && leseFehler.message && !/JSON/i.test(leseFehler.message)) {
          throw leseFehler
        }
      }
    }
    throw error
  }

  const payload = data as { data?: unknown; error?: string }
  if (payload?.error) throw new Error(payload.error)
  if (!istStand(payload?.data)) throw new Error('Die Verkehrsmeldungen kamen unerwartet zurueck.')
  return payload.data
}

/**
 * Holt den Stand - hoechstens einmal je TTL und hoechstens einmal gleichzeitig.
 *
 * Zwei schnelle Klicks auf den Schalter sollen nicht zwei Abrufe ergeben,
 * deshalb wird auch die laufende Anfrage gemerkt.
 */
export async function ladeVerkehr(): Promise<Verkehrsstand> {
  const frisch = gemerkterStand()
  if (frisch) return frisch
  laeuft ??= frageAb()
    .then((stand) => {
      gemerkt = { stand, geholt: Date.now() }
      return stand
    })
    .finally(() => {
      laeuft = null
    })
  return laeuft
}

/**
 * Die flache Punktfolge [lat,lng,lat,lng,...] als Paare fuer Leaflet.
 *
 * Flach kommt sie, weil sie fuer 17.000 Punkte als JSON so rund ein Drittel
 * kleiner ist als verschachtelt. Ein unvollstaendiges letztes Paar wird
 * verworfen statt geraten.
 */
export function linie(g: number[] | undefined): [number, number][] {
  if (!g) return []
  const punkte: [number, number][] = []
  for (let i = 0; i + 1 < g.length; i += 2) punkte.push([g[i], g[i + 1]])
  return punkte
}

/**
 * Der Umfassungsrahmen einer Meldung als [suedLat, westLng, nordLat, ostLng].
 *
 * Gebraucht, um beim Verschieben der Karte in einem Zug zu entscheiden, ob
 * eine Sperrung ueberhaupt in den Ausschnitt ragt. Ohne die Linie ist es der
 * Punkt selbst.
 */
export function bereich(m: Verkehrsmeldung): [number, number, number, number] {
  let sued = m.lat
  let nord = m.lat
  let west = m.lng
  let ost = m.lng
  const g = m.g
  if (g) {
    for (let i = 0; i + 1 < g.length; i += 2) {
      if (g[i] < sued) sued = g[i]
      if (g[i] > nord) nord = g[i]
      if (g[i + 1] < west) west = g[i + 1]
      if (g[i + 1] > ost) ost = g[i + 1]
    }
  }
  return [sued, west, nord, ost]
}

/**
 * Der Zeitraum als lesbarer Satz.
 *
 * Die Funktion bekommt "Beginn|Ende"; beide Haelften koennen fehlen, weil die
 * Quelle den Zeitraum nur im Fliesstext fuehrt. Fehlen beide, gibt es keinen
 * Zeitraum - und dann steht in der Sprechblase auch keiner, statt eines
 * geratenen.
 */
export function zeitraumText(z: string | undefined): string | null {
  if (!z) return null
  const [beginn = '', ende = ''] = z.split('|')
  const b = beginn.trim()
  const e = ende.trim()
  if (b && e) return `${b} bis ${e}`
  if (b) return `ab ${b}`
  if (e) return `bis ${e}`
  return null
}

/** Uhrzeit des Standes, kurz - "Stand 14:32" ist die ganze Aussage. */
export function standZeit(fetchedAt: string): string {
  const d = new Date(fetchedAt)
  if (Number.isNaN(d.getTime())) return '?'
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}
