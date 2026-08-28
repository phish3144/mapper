/**
 * Photon als zweiter Geocoder neben Nominatim.
 *
 * Warum ueberhaupt ein zweiter: Nominatim ist ein ehrenamtlich betriebener
 * Dienst und kann aus Gruenden ausfallen, die niemand hier in der Hand hat —
 * Drosselung, Sperre, ein Filter im Netz der Anwenderin. Genau das ist
 * aufgetreten. Ein Ausfall darf nicht heissen, dass eine Adresse "nicht
 * gefunden" wird.
 *
 * Photon (Komoot) arbeitet auf denselben OpenStreetMap-Daten, ist ohne
 * Schluessel nutzbar und liefert CORS-Kopfzeilen. Fuer die gemeldete Adresse
 * gibt es punktgleich dasselbe Ergebnis wie Nominatim.
 *
 * Die Umwandlung steht hier als reine Funktion, damit sie ohne Netz pruefbar
 * ist; das Abrufen erledigt geocode.ts.
 */
import { isValidLatLng } from '@/lib/geo'
import type { Bounds } from '@/lib/geo'
import type { LatLng } from '@/types/domain'

function readEnv(name: string): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env
  const value = env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

export const PHOTON_PUBLIC_URL = 'https://photon.komoot.io'

export const PHOTON_BASE_URL = (readEnv('VITE_PHOTON_BASE_URL') || PHOTON_PUBLIC_URL).replace(/\/+$/, '')

/** Was die Umwandlung aus einem Photon-Merkmal herausholt. */
export interface PhotonHit {
  label: string
  lat: number
  lng: number
  type: string | null
  boundingBox: Bounds | null
  houseNumber: string | null
  road: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Photon liefert die Bestandteile einzeln, nicht als fertige Zeile. Die
 * Reihenfolge folgt der deutschen Schreibweise: Strasse Hausnummer, PLZ Ort.
 */
export function photonLabel(properties: Record<string, unknown>): string {
  const street = text(properties.street)
  const houseNumber = text(properties.housenumber)
  const name = text(properties.name)
  const postcode = text(properties.postcode)
  const city = text(properties.city) ?? text(properties.county)
  const state = text(properties.state)
  const country = text(properties.country)
  const district = text(properties.district)

  const strasse = street !== null ? [street, houseNumber].filter(Boolean).join(' ') : null
  // Traegt der Treffer einen Eigennamen (Betrieb, Sehenswuerdigkeit) und ist
  // der nicht schon die Strasse, steht er vorn - so sucht man ihn auch.
  const kopf = name !== null && name !== street ? name : null

  const teile = [
    kopf,
    strasse,
    district !== null && district !== city ? district : null,
    [postcode, city].filter(Boolean).join(' ') || null,
    state,
    country,
  ].filter((part): part is string => part !== null && part !== '')

  return teile.length > 0 ? teile.join(', ') : 'Unbenannter Ort'
}

/**
 * Photons `extent` ist [west, north, east, south] — nicht die anderswo
 * uebliche Reihenfolge. Nachgemessen an einer echten Antwort.
 */
export function photonExtent(value: unknown): Bounds | null {
  if (!Array.isArray(value) || value.length < 4) return null
  const west = finite(value[0])
  const north = finite(value[1])
  const east = finite(value[2])
  const south = finite(value[3])
  if (west === null || north === null || east === null || south === null) return null
  if (north < south) return null
  return { west, north, east, south }
}

/** Wandelt ein GeoJSON-Merkmal von Photon um. Gibt null zurueck, wenn es unbrauchbar ist. */
export function photonToHit(feature: unknown): PhotonHit | null {
  const raw = asRecord(feature)
  if (!raw) return null
  const geometry = asRecord(raw.geometry)
  const properties = asRecord(raw.properties) ?? {}
  if (!geometry || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) return null

  // GeoJSON fuehrt die Laenge zuerst.
  const lng = finite(geometry.coordinates[0])
  const lat = finite(geometry.coordinates[1])
  if (lat === null || lng === null) return null
  const point: LatLng = { lat, lng }
  if (!isValidLatLng(point)) return null

  return {
    label: photonLabel(properties),
    lat,
    lng,
    type: text(properties.osm_value) ?? text(properties.type),
    boundingBox: photonExtent(properties.extent),
    houseNumber: text(properties.housenumber),
    road: text(properties.street),
  }
}

/** Liest die Merkmalsliste einer Photon-Antwort heraus. */
export function photonFeatures(body: unknown): unknown[] {
  const raw = asRecord(body)
  if (!raw) return []
  return Array.isArray(raw.features) ? raw.features : []
}

export function photonSearchUrl(query: string, limit: number, lang = 'de'): string {
  const params = new URLSearchParams({ q: query, limit: String(limit), lang })
  return `${PHOTON_BASE_URL}/api?${params.toString()}`
}
