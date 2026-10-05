/**
 * Verweis in eine Navigations-App.
 *
 * Bewusst die Google-Maps-Adresse mit `api=1`: sie ist der einzige Weg, der
 * auf allen drei Zielen dasselbe tut - im Browser oeffnet sie die Karte, auf
 * Android die Maps-App, auf iOS die Maps-App, sofern installiert, sonst den
 * Browser. Ein geo:-Verweis kann zwar mehr Apps, wird aber am Schreibtisch
 * von nichts beantwortet, und genau dort wird hier geplant.
 *
 * Uebergeben werden Koordinaten und keine Namen: ein Standortname wie
 * "Bisol GmbH - Team Hannover" ist keine Adresse und wuerde dort neu und
 * womoeglich falsch gesucht.
 */
import type { LatLng } from '@/types/domain'

const STELLEN = 6

const punkt = (p: LatLng): string => `${p.lat.toFixed(STELLEN)},${p.lng.toFixed(STELLEN)}`

export function navigationUrl(from: LatLng, to: LatLng): string {
  const params = new URLSearchParams({
    api: '1',
    origin: punkt(from),
    destination: punkt(to),
    travelmode: 'driving',
  })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/**
 * So viele Zwischenziele nimmt ein Google-Maps-Verweis hoechstens. Laut
 * Dokumentation neun in der App und am Rechner, im mobilen Browser nur drei.
 * Geplant wird fuer die App: auf dem Telefon oeffnet der Verweis sie, sobald
 * sie installiert ist.
 */
export const MAX_WAYPOINTS = 9

/**
 * Navigation zu einem einzelnen Ziel. Ohne Start nimmt Google den Standort
 * des Geraets - unterwegs genau das Richtige, und Google rechnet dabei mit
 * Verkehr, was unsere Fahrzeiten nicht koennen.
 */
export function navigationUrlTo(to: LatLng): string {
  const params = new URLSearchParams({
    api: '1',
    destination: punkt(to),
    travelmode: 'driving',
  })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/**
 * Eine ganze Tour als Google-Maps-Verweise, in der Reihenfolge der Stopps.
 *
 * Mehr als MAX_WAYPOINTS Zwischenziele passen nicht in einen Verweis. Laengere
 * Touren werden deshalb in Abschnitte geteilt, und jeder Abschnitt beginnt
 * genau dort, wo der vorige endet - kein Stopp faellt zwischen zwei Verweise.
 */
export function tourNavigationUrls(points: readonly LatLng[]): string[] {
  if (points.length === 0) return []
  if (points.length === 1) return [navigationUrlTo(points[0])]

  const schritt = MAX_WAYPOINTS + 1
  const urls: string[] = []
  for (let i = 0; i < points.length - 1; i += schritt) {
    const abschnitt = points.slice(i, i + schritt + 1)
    const params = new URLSearchParams({
      api: '1',
      origin: punkt(abschnitt[0]),
      destination: punkt(abschnitt[abschnitt.length - 1]),
      travelmode: 'driving',
    })
    const zwischen = abschnitt.slice(1, -1)
    if (zwischen.length > 0) params.set('waypoints', zwischen.map(punkt).join('|'))
    urls.push(`https://www.google.com/maps/dir/?${params.toString()}`)
  }
  return urls
}

/** Koordinaten so, wie Google Maps und jedes Navi sie beim Einfuegen versteht. */
export function koordinatenText(p: LatLng): string {
  return `${p.lat.toFixed(STELLEN)}, ${p.lng.toFixed(STELLEN)}`
}
