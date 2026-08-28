/**
 * Die Standorte auf der Karte.
 *
 * Gezeigt wird genau das Ergebnis von `filterLocations` - dieselbe reine
 * Funktion, die auch die Liste in der Seitenleiste verwendet. Karte und Liste
 * duerfen nie auseinanderlaufen.
 *
 * Ab einer gewissen Menge werden die Nadeln gebuendelt. Die Buendelung ist ein
 * Leaflet-Zusatz ohne React-Anbindung und wird deshalb von Hand verwaltet; bis
 * zur Schwelle bleibt es bei gewoehnlichen Marker-Komponenten.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import L from 'leaflet'
import 'leaflet.markercluster'
import { Marker, Popup, useMap } from 'react-leaflet'
import { Badge, Button, Dot } from '@/components/ui'
import * as db from '@/lib/db'
import { formatMinutes, formatTimeWindows } from '@/lib/format'
import { buildMembershipMap, categoryById, useCanEdit, useStore } from '@/lib/store'
import { filterLocations, useUi } from '@/lib/uiStore'
import type { Category, MapLocation } from '@/types/domain'
import { createPinIcon } from './markerIcons'

/** Ab hier wird gebuendelt - darunter sind Einzelnadeln uebersichtlicher. */
const CLUSTER_THRESHOLD = 60

/** Der ausgewaehlte Standort soll nicht unter seinen Nachbarn verschwinden. */
const SELECTED_Z_OFFSET = 500

type CategoryIndex = Map<string, Category>

function categoryOf(location: MapLocation, categories: CategoryIndex): Category | undefined {
  return location.category_id ? categories.get(location.category_id) : undefined
}

function iconFor(location: MapLocation, category: Category | undefined, selected: boolean) {
  return createPinIcon(category?.color ?? '', {
    selected,
    inactive: !location.is_active,
    // Ein am Standort gesetztes Symbol schlaegt das der Kategorie.
    symbol: location.icon ?? category?.icon,
  })
}

/**
 * Die sichtbare Menge. Karte, Bedienleiste und Seitenleiste muessen dieselbe
 * zeigen - deshalb steht die Ableitung an einer Stelle und nicht in jeder
 * Ansicht neu.
 */
export function useVisibleLocations(): MapLocation[] {
  const locations = useStore((s) => s.locations)
  const locationGroups = useStore((s) => s.locationGroups)
  const filter = useUi((s) => s.filter)

  const membership = useMemo(() => buildMembershipMap(locationGroups), [locationGroups])
  return useMemo(
    () => filterLocations(locations, filter, membership),
    [locations, filter, membership],
  )
}

