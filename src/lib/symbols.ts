/**
 * Symbole der Kartennadeln — die einzige Quelle dafuer.
 *
 * Zuvor stand die Liste doppelt: einmal fuer die Auswahl im Kategorieeditor,
 * einmal fuer die Darstellung auf der Karte. Ein dort ergaenztes Symbol fehlte
 * hier und fiel stillschweigend auf die Nadel zurueck.
 *
 * Gespeichert wird die KENNUNG ('haus'), nicht das Zeichen selbst: so laesst
 * sich die Darstellung spaeter austauschen — etwa gegen eigene Grafiken —,
 * ohne den Datenbestand anzufassen.
 */

export interface MapSymbol {
  id: string
  emoji: string
  label: string
  group: SymbolGroup
  /** Zusaetzliche Suchbegriffe, die nicht im Namen stehen. */
  keywords?: string
}

export type SymbolGroup =
  | 'Allgemein'
  | 'Gebaeude'
  | 'Handel & Gastronomie'
  | 'Industrie & Technik'
  | 'Verkehr'
  | 'Natur & Freizeit'
  | 'Versorgung & Notfall'

export const SYMBOL_GROUPS: readonly SymbolGroup[] = [
  'Allgemein',
  'Gebaeude',
  'Handel & Gastronomie',
  'Industrie & Technik',
  'Verkehr',
  'Natur & Freizeit',
  'Versorgung & Notfall',
]

/**
 * Die Kennungen der ersten acht Eintraege stammen aus dem urspruenglichen
 * Satz und duerfen sich nicht aendern — bestehende Kategorien verweisen darauf.
 */
