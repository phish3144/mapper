/**
 * Bedienelemente ueber der Karte: Kachelebene und Gesamtansicht.
 *
 * Die Leiste wird bewusst NEBEN dem Kartencontainer gezeichnet und nicht
 * darin: die Leaflet-Ebenen reichen bis z-index 700 und wuerden das Overlay
 * (400) sonst verdecken.
 */
import { Button } from '@/components/ui'
import { useUi } from '@/lib/uiStore'
import { useVisibleLocations } from './MarkerLayer'

export type BaseLayerId = 'map' | 'terrain' | 'satellite'

/** Ein einzelner Kachelanbieter. */
export interface TileSource {
  url: string
  attribution: string
  maxZoom: number
  subdomains?: string
  /** Name des Betreibers, fuer die Meldung beim Ausweichen. */
  provider: string
}

export interface BaseLayer {
  id: BaseLayerId
  label: string
  /**
   * Mehrere Anbieter derselben Darstellung, in absteigender Vorliebe.
   * Liefert der erste keine Kacheln, wird selbsttaetig auf den naechsten
   * gewechselt - die Karte soll auf jedem Netz und jedem Geraet etwas zeigen.
   */
  sources: TileSource[]
}

const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>-Mitwirkende'

const ESRI_ATTR = 'Kacheln &copy; Esri | Daten: Esri, HERE, Garmin, USGS, NGA'

/**
 * Die Namensnennung ist Lizenzbedingung der Kachelanbieter und darf nicht
 * entfernt werden.
 *
 * Zwei Anbieter sind bewusst NICHT dabei:
 * - tile.openstreetmap.org: ehrenamtlich betrieben, laut Nutzungsrichtlinie
 *   nicht fuer fremde Anwendungen gedacht; antwortet mit "403 Access blocked".
 * - basemaps.cartocdn.com: verlangt seit kurzem einen Schluessel und legt
 *   sonst "API KEY REQUIRED" quer ueber jede Kachel.
 *
 * Der deutsche Kartenstil von openstreetmap.de beschriftet in Landessprache
 * und braucht keinen Schluessel. Seine Nutzungsbedingungen erlauben das
 * Einbinden ausdruecklich fuer nichtkommerzielle Zwecke und kleinere
 * Webanwendungen; bei kommerzieller oder stark frequentierter Nutzung gehoert
 * ein eigener Kachelserver oder ein bezahlter Anbieter hierher.
 */
export const BASE_LAYERS: Record<BaseLayerId, BaseLayer> = {
  map: {
    id: 'map',
    label: 'Karte',
    sources: [
      {
        provider: 'OpenStreetMap Deutschland',
        url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
        attribution: `${OSM_ATTR} | Kacheln: <a href="https://openstreetmap.de/germanstyle/" target="_blank" rel="noreferrer">OpenStreetMap Deutschland</a>`,
        maxZoom: 19,
      },
      {
        provider: 'Esri',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        attribution: ESRI_ATTR,
        maxZoom: 19,
      },
    ],
  },
  terrain: {
    id: 'terrain',
    label: 'Gelaende',
    sources: [
      {
        provider: 'OpenTopoMap',
        url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: `${OSM_ATTR}, SRTM | Darstellung: <a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a> (CC-BY-SA)`,
        maxZoom: 17,
      },
      {
        provider: 'Esri',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        attribution: ESRI_ATTR,
        maxZoom: 19,
      },
    ],
  },
  satellite: {
    id: 'satellite',
    label: 'Satellit',
    sources: [
      {
        provider: 'Esri',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Kacheln &copy; Esri | Quellen: Esri, Maxar, Earthstar Geographics, GIS-Gemeinschaft',
        maxZoom: 19,
      },
    ],
  },
}

const BASE_LAYER_ORDER: readonly BaseLayerId[] = ['map', 'terrain', 'satellite']

const BASE_LAYER_KEY = 'mapper.baseLayer'

export function readStoredBaseLayer(): BaseLayerId {
  // Defensiv: in aelteren Staenden konnten hier Kennungen stehen, die es
  // heute nicht mehr gibt.
  const stored = localStorage.getItem(BASE_LAYER_KEY)
  return stored !== null && stored in BASE_LAYERS ? (stored as BaseLayerId) : 'map'
}

export interface MapControlsProps {
  baseLayer: BaseLayerId
  onBaseLayerChange: (id: BaseLayerId) => void
}

export default function MapControls({ baseLayer, onBaseLayerChange }: MapControlsProps) {
  const focusBounds = useUi((s) => s.focusBounds)

  const visible = useVisibleLocations()

  function chooseLayer(id: BaseLayerId) {
    localStorage.setItem(BASE_LAYER_KEY, id)
    onBaseLayerChange(id)
  }

  return (
    <div className="map-overlay top-right">
      <div className="panel row" style={{ padding: 3, gap: 3 }} role="group" aria-label="Kartenebene">
        {BASE_LAYER_ORDER.map((id) => {
          const layer = BASE_LAYERS[id]
          const on = baseLayer === id
          return (
            <Button
              key={id}
              size="sm"
              variant={on ? 'primary' : 'ghost'}
              aria-pressed={on}
              aria-label={`Kartenebene ${layer.label}`}
              onClick={() => chooseLayer(id)}
            >
              {layer.label}
            </Button>
          )
        })}
      </div>

      <div className="panel" style={{ padding: 3 }}>
        {/* Kein aria-label: der sichtbare Text ist der zugaengliche Name, sonst
            koennen Sprachsteuerungen die Schaltflaeche nicht ansprechen. Die
            Erlaeuterung gehoert in den Titel. */}
        <Button
          size="sm"
          disabled={visible.length === 0}
          title="Alle sichtbaren Standorte in den Kartenausschnitt holen"
          onClick={() => focusBounds(visible.map((l) => ({ lat: l.lat, lng: l.lng })))}
        >
          Alle anzeigen
        </Button>
      </div>

    </div>
  )
}
