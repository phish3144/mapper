/**
 * KML und KMZ lesen — das Ausgabeformat von Google My Maps.
 *
 * Warum ein eigener XML-Parser statt DOMParser: der steht nur im Browser zur
 * Verfuegung. Die Tests laufen in Node, und ein von der Umgebung abhaengiger
 * Parser waere genau dort nicht pruefbar, wo die Tuecken liegen. Der Parser
 * hier ist bewusst klein und auf KML zugeschnitten - er versteht Elemente,
 * Attribute, CDATA und Entitaeten, mehr braucht es dafuer nicht.
 *
 * Abbildung von My Maps auf unser Modell:
 *   Ebene (Folder)      -> Gruppe
 *   Platzmarke          -> Standort
 *   description         -> Notizen (HTML wird entfernt)
 *   ExtendedData        -> Adresse, Kategorie oder zusaetzliche Notizzeilen
 */
import { isValidLatLng } from '@/lib/geo'
import type { ImportResult, ParsedLocation } from './geojson'

// ---------------------------------------------------------------------------
// Kleiner XML-Parser
// ---------------------------------------------------------------------------

export interface XmlNode {
  /** Lokaler Name in Kleinschreibung, ohne Namensraum-Praefix. */
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Zusammengefasster Textinhalt der direkten Textknoten. */
  text: string
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named ?? match
  })
}

/** Namensraum-Praefix abschneiden: <kml:Placemark> und <Placemark> sind dasselbe. */
function localName(raw: string): string {
  const colon = raw.indexOf(':')
  return (colon >= 0 ? raw.slice(colon + 1) : raw).toLowerCase()
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    attrs[localName(match[1])] = decodeEntities(match[3] ?? match[4] ?? '')
  }
  return attrs
}

/**
 * Liest ein XML-Dokument in einen Baum. Gibt null zurueck, wenn kein
 * Wurzelelement gefunden wird; unbalancierte Endetags werden uebergangen,
 * statt den ganzen Import scheitern zu lassen.
 */
export function parseXml(source: string): XmlNode | null {
  const cleaned = source.replace(/^\uFEFF/, '')
  const stack: XmlNode[] = []
  let root: XmlNode | null = null
  let index = 0

  const pushText = (value: string): void => {
    if (stack.length === 0) return
    const decoded = decodeEntities(value)
    if (decoded.trim() !== '' || decoded.includes('\n')) {
      stack[stack.length - 1].text += decoded
    }
  }

  while (index < cleaned.length) {
    const lt = cleaned.indexOf('<', index)
    if (lt < 0) {
      pushText(cleaned.slice(index))
      break
    }
    if (lt > index) pushText(cleaned.slice(index, lt))

    if (cleaned.startsWith('<!--', lt)) {
      const end = cleaned.indexOf('-->', lt + 4)
      index = end < 0 ? cleaned.length : end + 3
      continue
    }
    if (cleaned.startsWith('<![CDATA[', lt)) {
      const end = cleaned.indexOf(']]>', lt + 9)
      const body = end < 0 ? cleaned.slice(lt + 9) : cleaned.slice(lt + 9, end)
      // CDATA ist woertlich - hier darf NICHT dekodiert werden.
      if (stack.length > 0) stack[stack.length - 1].text += body
      index = end < 0 ? cleaned.length : end + 3
      continue
    }
    if (cleaned.startsWith('<?', lt) || cleaned.startsWith('<!', lt)) {
      const end = cleaned.indexOf('>', lt + 2)
      index = end < 0 ? cleaned.length : end + 1
      continue
    }

    const gt = cleaned.indexOf('>', lt)
    if (gt < 0) {
      pushText(cleaned.slice(lt))
      break
    }
    const inner = cleaned.slice(lt + 1, gt).trim()
    index = gt + 1

    if (inner.startsWith('/')) {
      const name = localName(inner.slice(1).trim())
      // Nur schliessen, wenn das Tag wirklich offen ist - sonst reisst ein
      // einzelnes verirrtes Endetag den restlichen Baum ab.
      for (let depth = stack.length - 1; depth >= 0; depth--) {
        if (stack[depth].name === name) {
          stack.length = depth
          break
        }
      }
      continue
    }

    const selfClosing = inner.endsWith('/')
    const body = selfClosing ? inner.slice(0, -1).trim() : inner
    const space = body.search(/\s/)
    const name = localName(space < 0 ? body : body.slice(0, space))
    if (name === '') continue
    const node: XmlNode = {
      name,
      attrs: space < 0 ? {} : parseAttributes(body.slice(space)),
      children: [],
      text: '',
    }
    if (stack.length === 0) {
      if (root === null) root = node
    } else {
      stack[stack.length - 1].children.push(node)
    }
    if (!selfClosing) stack.push(node)
  }

  return root
}

