/**
 * Umgebungsliste zu einer gesuchten Adresse: welche gespeicherten Standorte
 * liegen ihr am naechsten?
 *
 * Die Luftlinie waehlt nur vor: die ROAD_CANDIDATES naechsten Standorte
 * werden mit dem Routendienst gerechnet, und die FAHRZEIT entscheidet, welche
 * acht oben stehen. Angezeigt wird die Fahrstrecke, nicht die Luftlinie.
 *
 * Frueher war es umgekehrt: Rangfolge und grosse Zahl kamen aus der
 * Luftlinie, die Fahrzeit stand klein daneben. Nachgemessen lag die Strasse im
 * Mittel 39 km ueber der Luftlinie, bei jedem vierten Paar mehr als 50 km -
 * und der erste Vorschlag war nicht immer der schnellste.
 *
 * Bleibt der Routendienst stumm, gilt die Luftlinie, sichtbar als solche
 * benannt. Ein Fehlschlag wird nicht gemeldet, nur benannt.
 *
 * Der Bezugspunkt kommt von aussen (uiStore.searchPoint), damit Karte und
 * Liste garantiert dieselbe Adresse meinen.
 */
import { useMemo, useRef, type KeyboardEvent } from 'react'
import { Button, Checkbox, EmptyState, GroupStripe, Spinner } from '@/components/ui'
import { buildMembershipMap, categoryById, useCanEdit, useLocationColors, useStore } from '@/lib/store'
import { filterLocations, isFilterActive, useUi, type SearchPoint } from '@/lib/uiStore'
import {
  ROAD_CANDIDATES,
  directionLabel,
  nearestLocations,
  rankByTravel,
  withTravel,
  type NearbyEntry,
} from '@/lib/nearby'
import { useTravelFrom } from './useTravelFrom'
import { formatLatLng, isValidLatLng } from '@/lib/geo'
import { formatDistance, formatDuration, pluralize } from '@/lib/format'
import { symbolEmoji } from '@/lib/symbols'
import type { Category, LatLng } from '@/types/domain'

/** Mehr Treffer beantworten die Frage "was ist in der Naehe?" nicht besser. */
const NEARBY_LIMIT = 8

/** Zoomstufe fuer "Auf Karte zeigen" — Hausnummernebene. */
const FOCUS_ZOOM = 16

/** Ohne Kategorie gibt es keine Farbe; der Punkt bleibt dann neutral. */

function subLine(
  entry: NearbyEntry,
  category: Category | undefined,
  coordinates: string,
): string {
  const parts: string[] = []
  if (category) parts.push(category.name)
  const address = entry.location.address?.trim()
  if (address) parts.push(address)
  if (parts.length === 0) parts.push(coordinates)
  if (!entry.location.is_active) parts.push('inaktiv')
  return parts.join(' · ')
}

function NearbyRow({
  entry,
  category,
  colors,
  onSelect,
}: {
  entry: NearbyEntry
  category: Category | undefined
  colors: string[]
  onSelect: (entry: NearbyEntry) => void
}) {
  const { location } = entry
  const coordinates = formatLatLng({ lat: location.lat, lng: location.lng })
  const air = formatDistance(entry.airKm * 1000)
  const heading = directionLabel(entry.direction)
  const sub = subLine(entry, category, coordinates)
  // Die Fahrstrecke ist die Zahl, an der man eine Tour misst. Die Luftlinie
  // springt nur ein, wenn der Routendienst keine geliefert hat - und heisst
  // dann auch so.
  const road = entry.travelMeters === null ? null : formatDistance(entry.travelMeters)

  // Der sichtbare Text ist auf drei Spalten verteilt; vorgelesen ergibt er nur
  // als ein Satz Sinn.
  const spoken = [
    location.name,
    sub,
    road === null ? `Luftlinie ${air}` : `Fahrstrecke ${road}`,
    entry.travelSec === null ? '' : `Fahrzeit ${formatDuration(entry.travelSec)}`,
    `Richtung ${heading}`,
    // Was der Klick TUT, gehoert in den Namen der Schaltflaeche. Ohne das
    // hiesse sie nur "Bisol GmbH" und niemand wuesste, was passiert.
    'Route dorthin anzeigen',
  ]
    .filter((part) => part !== '')
    .join(', ')

  return (
    <button
      type="button"
      className="addr-hit"
      aria-label={spoken}
      onClick={() => onSelect(entry)}
    >
      <span className="row" style={{ gap: 4, flex: '0 0 auto' }} aria-hidden="true">
        <span>{symbolEmoji(location.icon ?? category?.icon)}</span>
        <GroupStripe colors={colors} />
      </span>

      <span className="addr-hit-main">
        <span className="addr-hit-title truncate">{location.name}</span>
        <span className="addr-hit-sub truncate">{sub}</span>
      </span>

      <span className="addr-dist" aria-hidden="true" title={`Luftlinie ${air}`}>
        <strong>{road ?? air}</strong>
        {road === null ? (
          <span style={{ display: 'block' }}>Luftlinie</span>
        ) : (
          entry.travelSec !== null && (
            <span style={{ display: 'block' }}>{formatDuration(entry.travelSec)} Fahrt</span>
          )
        )}
        <span style={{ display: 'block' }}>{heading}</span>
        {/* Kein eigener Knopf: die Zeile IST schon einer, und ein Knopf im
            Knopf waere ungueltig. Der Hinweis sagt trotzdem, was ein Klick
            bewirkt. */}
        <span className="addr-route-hint">Route →</span>
      </span>
    </button>
  )
}

