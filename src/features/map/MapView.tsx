/**
 * Die Karte.
 *
 * MapView haelt nur zusammen, was auf der Karte liegt, und uebersetzt die
 * Auftraege aus dem Oberflaechenzustand (Ausschnitt anspringen, Punkt waehlen)
 * in Leaflet-Aufrufe. Die eigentlichen Ebenen stehen in eigenen Dateien.
 */
import { useEffect, useRef, useState } from 'react'
import type { LatLngTuple } from 'leaflet'
import { MapContainer, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import { Button, Spinner } from '@/components/ui'
import { useStore } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import RouteLayer from '@/features/routes/RouteLayer'
import SearchMarker from '@/features/search/SearchMarker'
import MapControls, {
  BASE_LAYERS,
  readStoredBaseLayer,
  type BaseLayer,
  type BaseLayerId,
} from './MapControls'
import MarkerLayer, { useVisibleLocations } from './MarkerLayer'

/** Startausschnitt: ganz Deutschland. */
const GERMANY_CENTER: LatLngTuple = [51.16, 10.45]
const GERMANY_ZOOM = 6

/** Zoomstufe, wenn ein einzelner Standort angesprungen wird. */
const FOCUS_ZOOM = 15
const BOUNDS_PADDING: [number, number] = [48, 48]

export default function MapView() {
  const [baseLayer, setBaseLayer] = useState<BaseLayerId>(readStoredBaseLayer)
  const pickingPoint = useUi((s) => s.pickingPoint)
  const setPickingPoint = useUi((s) => s.setPickingPoint)
  const loading = useStore((s) => s.loadingWorkspace)
  const total = useStore((s) => s.locations.length)
  const visibleCount = useVisibleLocations().length

  const layer = BASE_LAYERS[baseLayer]

  const hint = loading
    ? 'Standorte werden geladen'
    : total === 0
      ? 'Noch keine Standorte'
      : visibleCount === 0
        ? 'Kein Standort passt zum Filter'
        : null

  return (
    <>
      <MapContainer
        className="map-root"
        center={GERMANY_CENTER}
        zoom={GERMANY_ZOOM}
        scrollWheelZoom
        zoomControl={false}
        style={{
          // Eigener Stapelkontext: die Leaflet-Ebenen reichen bis z-index 700
          // und wuerden die Overlays (400) sonst verdecken.
          isolation: 'isolate',
          cursor: pickingPoint ? 'crosshair' : undefined,
        }}
      >
        <BaseTiles layer={layer} />
        {/* Unten links, damit oben Platz fuer Hinweis und Bedienleiste bleibt. */}
        <ZoomControl position="bottomleft" />

        <MarkerLayer />
        <RouteLayer />
        <SearchMarker />

        <MapClicks />
        <FocusHandler />
        <SizeWatcher />
      </MapContainer>

      {(pickingPoint || hint !== null) && (
        <div className="map-overlay top-left">
          {pickingPoint && (
            <div className="map-hint row" style={{ gap: 10 }}>
              <span>Klicke auf die Karte, um den Standort zu setzen</span>
              <Button size="sm" onClick={() => setPickingPoint(false)}>
                Abbrechen
              </Button>
            </div>
          )}
          {/* Eine leere Karte sieht aus wie eine kaputte Karte - der Grund
              gehoert dorthin, wo hingeschaut wird. */}
          {hint !== null && (
            <div className="panel row" style={{ padding: '5px 10px', gap: 8 }}>
              {loading && <Spinner />}
              <span className="small muted">{hint}</span>
            </div>
          )}
        </div>
      )}

      <MapControls baseLayer={baseLayer} onBaseLayerChange={setBaseLayer} />
    </>
  )
}

/** Kartenklicks - je nach aktivem Werkzeug. */
function MapClicks() {
  useMapEvents({
    click(event) {
      const ui = useUi.getState()
      const point = { lat: event.latlng.lat, lng: event.latlng.lng }

      if (ui.pickingPoint) {
        ui.setDraftPoint(point)
        ui.setPickingPoint(false)
        ui.setTab('locations')
        return
      }
      ui.selectLocation(null)
    },
  })
  return null
}

/** Springt den Ausschnitt an, den die Seitenleiste angefordert hat. */
function FocusHandler() {
  const map = useMap()
  // Der Zaehler ist die Ausloesebedingung: derselbe Punkt soll auch beim
  // zweiten Anklicken wieder angesprungen werden.
  const nonce = useUi((s) => s.focus?.nonce ?? 0)

  useEffect(() => {
    if (nonce === 0) return
    const focus = useUi.getState().focus
    if (!focus) return

    if (focus.point) {
      map.flyTo([focus.point.lat, focus.point.lng], focus.zoom ?? FOCUS_ZOOM)
      return
    }

    const points = focus.points ?? []
    if (points.length === 0) return
    map.fitBounds(
      points.map((p): LatLngTuple => [p.lat, p.lng]),
      { padding: BOUNDS_PADDING, maxZoom: FOCUS_ZOOM },
    )
  }, [map, nonce])

  return null
}

/**
 * Die Karte liegt in einem Raster, dessen Spalten sich beim Ein- und
 * Ausklappen der Seitenleiste aendern. Leaflet bemerkt das nicht von selbst
 * und zeichnet mit der alten Groesse weiter - der Rest bleibt grau.
 */
function SizeWatcher() {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    observer.observe(container)
    return () => observer.disconnect()
  }, [map])

  return null
}

/**
 * Die Kachelebene samt selbsttaetigem Ausweichen.
 *
 * Ein Kachelanbieter kann aus Gruenden ausfallen, die niemand hier in der Hand
 * hat: Sperre, Netzfilter, Ausfall. Weil die Karte auf jedem Geraet etwas
 * zeigen soll, wird nach mehreren Fehlern ohne einen einzigen Treffer auf den
 * naechsten Anbieter derselben Darstellung gewechselt.
 */
function BaseTiles({ layer }: { layer: BaseLayer }) {
  const [index, setIndex] = useState(0)
  const notify = useStore((s) => s.notify)
  const errors = useRef(0)
  const loaded = useRef(0)

  // Beim Ebenenwechsel wieder mit dem bevorzugten Anbieter beginnen.
  useEffect(() => {
    setIndex(0)
    errors.current = 0
    loaded.current = 0
  }, [layer.id])

  const source = layer.sources[Math.min(index, layer.sources.length - 1)]
  const hasFallback = index < layer.sources.length - 1

  return (
    <TileLayer
      // Der Schluessel erzwingt einen echten Wechsel: Adresse, Namensnennung
      // und Zoomgrenze gehoeren zusammen.
      key={`${layer.id}-${index}`}
      url={source.url}
      attribution={source.attribution}
      maxZoom={source.maxZoom}
      {...(source.subdomains ? { subdomains: source.subdomains } : {})}
      eventHandlers={{
        tileload: () => {
          loaded.current += 1
        },
        tileerror: () => {
          errors.current += 1
          // Erst wechseln, wenn NICHTS ankommt. Einzelne fehlende Kacheln am
          // Rand des Ausschnitts sind normal und kein Grund zum Wechsel.
          if (errors.current >= 4 && loaded.current === 0 && hasFallback) {
            const naechster = layer.sources[index + 1]
            errors.current = 0
            setIndex((i) => i + 1)
            notify(
              'info',
              `${source.provider} liefert keine Kacheln. Weiter mit ${naechster.provider}.`,
            )
          }
        },
      }}
    />
  )
}
