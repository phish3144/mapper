/**
 * Bedienelemente ueber der Karte: Kachelebene, Gesamtansicht, Umkreiswerkzeug.
 *
 * Die Leiste selbst wird bewusst NEBEN dem Kartencontainer gezeichnet und
 * nicht darin: die Leaflet-Ebenen reichen bis z-index 700 und wuerden das
 * Overlay (400) sonst verdecken. Nur der gezeichnete Umkreis gehoert in die
 * Karte - daher die zusaetzliche Komponente `RadiusCircle`.
 */
import { useEffect, useState } from 'react'
import { Circle } from 'react-leaflet'
import { Button, TextField } from '@/components/ui'
import { useUi } from '@/lib/uiStore'
import { useVisibleLocations } from './MarkerLayer'

export type BaseLayerId = 'map' | 'terrain'

export interface BaseLayer {
  id: BaseLayerId
  label: string
  url: string
  attribution: string
  maxZoom: number
}

/**
 * Die Namensnennung ist Lizenzbedingung der Kachelanbieter und darf nicht
 * entfernt werden.
 */
export const BASE_LAYERS: Record<BaseLayerId, BaseLayer> = {
  map: {
    id: 'map',
    label: 'Karte',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap-Mitwirkende</a>',
    maxZoom: 19,
  },
  terrain: {
    id: 'terrain',
    label: 'Gelaende',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap-Mitwirkende</a>, SRTM | Darstellung: <a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
  },
}

const BASE_LAYER_ORDER: readonly BaseLayerId[] = ['map', 'terrain']

const BASE_LAYER_KEY = 'mapper.baseLayer'

/** Vorgabe des Umkreises, wenn noch keiner gewaehlt wurde. */
export const DEFAULT_RADIUS_KM = 10

export function readStoredBaseLayer(): BaseLayerId {
  const stored = localStorage.getItem(BASE_LAYER_KEY)
  return stored === 'terrain' || stored === 'map' ? stored : 'map'
}

export interface MapControlsProps {
  baseLayer: BaseLayerId
  onBaseLayerChange: (id: BaseLayerId) => void
  radiusPicking: boolean
  onRadiusPickingChange: (on: boolean) => void
  /** Ein anderes Werkzeug beansprucht den Kartenklick bereits. */
  radiusBlocked?: boolean
}

export default function MapControls({
  baseLayer,
  onBaseLayerChange,
  radiusPicking,
  onRadiusPickingChange,
  radiusBlocked = false,
}: MapControlsProps) {
  const filter = useUi((s) => s.filter)
  const patchFilter = useUi((s) => s.patchFilter)
  const focusBounds = useUi((s) => s.focusBounds)

  const visible = useVisibleLocations()

  const radiusOpen = radiusPicking || filter.center !== null

  function chooseLayer(id: BaseLayerId) {
    localStorage.setItem(BASE_LAYER_KEY, id)
    onBaseLayerChange(id)
  }

  function toggleRadius() {
    if (radiusPicking) {
      onRadiusPickingChange(false)
      return
    }
    if (radiusBlocked) return
    if (filter.radiusKm === null) patchFilter({ radiusKm: DEFAULT_RADIUS_KM })
    onRadiusPickingChange(true)
  }

  function clearRadius() {
    onRadiusPickingChange(false)
    patchFilter({ center: null, radiusKm: null })
  }

  function changeRadius(value: string) {
    const raw = value.trim()
    if (raw === '') {
      patchFilter({ radiusKm: null })
      return
    }
    const km = Number(raw)
    patchFilter({ radiusKm: Number.isFinite(km) && km > 0 ? km : null })
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

      <div className="panel col" style={{ padding: 6, gap: 6, width: 186 }}>
        <Button
          size="sm"
          variant={radiusPicking ? 'primary' : 'default'}
          aria-pressed={radiusPicking}
          disabled={radiusBlocked}
          title={
            radiusBlocked
              ? 'Erst den Standort auf der Karte setzen'
              : 'Nur Standorte im Umkreis eines Kartenpunkts zeigen'
          }
          onClick={toggleRadius}
        >
          {radiusPicking ? 'Mittelpunkt anklicken' : 'Umkreis'}
        </Button>

        {radiusOpen && (
          <>
            {/* Field bringt 12 px Aussenabstand mit; in der schmalen Leiste
                soll allein der Spaltenabstand zaehlen. */}
            <div style={{ marginBottom: -12 }}>
              <TextField
                label="Radius in km"
                type="number"
                min={1}
                max={500}
                step={1}
                value={filter.radiusKm ?? ''}
                onChange={(e) => changeRadius(e.target.value)}
              />
            </div>
            {filter.center && (
              <Button size="sm" variant="ghost" onClick={clearRadius}>
                Umkreis aufheben
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Der gewaehlte Umkreis als Kreis auf der Karte. Gehoert in den
 * Kartencontainer und wird deshalb von MapView dort eingehaengt.
 */
export function RadiusCircle() {
  const center = useUi((s) => s.filter.center)
  const radiusKm = useUi((s) => s.filter.radiusKm)
  const color = useAccentColor()

  if (!center || radiusKm === null || radiusKm <= 0) return null

  return (
    <Circle
      center={[center.lat, center.lng]}
      radius={radiusKm * 1000}
      pathOptions={{ color, weight: 1.5, opacity: 0.9, fillOpacity: 0.07, interactive: false }}
    />
  )
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function readAccentColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  // Einziger fester Farbwert der Kartenebene: er greift nur, falls das
  // Stilblatt noch nicht steht, und entspricht dem hellen Token.
  return value || '#2563eb'
}

/**
 * Leaflet schreibt Linienfarben in SVG-Attribute; dort loest var(--accent)
 * nicht auf, der Wert muss also ausgelesen werden. Ausgeloest wird das neue
 * Auslesen sowohl von der Wahl in der Oberflaeche als auch vom Systemschema -
 * bei der Einstellung 'system' gibt es sonst kein Ereignis im Speicher.
 */
function useAccentColor(): string {
  const theme = useUi((s) => s.theme)
  const [color, setColor] = useState(readAccentColor)

  useEffect(() => {
    setColor(readAccentColor())
    const query = window.matchMedia(DARK_QUERY)
    const onChange = () => setColor(readAccentColor())
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [theme])

  return color
}