export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name)
}

export function firstNamed(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((child) => child.name === name)
}

/** Textinhalt eines Kindelements, getrimmt; leerer String, wenn es fehlt. */
export function childText(node: XmlNode, name: string): string {
  return firstNamed(node, name)?.text.trim() ?? ''
}

// ---------------------------------------------------------------------------
// KML
// ---------------------------------------------------------------------------

export interface KmlResult extends ImportResult {
  /** Namen der Ebenen (Folder) in Reihenfolge ihres Auftretens. */
  layerNames: string[]
  /** Platzmarken ohne Punkt (Linien, Flaechen) - die kann das Modell nicht abbilden. */
  skippedShapes: number
  /** Name der Karte, aus <Document><name>. */
  mapName: string | null
}

const ADDRESS_KEYS = new Set(['adresse', 'address', 'anschrift', 'strasse', 'straße', 'street'])
const CATEGORY_KEYS = new Set(['kategorie', 'category', 'typ', 'type', 'art'])
const NOTE_KEYS = new Set(['notiz', 'notizen', 'note', 'notes', 'bemerkung', 'beschreibung'])

/** Entfernt HTML aus einer My-Maps-Beschreibung und macht daraus lesbaren Text. */
export function stripHtml(value: string): string {
  return decodeEntities(
    value
      .replace(/<\s*(br|tr|p|div|li)\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(tr|p|div|li|table)\s*>/gi, '\n')
      .replace(/<\s*td[^>]*>/gi, '\t')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^\t+/, '').replace(/\t+$/, '').replace(/\t+/g, ': ').replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
    .trim()
}

/**
 * "13.405,52.52,0" -> { lat, lng }. KML fuehrt die Laenge ZUERST, anders als
 * die uebliche Schreibweise - eine Verwechslung liegt hier besonders nahe.
 */
export function parseCoordinates(raw: string): { lat: number; lng: number } | null {
  const first = raw.trim().split(/\s+/)[0]
  if (!first) return null
  const parts = first.split(',')
  if (parts.length < 2) return null
  const lng = Number.parseFloat(parts[0])
  const lat = Number.parseFloat(parts[1])
  const point = { lat, lng }
  return isValidLatLng(point) ? point : null
}

/** Sucht rekursiv den ersten Punkt - auch innerhalb einer MultiGeometry. */
function findPoint(node: XmlNode): { lat: number; lng: number } | null {
  if (node.name === 'point') {
    const coords = childText(node, 'coordinates')
    return coords === '' ? null : parseCoordinates(coords)
  }
  for (const child of node.children) {
    const found = findPoint(child)
    if (found) return found
  }
  return null
}

function hasShape(node: XmlNode): boolean {
  if (node.name === 'linestring' || node.name === 'polygon' || node.name === 'linearring') return true
  return node.children.some(hasShape)
}

interface ExtendedFields {
  address?: string
  categoryName?: string
  noteLines: string[]
}

