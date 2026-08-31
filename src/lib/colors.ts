/**
 * Welche Farben gehoeren zu einem Standort?
 *
 * Bis hierher kam die Farbe aus der Kategorie. In der Praxis fuehrt das ins
 * Leere: die Anwenderin arbeitet ausschliesslich mit Gruppen ("Team FOB",
 * "Team SeSc", ...) und hat gar keine Kategorien angelegt - also waren alle
 * Nadeln gleich grau. Die Gruppen haben Farben, sie wurden nur nirgends
 * gezeigt.
 *
 * Reine Funktionen ohne React und ohne Leaflet, damit Karte, Seitenleiste,
 * Umkreisliste und Stoppliste nachweislich dieselbe Farbe verwenden. Vorher
 * stand die Ableitung an vier Stellen einzeln.
 */
import type { Category, Group, MapLocation } from '@/types/domain'

/** Standorte ohne jede Zuordnung erben den gedaempften Ton des Designsystems. */
export const NEUTRAL_COLOR = 'var(--text-muted)'

/**
 * Mehr Farben zeigt eine 22 Pixel grosse Nadel nicht mehr unterscheidbar.
 * Weitere Gruppen bleiben in der Sprechblase und im Titel sichtbar.
 *
 * Gedeckelt wird ERST in sanitizeColors, also nach dem Pruefen und Entdoppeln.
 * Frueher zu deckeln waere ein stiller Fehler: traegen zwei Gruppen dieselbe
 * Farbe, faellt eine dritte, sichtbar andere Farbe weg, obwohl am Ende nur
 * zwei Baender uebrig blieben.
 */
export const MAX_COLORS = 3

/**
 * ALLE Gruppenfarben eines Standorts, in der Reihenfolge der Gruppenliste.
 *
 * Ungedeckelt: das Deckeln gehoert zur Darstellung und steckt in
 * sanitizeColors, hinter dem Pruefen und Entdoppeln.
 *
 * Die Reihenfolge stammt bewusst aus `groups` und nicht aus den Zuordnungen:
 * die Liste kommt sortiert aus der Datenbank (sort_order, dann Name), und die
 * Zuordnungen kommen in Einfuegereihenfolge. Wuerde man ihnen folgen, haette
 * derselbe Standort je nach Ladereihenfolge mal Blau-Gruen und mal Gruen-Blau
 * - ein Flackern, das niemand erklaeren koennte. Zumal alle drei Gruppen
 * derzeit sort_order = 0 tragen, die Sortierung also allein am Namen haengt.
 */
export function groupColorsOf(
  location: Pick<MapLocation, 'id'>,
  groups: readonly Group[],
  membership: ReadonlyMap<string, readonly string[]>,
): string[] {
  const mine = membership.get(location.id)
  if (!mine || mine.length === 0) return []
  const wanted = new Set(mine)
  const colors: string[] = []
  for (const group of groups) {
    if (!wanted.has(group.id)) continue
    colors.push(group.color)
  }
  return colors
}

/**
 * Die Farben, mit denen ein Standort ueberall dargestellt wird.
 *
 * Gruppen schlagen die Kategorie. Das ist eine bewusste Entscheidung und keine
 * Ableitung aus den Daten: wer Gruppen pflegt, ordnet damit seine Arbeit -
 * die Kategorie beschreibt eher, was ein Ort IST. Hat ein Standort keine
 * Gruppe, bleibt die Kategoriefarbe wie bisher; hat er beides nicht, wird er
 * neutral.
 *
 * Immer mindestens ein Eintrag, damit die Aufrufer keinen Sonderfall brauchen.
 */
export function locationColors(
  location: Pick<MapLocation, 'id' | 'category_id'>,
  groups: readonly Group[],
  membership: ReadonlyMap<string, readonly string[]>,
  category?: Pick<Category, 'color'> | null,
): string[] {
  const fromGroups = groupColorsOf(location, groups, membership)
  if (fromGroups.length > 0) return fromGroups
  if (category?.color) return [category.color]
  return [NEUTRAL_COLOR]
}

