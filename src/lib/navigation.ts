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