function readExtendedData(placemark: XmlNode): ExtendedFields {
  const out: ExtendedFields = { noteLines: [] }
  const extended = firstNamed(placemark, 'extendeddata')
  if (!extended) return out

  const entries: XmlNode[] = [
    ...childrenNamed(extended, 'data'),
    // Google haengt eigene Spalten teils unter SchemaData/SimpleData an.
    ...childrenNamed(extended, 'schemadata').flatMap((schema) => childrenNamed(schema, 'simpledata')),
  ]

  for (const entry of entries) {
    const key = (entry.attrs.name ?? '').trim()
    const value = (entry.name === 'data' ? childText(entry, 'value') : entry.text.trim())
    if (value === '') continue
    const lower = key.toLowerCase()
    if (out.address === undefined && ADDRESS_KEYS.has(lower)) out.address = value
    else if (out.categoryName === undefined && CATEGORY_KEYS.has(lower)) out.categoryName = value
    else if (NOTE_KEYS.has(lower)) out.noteLines.push(value)
    else out.noteLines.push(key === '' ? value : `${key}: ${value}`)
  }
  return out
}

function collectPlacemarks(
  node: XmlNode,
  layer: string | null,
  visit: (placemark: XmlNode, layer: string | null) => void,
  layerNames: string[],
): void {
  for (const child of node.children) {
    if (child.name === 'placemark') {
      visit(child, layer)
      continue
    }
    if (child.name === 'folder') {
      const name = childText(child, 'name')
      const nextLayer = name === '' ? layer : name
      if (name !== '' && !layerNames.includes(name)) layerNames.push(name)
      collectPlacemarks(child, nextLayer, visit, layerNames)
      continue
    }
    collectPlacemarks(child, layer, visit, layerNames)
  }
}

/**
 * Liest ein KML-Dokument. Fehlerhafte Platzmarken werden gesammelt gemeldet,
 * statt den ganzen Import scheitern zu lassen - bei einer aus My Maps
 * exportierten Karte ist meist nur ein Teil unbrauchbar.
 */
export function parseKml(text: string): KmlResult {
  const rows: ParsedLocation[] = []
  const errors: string[] = []
  const layerNames: string[] = []
  let skippedShapes = 0

  const content = text.replace(/^\uFEFF/, '').trim()
  if (content === '') {
    return { rows, errors: ['Die Datei ist leer.'], layerNames, skippedShapes, mapName: null }
  }

  const root = parseXml(content)
  if (root === null) {
    return {
      rows,
      errors: ['Die Datei enthaelt kein lesbares XML.'],
      layerNames,
      skippedShapes,
      mapName: null,
    }
  }
  if (root.name !== 'kml' && root.name !== 'document' && root.name !== 'folder') {
    return {
      rows,
      errors: [`Unerwartetes Wurzelelement <${root.name}> — erwartet wird <kml>.`],
      layerNames,
      skippedShapes,
      mapName: null,
    }
  }

  const document = firstNamed(root, 'document')
  const mapName = document ? childText(document, 'name') || null : childText(root, 'name') || null

  let index = 0
  collectPlacemarks(
    root,
    null,
    (placemark, layer) => {
      index += 1
      const name = childText(placemark, 'name')
      const point = findPoint(placemark)
      if (point === null) {
        if (hasShape(placemark)) {
          skippedShapes += 1
          errors.push(
            `Platzmarke ${index}${name ? ` ("${name}")` : ''}: Linien und Flaechen koennen nicht ` +
              'uebernommen werden, nur Punkte.',
          )
        } else {
          errors.push(`Platzmarke ${index}${name ? ` ("${name}")` : ''}: keine gueltigen Koordinaten.`)
        }
        return
      }

      const extended = readExtendedData(placemark)
      const description = stripHtml(childText(placemark, 'description'))
      const noteParts = [description, ...extended.noteLines].filter((part) => part !== '')
      // Google setzt in <address> die Anschrift, wenn die Platzmarke aus einer
      // Adresssuche entstanden ist.
      const address = extended.address ?? childText(placemark, 'address')

      const row: ParsedLocation = {
        name: name === '' ? `Platzmarke ${index}` : name,
        lat: point.lat,
        lng: point.lng,
        tags: [],
        serviceMinutes: 0,
        timeWindows: [],
        groupNames: layer === null ? [] : [layer],
        isActive: true,
      }
      if (address !== '') row.address = address
      if (noteParts.length > 0) row.notes = noteParts.join('\n')
      if (extended.categoryName !== undefined) row.categoryName = extended.categoryName
      rows.push(row)
    },
    layerNames,
  )

  if (rows.length === 0 && errors.length === 0) {
    errors.push('Die Datei enthaelt keine Platzmarken.')
  }
  return { rows, errors, layerNames, skippedShapes, mapName }
}