export const MAP_SYMBOLS: readonly MapSymbol[] = [
  // --- Allgemein ---
  { id: 'pin', emoji: '📍', label: 'Nadel', group: 'Allgemein' },
  { id: 'stern', emoji: '⭐', label: 'Stern', group: 'Allgemein', keywords: 'favorit wichtig' },
  { id: 'fahne', emoji: '🚩', label: 'Fahne', group: 'Allgemein', keywords: 'markierung' },
  { id: 'herz', emoji: '❤️', label: 'Herz', group: 'Allgemein', keywords: 'favorit beliebt' },
  { id: 'haken', emoji: '✅', label: 'Erledigt', group: 'Allgemein', keywords: 'fertig ok haken' },
  { id: 'achtung', emoji: '⚠️', label: 'Achtung', group: 'Allgemein', keywords: 'warnung problem' },
  { id: 'frage', emoji: '❓', label: 'Offen', group: 'Allgemein', keywords: 'unklar frage' },
  { id: 'gesperrt', emoji: '⛔', label: 'Gesperrt', group: 'Allgemein', keywords: 'verboten stopp' },
  { id: 'punkt_rot', emoji: '🔴', label: 'Roter Punkt', group: 'Allgemein' },
  { id: 'punkt_blau', emoji: '🔵', label: 'Blauer Punkt', group: 'Allgemein' },
  { id: 'raute', emoji: '🔶', label: 'Raute', group: 'Allgemein' },
  { id: 'ziel', emoji: '🎯', label: 'Ziel', group: 'Allgemein', keywords: 'zielscheibe' },

  // --- Gebaeude ---
  { id: 'haus', emoji: '🏠', label: 'Haus', group: 'Gebaeude', keywords: 'wohnhaus privat' },
  { id: 'wohnblock', emoji: '🏢', label: 'Buerogebaeude', group: 'Gebaeude', keywords: 'buero firma' },
  { id: 'wohnung', emoji: '🏘️', label: 'Siedlung', group: 'Gebaeude', keywords: 'wohnungen quartier' },
  { id: 'werk', emoji: '🏭', label: 'Werk', group: 'Gebaeude', keywords: 'fabrik produktion industrie' },
  { id: 'lager', emoji: '📦', label: 'Lager', group: 'Gebaeude', keywords: 'depot paket warenlager' },
  { id: 'baustelle', emoji: '🏗️', label: 'Baustelle', group: 'Gebaeude', keywords: 'kran bau' },
  { id: 'schule', emoji: '🏫', label: 'Schule', group: 'Gebaeude', keywords: 'bildung kita' },
  { id: 'krankenhaus', emoji: '🏥', label: 'Krankenhaus', group: 'Gebaeude', keywords: 'klinik medizin' },
  { id: 'hotel', emoji: '🏨', label: 'Hotel', group: 'Gebaeude', keywords: 'uebernachtung pension' },
  { id: 'amt', emoji: '🏛️', label: 'Amt', group: 'Gebaeude', keywords: 'behoerde verwaltung rathaus' },
  { id: 'kirche', emoji: '⛪', label: 'Kirche', group: 'Gebaeude', keywords: 'gemeinde religion' },
  { id: 'bank', emoji: '🏦', label: 'Bank', group: 'Gebaeude', keywords: 'geld sparkasse' },
  { id: 'schloss_geb', emoji: '🏰', label: 'Burg', group: 'Gebaeude', keywords: 'schloss denkmal' },
  { id: 'zelt', emoji: '⛺', label: 'Zelt', group: 'Gebaeude', keywords: 'provisorium camp' },

  // --- Handel & Gastronomie ---
  { id: 'kunde', emoji: '🤝', label: 'Kunde', group: 'Handel & Gastronomie', keywords: 'termin partner' },
  { id: 'laden', emoji: '🏪', label: 'Laden', group: 'Handel & Gastronomie', keywords: 'kiosk geschaeft filiale' },
  { id: 'einkauf', emoji: '🛒', label: 'Supermarkt', group: 'Handel & Gastronomie', keywords: 'einkaufen markt' },
  { id: 'restaurant', emoji: '🍽️', label: 'Restaurant', group: 'Handel & Gastronomie', keywords: 'essen gastronomie' },
  { id: 'cafe', emoji: '☕', label: 'Cafe', group: 'Handel & Gastronomie', keywords: 'kaffee baecker' },
  { id: 'baeckerei', emoji: '🥐', label: 'Baeckerei', group: 'Handel & Gastronomie', keywords: 'brot backwaren' },
  { id: 'bar', emoji: '🍺', label: 'Bar', group: 'Handel & Gastronomie', keywords: 'kneipe getraenke' },
  { id: 'apotheke', emoji: '💊', label: 'Apotheke', group: 'Handel & Gastronomie', keywords: 'medikamente' },
  { id: 'friseur', emoji: '💈', label: 'Friseur', group: 'Handel & Gastronomie', keywords: 'salon' },
  { id: 'buero_arbeit', emoji: '💼', label: 'Geschaeftlich', group: 'Handel & Gastronomie', keywords: 'termin akquise' },

  // --- Industrie & Technik ---
  { id: 'werkzeug', emoji: '🔧', label: 'Werkzeug', group: 'Industrie & Technik', keywords: 'wartung reparatur montage' },
  { id: 'schraube', emoji: '🔩', label: 'Montage', group: 'Industrie & Technik', keywords: 'schraube technik' },
  { id: 'zahnrad', emoji: '⚙️', label: 'Anlage', group: 'Industrie & Technik', keywords: 'maschine technik' },
  { id: 'strom', emoji: '⚡', label: 'Strom', group: 'Industrie & Technik', keywords: 'elektro energie leitung' },
  { id: 'steckdose', emoji: '🔌', label: 'Anschluss', group: 'Industrie & Technik', keywords: 'strom stecker' },
  { id: 'wasserhahn', emoji: '🚰', label: 'Wasser', group: 'Industrie & Technik', keywords: 'sanitaer leitung' },
  { id: 'feuer_gas', emoji: '🔥', label: 'Heizung / Gas', group: 'Industrie & Technik', keywords: 'waerme brenner' },
  { id: 'solar', emoji: '🔆', label: 'Solar', group: 'Industrie & Technik', keywords: 'photovoltaik pv sonne' },
  { id: 'funkmast', emoji: '📡', label: 'Funkmast', group: 'Industrie & Technik', keywords: 'antenne netz mobilfunk' },
  { id: 'messung', emoji: '📊', label: 'Messstelle', group: 'Industrie & Technik', keywords: 'zaehler messung daten' },
  { id: 'werkstatt', emoji: '🛠️', label: 'Werkstatt', group: 'Industrie & Technik', keywords: 'service reparatur' },
  { id: 'schluessel', emoji: '🔑', label: 'Schluessel', group: 'Industrie & Technik', keywords: 'zugang uebergabe' },

  // --- Verkehr ---
  { id: 'auto', emoji: '🚗', label: 'Auto', group: 'Verkehr', keywords: 'pkw fahrzeug' },
  { id: 'lkw', emoji: '🚚', label: 'Lkw', group: 'Verkehr', keywords: 'lieferung transport spedition' },
  { id: 'transporter', emoji: '🚐', label: 'Transporter', group: 'Verkehr', keywords: 'bulli bus lieferwagen' },
  { id: 'fahrrad', emoji: '🚲', label: 'Fahrrad', group: 'Verkehr', keywords: 'rad velo' },
  { id: 'fuss', emoji: '🚶', label: 'Zu Fuss', group: 'Verkehr', keywords: 'fussweg gehen' },
  { id: 'bus', emoji: '🚌', label: 'Bus', group: 'Verkehr', keywords: 'haltestelle oepnv' },
  { id: 'bahn', emoji: '🚆', label: 'Bahn', group: 'Verkehr', keywords: 'zug bahnhof gleis' },
  { id: 'flugzeug', emoji: '✈️', label: 'Flughafen', group: 'Verkehr', keywords: 'flug airport' },
  { id: 'schiff', emoji: '⛴️', label: 'Hafen', group: 'Verkehr', keywords: 'schiff faehre' },
  { id: 'parkplatz', emoji: '🅿️', label: 'Parkplatz', group: 'Verkehr', keywords: 'parken stellplatz' },
  { id: 'ladesaeule', emoji: '🔋', label: 'Ladesaeule', group: 'Verkehr', keywords: 'elektro laden akku' },
  { id: 'tankstelle', emoji: '⛽', label: 'Tankstelle', group: 'Verkehr', keywords: 'sprit diesel benzin' },

  // --- Natur & Freizeit ---
  { id: 'baum', emoji: '🌳', label: 'Baum', group: 'Natur & Freizeit', keywords: 'gruen bepflanzung' },
  { id: 'wald', emoji: '🌲', label: 'Wald', group: 'Natur & Freizeit', keywords: 'forst' },
  { id: 'berg', emoji: '⛰️', label: 'Berg', group: 'Natur & Freizeit', keywords: 'gipfel huegel' },
  { id: 'see', emoji: '🏞️', label: 'Gewaesser', group: 'Natur & Freizeit', keywords: 'see fluss ufer' },
  { id: 'strand', emoji: '🏖️', label: 'Strand', group: 'Natur & Freizeit', keywords: 'kueste badestelle' },
  { id: 'park', emoji: '🌷', label: 'Park', group: 'Natur & Freizeit', keywords: 'garten gruenflaeche' },
  { id: 'sport', emoji: '⚽', label: 'Sport', group: 'Natur & Freizeit', keywords: 'platz verein halle' },
  { id: 'spielplatz', emoji: '🛝', label: 'Spielplatz', group: 'Natur & Freizeit', keywords: 'kinder' },
  { id: 'camping', emoji: '🏕️', label: 'Campingplatz', group: 'Natur & Freizeit', keywords: 'zelten wohnmobil' },
  { id: 'aussicht', emoji: '🔭', label: 'Aussichtspunkt', group: 'Natur & Freizeit', keywords: 'blick panorama' },

  // --- Versorgung & Notfall ---
  { id: 'feuerwehr', emoji: '🚒', label: 'Feuerwehr', group: 'Versorgung & Notfall', keywords: 'brand rettung' },
  { id: 'polizei', emoji: '🚓', label: 'Polizei', group: 'Versorgung & Notfall', keywords: 'wache' },
  { id: 'rettung', emoji: '🚑', label: 'Rettungsdienst', group: 'Versorgung & Notfall', keywords: 'notarzt ambulanz' },
  { id: 'arzt', emoji: '🩺', label: 'Arztpraxis', group: 'Versorgung & Notfall', keywords: 'praxis medizin' },
  { id: 'notfall', emoji: '🆘', label: 'Notfall', group: 'Versorgung & Notfall', keywords: 'stoerung dringend' },
  { id: 'muell', emoji: '🗑️', label: 'Entsorgung', group: 'Versorgung & Notfall', keywords: 'abfall muell tonne' },
  { id: 'recycling', emoji: '♻️', label: 'Recycling', group: 'Versorgung & Notfall', keywords: 'wertstoff container' },
  { id: 'post', emoji: '📮', label: 'Post', group: 'Versorgung & Notfall', keywords: 'briefkasten filiale' },
  { id: 'paket', emoji: '📬', label: 'Paketstation', group: 'Versorgung & Notfall', keywords: 'abholung packstation' },
  { id: 'feuerloescher', emoji: '🧯', label: 'Brandschutz', group: 'Versorgung & Notfall', keywords: 'loescher pruefung' },
]