// ---------------------------------------------------------------------------
// Farbwerte absichern
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * Ein echter Hex-Wert oder null.
 *
 * Die Farben stammen zwar aus einer festen Auswahl, kommen aber ueber die
 * Datenbank und landen in einem style-Attribut, das an der Karte als
 * Zeichenkette zusammengebaut wird. Nur echte Hex-Werte durchlassen, damit
 * niemand aus dem Attribut ausbrechen kann.
 *
 * Bewusst null und kein Ersatzgrau: eine ungueltige ZWEITE Farbe muss
 * wegfallen, nicht grau werden. Ein grauer Streifen wuerde eine Gruppe
 * behaupten, die es nicht gibt - und das waere schlimmer als eine Farbe
 * weniger.
 */
export function hexColor(value: string | null | undefined): string | null {
  const candidate = (value ?? '').trim()
  return HEX_COLOR.test(candidate) ? candidate : null
}

/**
 * Die Farbliste, wie sie gezeichnet wird: geprueft, ohne Dopplungen, gedeckelt.
 *
 * Die Entdopplung ist nicht kosmetisch. Zwei Gruppen duerfen dieselbe Farbe
 * tragen; ohne sie entstuende eine unsichtbare Fuge mitten in einer scheinbar
 * einfarbigen Nadel - und im Zwischenspeicher ein zweiter Eintrag fuer dasselbe
 * Bild.
 */
export function sanitizeColors(colors: readonly string[]): string[] {
  const out: string[] = []
  for (const color of colors) {
    const hex = hexColor(color)
    if (hex === null) continue
    const normalized = hex.toLowerCase()
    if (out.includes(normalized)) continue
    out.push(normalized)
    if (out.length === MAX_COLORS) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Farbbaender
// ---------------------------------------------------------------------------

/** Breite der Fuge zwischen zwei Baendern, in Pixeln. */
export const SEAM_PX = 1

export interface BandOptions {
  /**
   * Winkel des Verlaufs IM ELEMENT, nicht auf dem Bildschirm.
   *
   * Das ist der Fallstrick: die Kartennadel ist um -45deg gedreht, ein Verlauf
   * erscheint also um 45deg gegen den Uhrzeigersinn versetzt. Fuer senkrechte
   * Kanten auf dem Bildschirm braucht die Nadel deshalb 135deg (135 - 45 = 90),
   * der ungedrehte Listenpunkt dagegen 90deg.
   */
  angle: number
  /** Farbe der Fuge. Auf der Nadel Weiss wie ihr Rand, in der Liste der Panelton. */
  seam: string
}

/**
 * Ein Hintergrundwert, der die Flaeche in gleich breite Farbbaender teilt.
 *
 * Die Trennstellen stehen in PROZENT und nicht in Pixeln. Das ist der Kern:
 * Prozentwerte beziehen sich auf die Verlaufsachse, und deren Laenge ist bei
 * einer gedrehten Flaeche nicht die Kantenlaenge - die 18px-Innenflaeche der
 * Nadel misst entlang der bildschirm-waagerechten Achse 18*sqrt(2) = 25,46px.
 * Wer hier in Pixeln rechnet, bekommt bei zwei Baendern zufaellig das Richtige
 * (die Mitte bleibt die Mitte) und bei drei Baendern ein zu schmales
 * Mittelband. Prozentwerte sind gegen diese Falle immun.
 *
 * Die Fuge dagegen steht in Pixeln, denn sie soll eine Haarlinie bleiben und
 * nicht mit der Bandzahl wachsen.
 */
export function bandsBackground(colors: readonly string[], opts: BandOptions): string {
  const bands = sanitizeColors(colors)
  if (bands.length === 0) return NEUTRAL_COLOR
  if (bands.length === 1) return bands[0]

  const half = (SEAM_PX / 2).toFixed(2)
  const parts: string[] = []
  bands.forEach((color, i) => {
    const from = i === 0 ? '0' : `calc(${((i / bands.length) * 100).toFixed(3)}% + ${half}px)`
    const to =
      i === bands.length - 1
        ? '100%'
        : `calc(${(((i + 1) / bands.length) * 100).toFixed(3)}% - ${half}px)`
    parts.push(`${color} ${from} ${to}`)
    if (i < bands.length - 1) {
      const cut = (((i + 1) / bands.length) * 100).toFixed(3)
      parts.push(`${opts.seam} calc(${cut}% - ${half}px) calc(${cut}% + ${half}px)`)
    }
  })
  return `linear-gradient(${opts.angle}deg, ${parts.join(', ')})`
}
