/**
 * Symbole fuer die Karte.
 *
 * Leaflet-Icons sind Objekte, keine Komponenten. Ohne Zwischenspeicher
 * entstuende bei jedem Rendern ein neues DivIcon je Marker, und Leaflet
 * tauscht daraufhin jedes Mal das DOM der Nadel aus - bei einigen hundert
 * Standorten ruckelt die Karte dann sichtbar. Deshalb wird jedes Icon genau
 * einmal je Erscheinungsbild gebaut und wiederverwendet.
 */
import L from 'leaflet'

/**
 * Die Zuordnung Kennung -> Zeichen liegt in @/lib/symbols und NICHT hier.
 * Zuvor stand sie doppelt - einmal fuer die Auswahl, einmal fuer die Karte -,
 * sodass ein nur an einer Stelle ergaenztes Symbol stillschweigend auf die
 * Nadel zurueckfiel.
 */
import { symbolEmojiOrNone } from '@/lib/symbols'
import { bandsBackground, sanitizeColors } from '@/lib/colors'

/**
 * Winkel des Verlaufs IM ELEMENT. Die Nadel ist um -45deg gedreht, ein Verlauf
 * erscheint also um 45deg gegen den Uhrzeigersinn versetzt: fuer senkrechte
 * Kanten auf dem Bildschirm braucht es 135deg, denn 135 - 45 = 90.
 *
 * Senkrecht und nicht waagerecht, weil die gedrehte Nadel spiegelsymmetrisch
 * zur senkrechten Achse ist. Ein senkrechter Schnitt gibt beiden Gruppen exakt
 * gleich viel Flaeche und beiden ein Stueck der Spitze; ein waagerechter
 * liesse der zweiten Gruppe nur den schmalen Zipfel - und behauptete damit
 * eine Rangfolge, die es nicht gibt.
 */
const PIN_ANGLE = 135

/** Die Fuge nimmt das Weiss des Nadelrands auf. */
const PIN_SEAM = '#fff'

export interface PinOptions {
  selected?: boolean
  inactive?: boolean
  /** Kennung der Kategorie ('pin', 'haus', ...), nicht das Emoji selbst. */
  symbol?: string | null
}

const pinCache = new Map<string, L.DivIcon>()

/**
 * Nadel eines Standorts. Die Drehung der Nadel steckt in der Klasse `pin`,
 * die deshalb ein eigenes Element unterhalb der Wurzel braucht: Leaflet setzt
 * die Position des Markers als `transform` auf das Wurzelelement und wuerde
 * die Drehung sonst ueberschreiben.
 */
export function createPinIcon(colors: readonly string[], opts: PinOptions = {}): L.DivIcon {
  // Erst bereinigen, dann schluesseln: der Schluessel muss das ERSCHEINUNGSBILD
  // beschreiben. Auf der Rohliste geschluesselt fielen zwei Standorte
  // auseinander, die am Ende gleich aussehen - und der Speicher entdoppelte
  // nicht mehr.
  const bands = sanitizeColors(colors)
  const fill = bandsBackground(bands, { angle: PIN_ANGLE, seam: PIN_SEAM })
  const symbol = symbolEmojiOrNone(opts.symbol)
  const selected = opts.selected === true
  const inactive = opts.inactive === true

  const key = `${bands.join('/')}|${symbol}|${selected ? 1 : 0}|${inactive ? 1 : 0}`
  const cached = pinCache.get(key)
  if (cached) return cached

  const classes = ['pin', selected ? 'is-selected' : '', inactive ? 'is-inactive' : '']
    .filter(Boolean)
    .join(' ')

  const icon = L.divIcon({
    // Ohne gewaehltes Symbol bleibt das innere Element ganz weg - eine leere
    // Huelle wuerde die Fuge zwischen zwei Gruppenfarben unnoetig unterbrechen.
    html:
      `<div class="${classes}" style="background:${fill}">` +
      (symbol === '' ? '' : `<span class="pin-inner">${symbol}</span>`) +
      `</div>`,
    // Leer statt der Vorgabe 'leaflet-div-icon': sonst liegt ein weisser
    // Kasten hinter der Nadel.
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -20],
  })
  pinCache.set(key, icon)
  return icon
}

const stopCache = new Map<string, L.DivIcon>()

/**
 * Nummerierte Nadel eines Routenstopps. `index` ist bereits die anzuzeigende,
 * 1-basierte Nummer; `violation` faerbt den verletzten Stopp rot.
 */
export function createStopIcon(index: number, violation: boolean): L.DivIcon {
  const label = Number.isFinite(index) ? String(Math.trunc(index)) : ''
  const key = `${label}|${violation ? 1 : 0}`
  const cached = stopCache.get(key)
  if (cached) return cached

  const classes = ['stop-pin', violation ? 'is-violation' : ''].filter(Boolean).join(' ')
  const icon = L.divIcon({
    html: `<div class="${classes}">${label}</div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  })
  stopCache.set(key, icon)
  return icon
}
