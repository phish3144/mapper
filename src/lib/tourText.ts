/**
 * Eine Tour zum Weitergeben: als Google-Maps-Verweise und als Text.
 *
 * Fuer den Moment, in dem die Planung am Schreibtisch fertig ist und die Tour
 * aufs Telefon des Fahrers muss. Bewusst reiner Text: er geht in WhatsApp,
 * SMS und Mail gleichermassen und braucht beim Empfaenger kein Konto.
 */
import { formatDistance, formatDuration, formatTime, pluralize } from '@/lib/format'
import { MAX_WAYPOINTS, koordinatenText, tourNavigationUrls } from '@/lib/navigation'
import type { LatLng } from '@/types/domain'

export interface TourStopp extends LatLng {
  name: string
  address: string | null
  /** Geplante Ankunft, sofern die Tour eine Abfahrtszeit hat. */
  ankunft?: Date | null
}

/** Die Punkte, die navigiert werden - bei einer Rundtour zurueck zum Start. */
export function navigationsPunkte(stopps: readonly LatLng[], rundtour: boolean): LatLng[] {
  if (rundtour && stopps.length > 1) return [...stopps, stopps[0]]
  return [...stopps]
}

export interface TourAbschnitt {
  url: string
  /** Erster und letzter Stopp dieses Abschnitts, ab 1 gezaehlt. */
  von: number
  bis: number
}

/**
 * Die Verweise mit der Angabe, welche Stopps sie abdecken. Ohne die waere
 * "Abschnitt 2" fuer den Fahrer nur eine Zahl.
 */
export function tourAbschnitte(punkte: readonly LatLng[]): TourAbschnitt[] {
  const urls = tourNavigationUrls(punkte)
  const schritt = MAX_WAYPOINTS + 1
  return urls.map((url, k) => ({
    url,
    von: punkte.length === 1 ? 1 : k * schritt + 1,
    bis: punkte.length === 1 ? 1 : Math.min(k * schritt + schritt, punkte.length - 1) + 1,
  }))
}

export function tourAlsText(opts: {
  name: string
  stopps: readonly TourStopp[]
  rundtour: boolean
  gesamtMeter?: number | null
  gesamtSekunden?: number | null
}): string {
  const { name, stopps, rundtour } = opts
  const zeilen: string[] = [`${name} — ${pluralize(stopps.length, 'Stopp', 'Stopps')}`, '']

  stopps.forEach((s, i) => {
    const wo = s.address?.trim() || koordinatenText(s)
    const wann = s.ankunft ? ` — an ${formatTime(s.ankunft)}` : ''
    zeilen.push(`${i + 1}. ${s.name} — ${wo}${wann}`)
  })
  if (rundtour && stopps.length > 1) zeilen.push(`Zurück zu: ${stopps[0].name}`)

  if (opts.gesamtMeter && opts.gesamtSekunden) {
    zeilen.push('', `Gesamt: ${formatDistance(opts.gesamtMeter)}, ${formatDuration(opts.gesamtSekunden)} Fahrt`)
  }

  const abschnitte = tourAbschnitte(navigationsPunkte(stopps, rundtour))
  if (abschnitte.length === 1) {
    zeilen.push('', `Navigation: ${abschnitte[0].url}`)
  } else if (abschnitte.length > 1) {
    zeilen.push('', 'Navigation (Google Maps nimmt höchstens elf Punkte je Verweis):')
    for (const a of abschnitte) zeilen.push(`Stopps ${a.von}–${a.bis}: ${a.url}`)
  }
  return zeilen.join('\n')
}
