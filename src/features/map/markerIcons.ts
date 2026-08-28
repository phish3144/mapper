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

/** Kennung der Kategorie (categories.icon) -> Darstellung. */
const SYMBOLS: Record<string, string> = {
  pin: '📍',
  haus: '🏠',
  werk: '🏭',
  lager: '📦',
  kunde: '🤝',
  stern: '⭐',
  fahne: '🚩',
  werkzeug: '🔧',
}

const FALLBACK_SYMBOL = SYMBOLS.pin

/** Unbekannte oder fehlende Kennungen bekommen die Nadel. */
export function symbolFor(icon?: string | null): string {
  if (!icon) return FALLBACK_SYMBOL
  return SYMBOLS[icon] ?? FALLBACK_SYMBOL
}

/** Standorte ohne Kategorie erben den gedaempften Textton des Designsystems. */
const FALLBACK_COLOR = 'var(--text-muted)'

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * Die Farbe wird in ein style-Attribut geschrieben. Sie stammt zwar aus einer
 * festen Palette, kommt aber ueber die Datenbank - also nur echte Hex-Werte
 * durchlassen, damit niemand aus dem Attribut ausbrechen kann.
 */
function safeColor(color?: string | null): string {
  const value = (color ?? '').trim()
  return HEX_COLOR.test(value) ? value : FALLBACK_COLOR
}

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
export function createPinIcon(color: string, opts: PinOptions = {}): L.DivIcon {
  const fill = safeColor(color)
  const symbol = symbolFor(opts.symbol)
  const selected = opts.selected === true
  const inactive = opts.inactive === true

  const key = `${fill}|${symbol}|${selected ? 1 : 0}|${inactive ? 1 : 0}`
  const cached = pinCache.get(key)
  if (cached) return cached

  const classes = ['pin', selected ? 'is-selected' : '', inactive ? 'is-inactive' : '']
    .filter(Boolean)
    .join(' ')

  const icon = L.divIcon({
    html: `<div class="${classes}" style="background:${fill}"><span class="pin-inner">${symbol}</span></div>`,
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
