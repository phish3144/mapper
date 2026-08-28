import type { LatLng } from '@/types/domain'

const EARTH_RADIUS_KM = 6371.0088

const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Luftlinie in Kilometern (Haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function withinRadius(center: LatLng, point: LatLng, radiusKm: number): boolean {
  return haversineKm(center, point) <= radiusKm
}

export interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

/** Umschliessendes Rechteck. Gibt null zurueck, wenn keine Punkte vorliegen. */
export function boundsOf(points: readonly LatLng[]): Bounds | null {
  if (points.length === 0) return null
  let north = -90
  let south = 90
  let east = -180
  let west = 180
  for (const p of points) {
    if (p.lat > north) north = p.lat
    if (p.lat < south) south = p.lat
    if (p.lng > east) east = p.lng
    if (p.lng < west) west = p.lng
  }
  return { north, south, east, west }
}

export function centroidOf(points: readonly LatLng[]): LatLng | null {
  if (points.length === 0) return null
  let lat = 0
  let lng = 0
  for (const p of points) {
    lat += p.lat
    lng += p.lng
  }
  return { lat: lat / points.length, lng: lng / points.length }
}

export function isValidLatLng(value: unknown): value is LatLng {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.lat === 'number' && Number.isFinite(v.lat) && v.lat >= -90 && v.lat <= 90 &&
    typeof v.lng === 'number' && Number.isFinite(v.lng) && v.lng >= -180 && v.lng <= 180
  )
}

/** Koordinatenformat fuer die Anzeige, z. B. "52,5170 / 13,4050". */
export function formatLatLng(p: LatLng, digits = 4): string {
  const f = (n: number) => n.toFixed(digits).replace('.', ',')
  return `${f(p.lat)} / ${f(p.lng)}`
}
