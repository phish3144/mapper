/**
 * Umgebungsliste zu einer gesuchten Adresse: welche gespeicherten Standorte
 * liegen ihr am naechsten?
 *
 * Die Rangfolge kommt immer aus der Luftlinie (nearestLocations). Fahrzeiten
 * werden nur nachtraeglich angehaengt — bleibt der Routing-Dienst stumm, ist
 * die Liste trotzdem vollstaendig und richtig sortiert. Deshalb wird ein
 * Fehlschlag hier auch nicht gemeldet, sondern nur benannt.
 *
 * Der Bezugspunkt kommt von aussen (uiStore.searchPoint), damit Karte und
 * Liste garantiert dieselbe Adresse meinen.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button, Checkbox, EmptyState, GroupStripe, Spinner } from '@/components/ui'
import { buildMembershipMap, categoryById, useCanEdit, useLocationColors, useStore } from '@/lib/store'
import { filterLocations, isFilterActive, useUi, type SearchPoint } from '@/lib/uiStore'
import { directionLabel, nearestLocations, withTravel, type NearbyEntry } from '@/lib/nearby'
import { getRouteProvider } from '@/lib/routing'
import { formatLatLng, isValidLatLng } from '@/lib/geo'
import { formatDistance, formatDuration, pluralize } from '@/lib/format'
import { symbolEmoji } from '@/lib/symbols'
import type { Category, LatLng } from '@/types/domain'

/** Mehr Treffer beantworten die Frage "was ist in der Naehe?" nicht besser. */
const NEARBY_LIMIT = 8

/** Zoomstufe fuer "Auf Karte zeigen" — Hausnummernebene. */
const FOCUS_ZOOM = 16

/** Ohne Kategorie gibt es keine Farbe; der Punkt bleibt dann neutral. */

type TravelStatus = 'idle' | 'loading' | 'ready' | 'failed'

/**
 * Fahrzeiten samt Schluessel der Anfrage, aus der sie stammen. Ohne den
 * Schluessel koennte eine spaet eintreffende Antwort an eine inzwischen andere
 * Liste geheftet werden — die Zeiten stuenden dann bei den falschen Standorten.
 */