export const DEFAULT_SYMBOL_ID = 'pin'

const BY_ID = new Map(MAP_SYMBOLS.map((s) => [s.id, s]))

export function findSymbol(id?: string | null): MapSymbol | undefined {
  return id ? BY_ID.get(id) : undefined
}

/** Unbekannte oder fehlende Kennungen bekommen die Nadel. */
export function symbolEmoji(id?: string | null): string {
  return findSymbol(id)?.emoji ?? '\u{1F4CD}'
}

/**
 * Wie symbolEmoji, aber ohne Ersatzzeichen: nichts gewaehlt heisst nichts.
 *
 * Der Unterschied zaehlt auf der Kartennadel. Seit die Nadel die Gruppenfarben
 * traegt, verdeckt ein Zeichen in ihrer Mitte genau die Aussage, um die es
 * geht - und das rote Ersatz-\u{1F4CD} bringt zusaetzlich eine vierte Farbe ins
 * Spiel, die keine Gruppe meint. Wer ausdruecklich das Symbol "Nadel" waehlt,
 * bekommt es weiterhin; wer nie eines gewaehlt hat, bekommt reine Farbe.
 */
export function symbolEmojiOrNone(id?: string | null): string {
  return findSymbol(id)?.emoji ?? ''
}

export function symbolLabel(id?: string | null): string {
  return findSymbol(id)?.label ?? 'Nadel'
}

/** Sucht ueber Name, Kennung und Zusatzbegriffe; leere Suche liefert alles. */
export function searchSymbols(query: string): readonly MapSymbol[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return MAP_SYMBOLS
  return MAP_SYMBOLS.filter((s) =>
    `${s.label} ${s.id} ${s.keywords ?? ''} ${s.group}`.toLowerCase().includes(needle),
  )
}
