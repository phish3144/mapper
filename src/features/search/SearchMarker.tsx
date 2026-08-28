/**
 * Die gesuchte Adresse als eigene Kartenebene.
 *
 * Die Ebene hat bewusst keine Eigenschaften: sie liest den Suchpunkt selbst
 * aus dem Oberflaechenzustand. Sonst muesste jede Stelle, die die Karte
 * einhaengt, den Punkt durchreichen — und die Suchleiste in der Kopfzeile
 * steht ganz woanders im Baum.
 *
 * Das Anspringen des Punktes macht die Suchleiste ueber `focusPoint`; hier
 * wird nichts bewegt, sonst zoegen zwei Stellen an derselben Karte.
 */
import { useEffect, useState } from 'react'
import L from 'leaflet'
import { Circle, Marker, Popup } from 'react-leaflet'
import { Button } from '@/components/ui'
import { formatLatLng } from '@/lib/geo'
import { useCanEdit } from '@/lib/store'
import { useUi } from '@/lib/uiStore'

/** Hof um die Adresse, damit die Nadel nicht allein im Kartenbild steht. */
const HALO_RADIUS_M = 250

/** Ueber den Standort- (0/500) und den Routennadeln (1000). */
const SEARCH_Z_OFFSET = 2000

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Greift nur, solange das Stilblatt noch nicht steht; entspricht dem hellen Token. */
const DANGER_FALLBACK = '#dc2626'

function readDangerColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim()
  return value || DANGER_FALLBACK
}

/**
 * Leaflet schreibt Linienfarben in SVG-Attribute; dort loest `var(--danger)`
 * nicht auf, der Wert muss also ausgelesen werden — sonst liefe der Hof im
 * Dunkelmodus gegen die Nadel, die ihre Farbe ueber die Klasse `.search-pin`
 * aus demselben Token nimmt. Neu ausgelesen wird sowohl bei der Wahl in der
 * Oberflaeche als auch beim Systemschema: bei der Einstellung 'system' gibt
 * es sonst kein Ereignis im Speicher.
 */
function useDangerColor(): string {
  const theme = useUi((s) => s.theme)
  const [color, setColor] = useState(readDangerColor)

  useEffect(() => {
    setColor(readDangerColor())
    const query = window.matchMedia(DARK_QUERY)
    const onChange = () => setColor(readDangerColor())
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [theme])

  return color
}

let searchIcon: L.DivIcon | null = null

/**
 * Leaflet-Icons sind Objekte, keine Komponenten: ein je Rendern neu gebautes
 * Icon liesse Leaflet das DOM der Nadel jedes Mal austauschen.
 */
function getSearchIcon(): L.DivIcon {
  searchIcon ??= L.divIcon({
    html:
      '<div class="search-pin" role="img" aria-label="Gesuchte Adresse">' +
      '<span aria-hidden="true">\u{1F50D}</span></div>',
    // Leer statt der Vorgabe 'leaflet-div-icon': sonst liegt ein weisser
    // Kasten hinter der Nadel.
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  })
  return searchIcon
}

export default function SearchMarker() {
  // Jeder Wert einzeln aus dem Speicher: ein Objektliteral als Selektor waere
  // bei jedem Aufruf neu und triebe das Rendern in eine Endlosschleife.
  const searchPoint = useUi((s) => s.searchPoint)
  const setSearchPoint = useUi((s) => s.setSearchPoint)
  const setDraftPoint = useUi((s) => s.setDraftPoint)
  const setTab = useUi((s) => s.setTab)
  const canEdit = useCanEdit()
  const haloColor = useDangerColor()

  if (!searchPoint) return null

  const position: [number, number] = [searchPoint.lat, searchPoint.lng]
  const coords = formatLatLng(searchPoint)
  // Der Geocoder kann eine leere Beschriftung liefern; dann traegt die
  // Koordinate den Namen — sonst haette die Nadel gar keinen.
  const label = searchPoint.label.trim() || coords

  function createLocation() {
    if (!searchPoint) return
    setDraftPoint({ lat: searchPoint.lat, lng: searchPoint.lng })
    setTab('locations')
  }

  return (
    <>
      {/* `interactive` gehoert an die Komponente und NICHT in `pathOptions`:
          react-leaflet reicht pathOptions erst nach dem Einhaengen ueber
          setStyle nach, und das nimmt der Flaeche die Klickfaehigkeit nicht
          mehr. Der Hof wuerde sonst Klicks auf darunterliegende Standorte
          schlucken. */}
      <Circle
        center={position}
        radius={HALO_RADIUS_M}
        interactive={false}
        pathOptions={{
          color: haloColor,
          weight: 1.5,
          opacity: 0.5,
          fillColor: haloColor,
          fillOpacity: 0.08,
        }}
      />
      <Marker
        position={position}
        icon={getSearchIcon()}
        title={label}
        zIndexOffset={SEARCH_Z_OFFSET}
      >
        <Popup>
          <div className="col" style={{ gap: 5 }}>
            <strong>{label}</strong>
            <span className="small muted">{coords}</span>
            <div className="row" style={{ gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
              {canEdit && (
                <Button size="sm" onClick={createLocation}>
                  Als Standort anlegen
                </Button>
              )}
              <Button size="sm" onClick={() => setSearchPoint(null)}>
                Suche aufheben
              </Button>
            </div>
          </div>
        </Popup>
      </Marker>
    </>
  )
}