export default function NearbyPanel({ point }: { point: SearchPoint }) {
  // Jeden Wert einzeln waehlen: ein Selektor, der ein Objekt baut, liefert bei
  // jedem Aufruf eine neue Referenz und laesst React endlos neu rendern.
  const locations = useStore((s) => s.locations)
  const categories = useStore((s) => s.categories)
  const locationGroups = useStore((s) => s.locationGroups)
  const canEdit = useCanEdit()

  const filter = useUi((s) => s.filter)
  const withinFilter = useUi((s) => s.searchWithinFilter)
  const setWithinFilter = useUi((s) => s.setSearchWithinFilter)
  const setSearchPoint = useUi((s) => s.setSearchPoint)
  const setDraftPoint = useUi((s) => s.setDraftPoint)
  const setTab = useUi((s) => s.setTab)
  const selectLocation = useUi((s) => s.selectLocation)
  const focusPoint = useUi((s) => s.focusPoint)
  const focusBounds = useUi((s) => s.focusBounds)
  const setRoutePreview = useUi((s) => s.setRoutePreview)

  const listRef = useRef<HTMLDivElement>(null)

  const origin = useMemo<LatLng>(() => ({ lat: point.lat, lng: point.lng }), [point.lat, point.lng])

  const membership = useMemo(() => buildMembershipMap(locationGroups), [locationGroups])
  const catIndex = useMemo(() => categoryById(categories), [categories])
  const colorsOf = useLocationColors()
  const filterActive = isFilterActive(filter)

  // Beide Mengen werden immer gebildet, damit der Unterschied zwischen "alle"
  // und "gefiltert" benannt werden kann und nicht nur behauptet.
  const filtered = useMemo(
    () => filterLocations(locations, filter, membership),
    [locations, filter, membership],
  )
  const pool = withinFilter ? filtered : locations

  // onlyActive: die Umgebungsliste ist Teil der Suchleiste und damit ein
  // Vorschlag. Ein stillgelegter Standort gehoert dort nicht hin - er wuerde
  // in der kurzen Liste einen gueltigen verdraengen.
  // Vorauswahl nach Luftlinie, aber breiter als die Liste: welche acht oben
  // stehen, entscheidet erst die Fahrzeit.
  const candidates = useMemo(
    () => nearestLocations(origin, pool, { limit: ROAD_CANDIDATES, onlyActive: true }),
    [origin, pool],
  )
  const targets = useMemo(
    () => candidates.map((e) => ({ id: e.location.id, lat: e.location.lat, lng: e.location.lng })),
    [candidates],
  )
  const { status, travel } = useTravelFrom(origin, targets)

  const entries = useMemo(
    () =>
      travel
        ? rankByTravel(withTravel(candidates, travel.durations, travel.distances), NEARBY_LIMIT)
        : candidates.slice(0, NEARBY_LIMIT),
    [candidates, travel],
  )

  const label = point.label.trim()
  // Ein Punkt ausserhalb des Gradnetzes ergibt weder eine Entfernung noch eine
  // Kartenposition. nearestLocations liefert dann leer — ohne diese Unterscheidung
  // stuende darunter "kein Standort in der Naehe" und schoebe die Schuld dem
  // Datenbestand zu.
  const originValid = isValidLatLng(origin)
  const coordinates = originValid ? formatLatLng(origin) : null

  function openLocation(entry: NearbyEntry): void {
    const ziel = { lat: entry.location.lat, lng: entry.location.lng }
    selectLocation(entry.location.id)
    // Die Strecke ist die eigentliche Antwort auf den Klick: gefragt ist nicht
    // "wo liegt der Standort?", sondern "wie komme ich von hier dorthin?".
    // Sie wird nur gezeichnet - kein Stopp, keine Tour, nichts gespeichert.
    setRoutePreview({
      from: origin,
      fromLabel: point.label.trim() || coordinates || 'Gesuchte Adresse',
      to: ziel,
      toLabel: entry.location.name,
      locationId: entry.location.id,
    })
    // Beide Enden ins Bild, sonst sieht man von der Strecke nur ein Stueck.
    focusBounds([origin, ziel])
  }

  function createLocation(): void {
    setDraftPoint(origin)
    setTab('locations')
  }

  /**
   * Pfeiltasten fuehren durch die Liste. Die Zeilen bleiben zusaetzlich normale
   * Tabstopps: die Aufklappflaeche ist kein Listenfeld, in dem die Tabulatortaste
   * die Auswahl uebernaehme — wer sie hier ueberspringt, kaeme nie an eine Zeile.
   */
  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const { key } = event
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return
    const container = listRef.current
    if (!container) return
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button.addr-hit'))
    if (buttons.length === 0) return

    event.preventDefault()
    const current = buttons.findIndex((b) => b === document.activeElement)
    let next: number
    if (key === 'Home') next = 0
    else if (key === 'End') next = buttons.length - 1
    else if (current === -1) next = key === 'ArrowDown' ? 0 : buttons.length - 1
    else next = (current + (key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  const measuredAgainst = withinFilter
    ? `misst gegen ${pluralize(filtered.length, 'gefilterten Standort', 'gefilterte Standorte')}` +
      (filterActive ? ` von ${locations.length}` : ' — zurzeit ist kein Filter gesetzt')
    : `misst gegen ${pluralize(locations.length, 'Standort', 'Standorte')}` +
      (filterActive ? ` — der Filter zeigt davon ${filtered.length}` : '')

  return (
    <div>
      <div className="addr-section">
        <div>
          <span className="addr-section-title">Gesuchte Adresse</span>
        </div>
        <div style={{ overflowWrap: 'anywhere' }}>
          {label === '' ? (coordinates ?? 'Adresse ohne Koordinaten') : label}
        </div>
        {label !== '' && coordinates !== null && (
          <div className="small faint">{coordinates}</div>
        )}

        <div className="row" style={{ flexWrap: 'wrap', marginTop: 7 }}>
          {originValid && (
            <Button type="button" size="sm" onClick={() => focusPoint(origin, FOCUS_ZOOM)}>
              Auf Karte zeigen
            </Button>
          )}
          {originValid && canEdit && (
            <Button type="button" size="sm" onClick={createLocation}>
              Als Standort anlegen
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => setSearchPoint(null)}>
            Suche aufheben
          </Button>
        </div>
      </div>

      {!originValid && (
        <EmptyState>
          Diese Adresse hat keine brauchbaren Koordinaten — ohne sie lässt sich keine
          Entfernung messen.
        </EmptyState>
      )}

      {originValid && (
        <div className="addr-section">
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span className="addr-section-title">Nächste gespeicherte Standorte</span>
            <Checkbox
              checked={withinFilter}
              onChange={setWithinFilter}
              label={<span className="small">nur gefilterte Standorte</span>}
            />
          </div>
          <div className="small faint">{measuredAgainst}</div>

          {status === 'loading' && (
            <div className="row small faint" style={{ marginTop: 4 }}>
              <Spinner />
              <span>Fahrstrecken werden berechnet — bis dahin nach Luftlinie …</span>
            </div>
          )}
          {status === 'ready' && (
            <div className="small faint" style={{ marginTop: 4 }}>
              Sortiert nach Fahrzeit, Entfernungen auf der Straße.
            </div>
          )}
          {status === 'failed' && (
            /* Die Zahl gehoert dazu: wer nur "Luftlinie" liest, rechnet sie
               trotzdem als Fahrstrecke. Ein Drittel ist der gemessene Mittelwert. */
            <div className="small faint" style={{ marginTop: 4 }}>
              Routendienst nicht erreichbar — Reihenfolge und Entfernungen nach Luftlinie. Die
              Fahrstrecke ist meist rund ein Drittel länger.
            </div>
          )}
        </div>
      )}

      {originValid && locations.length === 0 && (
        <EmptyState>Noch keine Standorte gespeichert.</EmptyState>
      )}

      {originValid && locations.length > 0 && pool.length === 0 && (
        <EmptyState>
          <div>Der Filter lässt keinen Standort übrig.</div>
          <div style={{ marginTop: 8 }}>
            <Button type="button" size="sm" onClick={() => setWithinFilter(false)}>
              Gegen alle Standorte messen
            </Button>
          </div>
        </EmptyState>
      )}

      {originValid && pool.length > 0 && entries.length === 0 && (
        <EmptyState>Kein Standort mit brauchbaren Koordinaten in der Nähe.</EmptyState>
      )}

      {entries.length > 0 && (
        // Die Zeilen stehen bewusst OHNE Zwischenelement in diesem Behaelter:
        // ".addr-hit:last-child" nimmt der letzten Zeile die Trennlinie, und in
        // einer eigenen Huelle waere jede Zeile die letzte — die Liste verloere
        // damit saemtliche Trennlinien.
        <div
          ref={listRef}
          role="group"
          aria-label="Nächste gespeicherte Standorte"
          aria-busy={status === 'loading'}
          onKeyDown={onListKeyDown}
        >
          {entries.map((entry) => (
            <NearbyRow
              key={entry.location.id}
              entry={entry}
              category={
                entry.location.category_id ? catIndex.get(entry.location.category_id) : undefined
              }
              colors={colorsOf(
                entry.location,
                entry.location.category_id ? catIndex.get(entry.location.category_id) : undefined,
              )}
              onSelect={openLocation}
            />
          ))}
        </div>
      )}
    </div>
  )
}