export function looksLikeKml(text: string): boolean {
  const head = text.replace(/^\uFEFF/, '').trimStart().slice(0, 400).toLowerCase()
  return head.includes('<kml') || head.includes('<?xml') && head.includes('placemark')
}

// ---------------------------------------------------------------------------
// KMZ (ZIP)
// ---------------------------------------------------------------------------
//
// Eine KMZ-Datei ist ein ZIP mit einer doc.kml darin. Statt einer Bibliothek
// genuegen hier die zwei Strukturen, die das ZIP-Format dafuer vorsieht, und
// DecompressionStream fuer den Deflate-Anteil — das gibt es sowohl im Browser
// als auch in Node, die Tests laufen also mit demselben Code.

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** Das Kommentarfeld am Dateiende ist hoechstens 65535 Bytes lang. */
const MAX_EOCD_SEARCH = 0xffff + 22

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  localOffset: number
}

function readCentralDirectory(view: DataView): ZipEntry[] {
  const limit = Math.min(view.byteLength, MAX_EOCD_SEARCH)
  let eocd = -1
  for (let back = 22; back <= limit; back++) {
    const at = view.byteLength - back
    if (at < 0) break
    if (view.getUint32(at, true) === EOCD_SIGNATURE) {
      eocd = at
      break
    }
  }
  if (eocd < 0) throw new Error('Kein ZIP-Ende gefunden — die Datei ist vermutlich beschaedigt.')

  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  const decoder = new TextDecoder()

  for (let i = 0; i < count; i++) {
    if (offset + 46 > view.byteLength) break
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + offset + 46, nameLength))
    entries.push({ name, method, compressedSize, localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function inflate(data: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return data
  if (method !== 8) throw new Error(`Nicht unterstuetzte ZIP-Kompression (Methode ${method}).`)
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Diese Umgebung kann KMZ nicht entpacken. Bitte die enthaltene KML-Datei einzeln waehlen.')
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Packt eine KMZ-Datei aus und liest die enthaltene KML. Enthaelt das Archiv
 * mehrere, gewinnt doc.kml — so legt Google My Maps sie ab.
 */
export async function parseKmz(buffer: ArrayBuffer): Promise<KmlResult> {
  try {
    return parseKml(await readKmzText(buffer))
  } catch (error) {
    return {
      rows: [],
      errors: [error instanceof Error ? error.message : 'Die KMZ-Datei konnte nicht gelesen werden.'],
      layerNames: [],
      skippedShapes: 0,
      mapName: null,
    }
  }
}

/**
 * Holt den KML-Text aus einem KMZ-Archiv. Getrennt von parseKmz, damit der
 * Import-Dialog beide Formate ueber denselben Weg fuehren kann: entpacken,
 * dann wie eine gewoehnliche KML behandeln.
 */
export async function readKmzText(buffer: ArrayBuffer): Promise<string> {
  const view = new DataView(buffer)
  const entries = readCentralDirectory(view)

  const kmlEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith('.kml'))
  if (kmlEntries.length === 0) throw new Error('Das Archiv enthaelt keine KML-Datei.')
  const chosen = kmlEntries.find((entry) => entry.name.toLowerCase().endsWith('doc.kml')) ?? kmlEntries[0]

  const local = chosen.localOffset
  if (local + 30 > view.byteLength || view.getUint32(local, true) !== LOCAL_SIGNATURE) {
    throw new Error('Die KMZ-Datei ist beschaedigt (unerwarteter Kopfsatz).')
  }
  const nameLength = view.getUint16(local + 26, true)
  const extraLength = view.getUint16(local + 28, true)
  const start = local + 30 + nameLength + extraLength
  const end = chosen.compressedSize > 0 ? start + chosen.compressedSize : view.byteLength
  const raw = new Uint8Array(buffer, start, Math.min(end, view.byteLength) - start)
  return new TextDecoder().decode(await inflate(raw, chosen.method))
}
