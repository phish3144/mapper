/**
 * Reichweite eines Standorts: wie weit bzw. wie lange er anfaehrt.
 *
 * Bei HWPs stand das bisher nur im Namen - "75 min. / 100km", "max. 60
 * min.", "130km/90min", "Caliskan 150 km". Als eigenes Feld kann die
 * Umgebungssuche es pruefen: liegt die gesuchte Adresse innerhalb dessen,
 * was der HWP anfaehrt, oder nicht?
 *
 * Gemessen wird auf der Strasse, nicht in der Luftlinie - so meinen es die
 * Angaben, und so misst sie auch die Suche.
 */
import { formatDistance, formatDuration } from '@/lib/format'

export interface Reichweite {
  km: number | null
  minuten: number | null
}

const KM = /(\d{1,4})\s*(?:km|kilometer)(?![a-zäöü])/i
const MIN = /(\d{1,3})\s*min(?:\.|uten|\b)/i

/** Liest eine Reichweite aus freiem Text, etwa einem HWP-Namen. Was fehlt, bleibt null. */
export function reichweiteAusText(text: string): Reichweite {
  const km = KM.exec(text)
  const min = MIN.exec(text)
  const zahl = (m: RegExpExecArray | null) => {
    const n = m ? Number(m[1]) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return { km: zahl(km), minuten: zahl(min) }
}

export function hatReichweite(r: Reichweite): boolean {
  return r.km !== null || r.minuten !== null
}

export function reichweiteText(r: Reichweite): string {
  const teile: string[] = []
  if (r.minuten !== null) teile.push(`${r.minuten} Min.`)
  if (r.km !== null) teile.push(`${r.km} km`)
  return teile.join(' / ')
}

export type ReichweitenStatus = 'drin' | 'draussen' | 'offen'

export interface ReichweitenUrteil {
  status: ReichweitenStatus
  text: string
}

/**
 * Liegt eine Anfahrt innerhalb der Reichweite?
 *
 * "draussen", sobald EINE Grenze ueberschritten ist - wer 75 Minuten sagt,
 * faehrt keine 90, auch wenn die Kilometer passen. "drin" nur, wenn jede
 * angegebene Grenze auch geprueft werden konnte. Fehlt die Fahrstrecke, weil
 * der Routendienst schweigt, bleibt das Urteil "offen" - die Luftlinie
 * taugt dafuer nicht, sie liegt im Mittel ein Drittel zu kurz.
 *
 * null, wenn der Standort keine Reichweite hat - dann gibt es nichts zu sagen.
 */
export function reichweitenUrteil(
  r: Reichweite,
  fahrSekunden: number | null,
  fahrMeter: number | null,
): ReichweitenUrteil | null {
  if (!hatReichweite(r)) return null

  if (r.minuten !== null && fahrSekunden !== null && fahrSekunden / 60 > r.minuten) {
    return {
      status: 'draussen',
      text: `außerhalb: ${formatDuration(fahrSekunden)} statt max. ${r.minuten} Min.`,
    }
  }
  if (r.km !== null && fahrMeter !== null && fahrMeter / 1000 > r.km) {
    return { status: 'draussen', text: `außerhalb: ${formatDistance(fahrMeter)} statt max. ${r.km} km` }
  }

  const allesGeprueft =
    (r.minuten === null || fahrSekunden !== null) && (r.km === null || fahrMeter !== null)
  if (allesGeprueft) return { status: 'drin', text: `in Reichweite (${reichweiteText(r)})` }
  return { status: 'offen', text: `Reichweite ${reichweiteText(r)}` }
}