interface TravelResult {
  key: string
  durations: number[]
  distances: number[]
}

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

  // Der sichtbare Text ist auf drei Spalten verteilt; vorgelesen ergibt er nur
  // als ein Satz Sinn.
  const spoken = [
    location.name,
    sub,
    `Luftlinie ${air} Richtung ${heading}`,
    entry.travelSec === null ? '' : `Fahrzeit ${formatDuration(entry.travelSec)}`,
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

      <span className="addr-hit-main" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="addr-hit-title truncate">{location.name}</span>
        <span className="addr-hit-sub truncate">{sub}</span>
      </span>

      <span className="addr-dist" aria-hidden="true">
        <strong>{air}</strong>
        <span style={{ display: 'block' }}>{heading}</span>
        {entry.travelSec !== null && (
          <span style={{ display: 'block' }}>Fahrt {formatDuration(entry.travelSec)}</span>
        )}
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

  const [travel, setTravel] = useState<TravelResult | null>(null)
  const [status, setStatus] = useState<TravelStatus>('idle')
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

  const base = useMemo(
    () => nearestLocations(origin, pool, { limit: NEARBY_LIMIT }),
    [origin, pool],
  )

  const matrixPoints = useMemo<LatLng[]>(
    () => [origin, ...base.map((e) => ({ lat: e.location.lat, lng: e.location.lng }))],
    [origin, base],
  )

  /**
   * Schluessel der Fahrzeit-Anfrage. Er nennt Kennung UND Koordinaten jedes
   * Ziels: verschobene Standorte muessen neu gerechnet werden, blosses
   * Neurendern nicht.
   */
  const travelKey = useMemo(
    () =>
      [
        `start@${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`,
        ...base.map(
          (e) => `${e.location.id}@${e.location.lat.toFixed(6)},${e.location.lng.toFixed(6)}`,
        ),
      ].join('|'),
    [origin, base],
  )

  // Der Effekt haengt allein am Schluessel; die Punkte selbst kommen ueber die
  // Ref herein. Ein Array in den Abhaengigkeiten waere bei jedem Rendern neu
  // und wuerde die Anfrage endlos wiederholen.
  const pointsRef = useRef<LatLng[]>(matrixPoints)
  useEffect(() => {
    pointsRef.current = matrixPoints
  }, [matrixPoints])

  useEffect(() => {
    const points = pointsRef.current
    // Ein einzelner Punkt ist der Suchpunkt selbst — dafuer gibt es nichts zu rechnen.
    if (points.length < 2) {
      setStatus('idle')
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setStatus('loading')

    void (async () => {
      try {
        const matrix = await getRouteProvider().matrix(points, 'driving', controller.signal)
        if (cancelled) return
        // Zeile 0 ist der Weg vom Suchpunkt zu den Zielen; Spalte 0 ist er selbst.
        setTravel({
          key: travelKey,
          durations: matrix.durations[0]?.slice(1) ?? [],
          distances: matrix.distances[0]?.slice(1) ?? [],
        })
        setStatus('ready')
      } catch {
        if (cancelled || controller.signal.aborted) return
        // Kein reportError: die Luftlinie beantwortet die Frage bereits, ein
        // Fehlerbanner waere hier lauter als der Verlust an Genauigkeit.
        setStatus('failed')
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [travelKey])

  const entries = useMemo(
    () =>
      travel && travel.key === travelKey
        ? withTravel(base, travel.durations, travel.distances)
        : base,
    [base, travel, travelKey],
  )

  const label = point.label.trim()
  // Ein Punkt ausserhalb des Gradnetzes ergibt weder eine Entfernung noch eine
  // Kartenposition. nearestLocations liefert dann leer — ohne diese Unterscheidung
  // stuende darunter "kein Standort in der Naehe" und schoebe die Schuld dem
  // Datenbestand zu.
  const originValid = isValidLatLng(origin)
  const coordinates = originValid ? formatLatLng(origin) : null

  function openLocation(entry: NearbyEntry): void {
    selectLocation(entry.location.id)
    focusPoint({ lat: entry.location.lat, lng: entry.location.lng })
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
          Diese Adresse hat keine brauchbaren Koordinaten — ohne sie laesst sich keine
          Entfernung messen.
        </EmptyState>
      )}

      {originValid && (
        <div className="addr-section">
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span className="addr-section-title">Naechste gespeicherte Standorte</span>
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
              <span>Fahrzeiten werden berechnet …</span>
            </div>
          )}
          {status === 'failed' && (
            <div className="small faint" style={{ marginTop: 4 }}>
              Fahrzeiten nicht verfuegbar — es gilt die Luftlinie.
            </div>
          )}
        </div>
      )}

      {originValid && locations.length === 0 && (
        <EmptyState>Noch keine Standorte gespeichert.</EmptyState>
      )}

      {originValid && locations.length > 0 && pool.length === 0 && (
        <EmptyState>
          <div>Der Filter laesst keinen Standort uebrig.</div>
          <div style={{ marginTop: 8 }}>
            <Button type="button" size="sm" onClick={() => setWithinFilter(false)}>
              Gegen alle Standorte messen
            </Button>
          </div>
        </EmptyState>
      )}

      {originValid && pool.length > 0 && entries.length === 0 && (
        <EmptyState>Kein Standort mit brauchbaren Koordinaten in der Naehe.</EmptyState>
      )}

      {entries.length > 0 && (
        // Die Zeilen stehen bewusst OHNE Zwischenelement in diesem Behaelter:
        // ".addr-hit:last-child" nimmt der letzten Zeile die Trennlinie, und in
        // einer eigenen Huelle waere jede Zeile die letzte — die Liste verloere
        // damit saemtliche Trennlinien.
        <div
          ref={listRef}
          role="group"
          aria-label="Naechste gespeicherte Standorte"
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