export default function MarkerLayer() {
  const categories = useStore((s) => s.categories)
  const selectedId = useUi((s) => s.selectedLocationId)

  const visible = useVisibleLocations()
  const categoryIndex = useMemo(() => categoryById(categories), [categories])

  if (visible.length > CLUSTER_THRESHOLD) {
    return <ClusteredMarkers locations={visible} categories={categoryIndex} selectedId={selectedId} />
  }

  return (
    <>
      {visible.map((location) => (
        <PlainMarker
          key={location.id}
          location={location}
          category={categoryOf(location, categoryIndex)}
          selected={location.id === selectedId}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Einzelne Nadeln
// ---------------------------------------------------------------------------

function PlainMarker({
  location,
  category,
  selected,
}: {
  location: MapLocation
  category: Category | undefined
  selected: boolean
}) {
  const selectLocation = useUi((s) => s.selectLocation)

  return (
    <Marker
      position={[location.lat, location.lng]}
      icon={iconFor(location, category, selected)}
      title={location.name}
      zIndexOffset={selected ? SELECTED_Z_OFFSET : 0}
      eventHandlers={{ click: () => selectLocation(location.id) }}
    >
      <Popup>
        <LocationPopup location={location} />
      </Popup>
    </Marker>
  )
}

// ---------------------------------------------------------------------------
// Gebuendelte Nadeln
// ---------------------------------------------------------------------------

interface OpenPopup {
  marker: L.Marker
  element: HTMLElement
  location: MapLocation
}

function ClusteredMarkers({
  locations,
  categories,
  selectedId,
}: {
  locations: MapLocation[]
  categories: CategoryIndex
  selectedId: string | null
}) {
  const map = useMap()
  const selectLocation = useUi((s) => s.selectLocation)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const [openPopup, setOpenPopup] = useState<OpenPopup | null>(null)

  // Die Gruppe wird bei jeder Aenderung der sichtbaren Menge neu aufgebaut.
  // Ohne das saubere Abmelden bleiben herausgefilterte Nadeln stehen.
  useEffect(() => {
    // Bewusst OHNE chunkedLoading: die Buendelung verteilt die Arbeit dann auf
    // Zeitgeber, die sich nicht abbestellen lassen. Wer im Suchfeld tippt,
    // baut die Gruppe im Sekundentakt neu auf - ein Zeitgeber aus einem
    // bereits abgeraeumten Durchlauf liefe danach gegen eine Gruppe ohne
    // Karte. Der Aufbau in einem Zug ist hier das kleinere Uebel.
    const group = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 60,
    })
    const index = new Map<string, L.Marker>()
    const created: L.Marker[] = []

    for (const location of locations) {
      // Der Inhalt der Sprechblase wird von React in dieses Element gezeichnet,
      // damit es nur eine Fassung der Sprechblase gibt.
      const element = document.createElement('div')
      const marker = L.marker([location.lat, location.lng], {
        icon: iconFor(location, categoryOf(location, categories), false),
        title: location.name,
      })
      marker.bindPopup(element, { minWidth: 180 })
      marker.on('click', () => selectLocation(location.id))
      marker.on('popupopen', () => setOpenPopup({ marker, element, location }))
      marker.on('popupclose', () =>
        setOpenPopup((current) => (current && current.marker === marker ? null : current)),
      )
      index.set(location.id, marker)
      created.push(marker)
    }

    // Gesammelt statt einzeln: `addLayers` baut den Cluster-Baum einmal auf,
    // `addLayer` je Nadel erneut.
    group.addLayers(created)
    markersRef.current = index
    map.addLayer(group)

    return () => {
      map.removeLayer(group)
      group.clearLayers()
      markersRef.current = new Map()
      setOpenPopup(null)
    }
  }, [map, locations, categories, selectLocation])

  // Nur die betroffene Nadel anfassen: ein Neuaufbau der ganzen Gruppe wuerde
  // beim Anklicken eines Standorts dessen eigene Sprechblase wieder schliessen.
  useEffect(() => {
    if (!selectedId) return
    const marker = markersRef.current.get(selectedId)
    const location = locations.find((l) => l.id === selectedId)
    if (!marker || !location) return

    const category = categoryOf(location, categories)
    marker.setIcon(iconFor(location, category, true))
    marker.setZIndexOffset(SELECTED_Z_OFFSET)
    return () => {
      marker.setIcon(iconFor(location, category, false))
      marker.setZIndexOffset(0)
    }
  }, [selectedId, locations, categories])

  // Leaflet vermisst die Sprechblase beim Oeffnen - da ist sie noch leer.
  // Nach dem Zeichnen muss die Groesse deshalb neu bestimmt werden.
  useEffect(() => {
    openPopup?.marker.getPopup()?.update()
  }, [openPopup])

  if (!openPopup) return null
  return createPortal(<LocationPopup location={openPopup.location} />, openPopup.element)
}

// ---------------------------------------------------------------------------
// Sprechblase
// ---------------------------------------------------------------------------

function LocationPopup({ location }: { location: MapLocation }) {
  const categories = useStore((s) => s.categories)
  const groups = useStore((s) => s.groups)
  const locationGroups = useStore((s) => s.locationGroups)
  const loadStops = useStore((s) => s.loadStops)
  const notify = useStore((s) => s.notify)
  const reportError = useStore((s) => s.reportError)
  const canEdit = useCanEdit()

  const activeRouteId = useUi((s) => s.activeRouteId)
  const setEditingLocation = useUi((s) => s.setEditingLocation)

  const [busy, setBusy] = useState(false)

  const category = useMemo(
    () => (location.category_id ? categories.find((c) => c.id === location.category_id) ?? null : null),
    [categories, location.category_id],
  )

  const myGroups = useMemo(() => {
    const ids = new Set(
      locationGroups.filter((lg) => lg.location_id === location.id).map((lg) => lg.group_id),
    )
    return groups.filter((g) => ids.has(g.id))
  }, [groups, locationGroups, location.id])

  // Auch das Anhaengen an eine Route ist eine Aenderung: wer nur lesen darf,
  // bekommt die Schaltflaeche gar nicht erst zu sehen.
  const canAddToRoute = canEdit && activeRouteId !== null

  async function addToRoute() {
    if (!activeRouteId) return
    setBusy(true)
    try {
      // (route_id, position) ist eindeutig. Der Stand der Stoppliste wird erst
      // vom Routen-Editor geladen; waere er hier noch leer, liefe der neue
      // Stopp auf Position 0 und kollidierte mit dem ersten vorhandenen.
      if (!useStore.getState().stopsByRoute[activeRouteId]) await loadStops(activeRouteId)
      const stops = useStore.getState().stopsByRoute[activeRouteId] ?? []
      const position = stops.reduce((max, stop) => Math.max(max, stop.position), -1) + 1
      await db.addRouteStop(activeRouteId, location.id, position)
      await loadStops(activeRouteId)
      notify('success', `"${location.name}" zur Route hinzugefuegt.`)
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col" style={{ gap: 5 }}>
      <div className="row-between" style={{ gap: 8 }}>
        <strong>{location.name}</strong>
        {!location.is_active && <Badge tone="warning">Inaktiv</Badge>}
      </div>

      {category ? (
        <span className="row small muted" style={{ gap: 6 }}>
          <Dot color={category.color} />
          {category.name}
        </span>
      ) : (
        <span className="small faint">Ohne Kategorie</span>
      )}

      {location.address && <span className="small muted">{location.address}</span>}

      <span className="small muted">Zeiten: {formatTimeWindows(location.time_windows)}</span>
      <span className="small muted">Aufenthalt: {formatMinutes(location.service_minutes)}</span>

      {myGroups.length > 0 && (
        <div className="chips">
          {myGroups.map((group) => (
            <Badge key={group.id}>
              <Dot color={group.color} />
              {group.name}
            </Badge>
          ))}
        </div>
      )}

      {(canEdit || canAddToRoute) && (
        <div className="row" style={{ gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
          {canEdit && (
            <Button size="sm" onClick={() => setEditingLocation(location.id)}>
              Bearbeiten
            </Button>
          )}
          {canAddToRoute && (
            <Button size="sm" variant="primary" busy={busy} onClick={() => void addToRoute()}>
              Zur Route hinzufuegen
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
