/** Oeffentliche Schnittstelle des Datenaustauschs (Export und Import). */
export type {
  GeoJsonFeatureCollection,
  GeoJsonLocationProperties,
  GeoJsonPointFeature,
  GeoJsonTimeWindow,
  ImportResult,
  ParsedLocation,
} from './geojson'

export {
  categoryNameIndex,
  formatTimeWindows,
  locationsToGeoJson,
  normalizeKey,
  parseBooleanish,
  parseGeoJson,
  parseNumberLoose,
  parseTimeWindows,
  splitList,
} from './geojson'

export { CSV_BOM, CSV_HEADER, parseCsv, toCsv } from './csv'

/** Nachlauf vor dem Freigeben der Objekt-URL. */
const REVOKE_DELAY_MS = 10_000

/**
 * Bietet einen Textinhalt als Datei zum Herunterladen an.
 * Die Objekt-URL wird erst mit Abstand nach dem Klick freigegeben: manche
 * Browser haben den Blob dann noch nicht vollstaendig gelesen und brechen den
 * Download bei sofortiger Freigabe ab. Ein grosser Export ist schnell mehrere
 * Megabyte gross, deshalb reicht der naechste Ereignisdurchlauf nicht aus.
 */
export function downloadText(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
