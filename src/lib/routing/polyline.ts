/**
 * Encoded Polyline Algorithm Format (Google), wie ihn OSRM fuer
 * `geometries=polyline` (Praezision 5) bzw. `polyline6` (Praezision 6) nutzt.
 */

import type { LatLng } from '@/types/domain'

/**
 * Kaufmaennisches Runden weg von der Null. Der Referenzalgorithmus stammt aus
 * Python 2; JavaScripts Math.round rundet -0.5 auf -0 statt auf -1 und wuerde
 * bei negativen Koordinaten um eine Einheit abweichende Zeichenketten liefern.
 */
function roundHalfAwayFromZero(value: number): number {
  return Math.floor(Math.abs(value) + 0.5) * (value < 0 ? -1 : 1)
}

/**
 * Dekodiert eine Polyline zu Koordinaten. Abgeschnittene oder ungueltige
 * Eingaben brechen die Auswertung ab, statt Unsinn anzuhaengen.
 */
export function decodePolyline(str: string, precision = 5): LatLng[] {
  const factor = 10 ** precision
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0

  const readDelta = (): number | null => {
    let result = 0
    let shift = 0
    let byte = 0
    do {
      if (index >= str.length) return null
      byte = str.charCodeAt(index++) - 63
      if (byte < 0) return null
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    // Bit 0 traegt das Vorzeichen (Zickzack-Kodierung).
    return (result & 1) !== 0 ? ~(result >> 1) : result >> 1
  }

  while (index < str.length) {
    const dLat = readDelta()
    if (dLat === null) break
    const dLng = readDelta()
    if (dLng === null) break
    lat += dLat
    lng += dLng
    points.push({ lat: lat / factor, lng: lng / factor })
  }

  return points
}

function encodeValue(current: number, previous: number, factor: number): string {
  const currentUnits = roundHalfAwayFromZero(current * factor)
  const previousUnits = roundHalfAwayFromZero(previous * factor)
  let value = (currentUnits - previousUnits) * 2
  if (value < 0) value = -value - 1

  let output = ''
  while (value >= 0x20) {
    output += String.fromCharCode((0x20 | (value & 0x1f)) + 63)
    value = Math.floor(value / 32)
  }
  output += String.fromCharCode(value + 63)
  return output
}

/** Kodiert Koordinaten zu einer Polyline. Umkehrung von decodePolyline. */
export function encodePolyline(points: readonly LatLng[], precision = 5): string {
  if (points.length === 0) return ''
  const factor = 10 ** precision
  const first = points[0]
  let output = encodeValue(first.lat, 0, factor) + encodeValue(first.lng, 0, factor)
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]
    const current = points[i]
    output += encodeValue(current.lat, previous.lat, factor)
    output += encodeValue(current.lng, previous.lng, factor)
  }
  return output
}
