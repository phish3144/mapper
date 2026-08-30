/**
 * Immer sichtbare Adresssuche der Kopfzeile.
 *
 * Ein Feld beantwortet hier zwei Fragen hintereinander: "wo liegt diese
 * Adresse?" und "was habe ich in ihrer Naehe gespeichert?". Deshalb wechselt
 * dieselbe Aufklappflaeche zwischen Trefferliste (waehrend des Tippens) und
 * Umgebungsliste (nach der Auswahl) — zwei getrennte Bedienelemente wuerden
 * denselben Bezugspunkt zweimal erfragen und koennten auseinanderlaufen.
 *
 * Der gewaehlte Punkt liegt im Oberflaechenzustand (uiStore.searchPoint) und
 * nicht hier, weil die Karte ihn als Nadel zeigen muss und die Umgebungsliste
 * gegen ihn misst.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Badge, EmptyState, IconButton, Spinner } from '@/components/ui'
import {
  createAddressSearch,
  type AddressMatch,
  type DebouncedAddressSearch,
  type GeocodeProblem,
} from '@/lib/geocode'
import { pluralize } from '@/lib/format'
import { useStore } from '@/lib/store'
import { symbolEmoji } from '@/lib/symbols'
import { useUi } from '@/lib/uiStore'
import type { MapLocation } from '@/types/domain'
import NearbyPanel from '@/features/search/NearbyPanel'

/** Kuerzere Eingaben treffen fast alles und kosten den Geocoder nur Anfragen. */
const MIN_QUERY_LENGTH = 3

/** Entprellung: lang genug, dass ein Wort zu Ende getippt wird. */
// Gemessen: Nominatim antwortet in rund 120 ms. Die Entprellung darf deshalb
// kurz sein - sie ist der groessere Anteil an der gefuehlten Wartezeit.
const DEBOUNCE_MS = 250
/**
 * Erst wenn nach der schnellen Suche eine Weile nichts mehr getippt wird,
 * lohnt die volle Lockerungskaskade. Waehrend des Tippens kostete sie bis zu
 * vier zusaetzliche Nominatim-Anfragen im Ein-Sekunden-Abstand.
 */
const DEEP_DEBOUNCE_MS = 600
/** Mehr als eine Handvoll eigener Treffer draengt die Adressen aus dem Blick. */
const OWN_MATCH_LIMIT = 5

/** Zoomstufe fuer die gewaehlte Adresse — Hausnummernebene. */
const FOCUS_ZOOM = 16

/** Nominatim liefert "Strasse 1, Ortsteil, Ort, PLZ, Land" — der erste Teil traegt. */
function shortName(label: string): string {
  const comma = label.indexOf(',')
  return comma === -1 ? label.trim() : label.slice(0, comma).trim()
}

function detailName(label: string): string {
  const comma = label.indexOf(',')
  return comma === -1 ? '' : label.slice(comma + 1).trim()
}

type PopMode = 'hits' | 'hint' | 'nearby' | 'none'

/**
 * Was die Aufklappflaeche zeigt. Frisch getippter Text gewinnt immer gegen
 * einen bereits gewaehlten Punkt: sonst suchte man ins Leere, waehrend
 * darunter die Umgebung der alten Adresse steht.
 */
function popMode(trimmed: string, retyped: boolean, hasPoint: boolean): PopMode {
  if (retyped && trimmed.length >= MIN_QUERY_LENGTH) return 'hits'
  if (retyped && trimmed.length > 0) return 'hint'
  return hasPoint ? 'nearby' : 'none'
}

/**
 * Was der Nutzerin gesagt wird, wenn der Dienst nicht antwortet. "Keine
 * Adresse gefunden" waere hier schlicht falsch.
 */
function problemText(problem: GeocodeProblem | null): string | null {
  // Eine Meldung erscheint erst, wenn BEIDE Dienste ausgefallen sind - der
  // erste Grund stammt vom bevorzugten Dienst.
  if (problem === 'rate-limit') {
    return 'Die Adressdienste sind gerade ausgelastet. Bitte einen Moment warten und erneut suchen.'
  }
  if (problem === 'blocked') return 'Die Adressdienste haben die Anfrage abgewiesen.'
  if (problem === 'network') {
    return 'Kein Adressdienst erreichbar. Pruefe die Internetverbindung, einen Inhaltsblocker oder die Firewall.'
  }
  if (problem === 'bad-response') return 'Die Adressdienste haben unverstaendlich geantwortet.'
  return null
}

export default function AddressSearchBar() {
  // Jeder Wert einzeln aus dem Speicher: ein Objektliteral als Selektor waere
  // bei jedem Aufruf neu und triebe React in eine Endlosschleife.
  const searchPoint = useUi((s) => s.searchPoint)
  const setSearchPoint = useUi((s) => s.setSearchPoint)
  const focusPoint = useUi((s) => s.focusPoint)
  const selectLocation = useUi((s) => s.selectLocation)
  // Einzeln auswaehlen: ein Selektor, der ein neues Objekt baut, loest in
  // React 19 eine Endlosschleife aus.
  const locations = useStore((s) => s.locations)
  const categories = useStore((s) => s.categories)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<AddressMatch[]>([])
  const [deepening, setDeepening] = useState(false)
  // Ein gedrosselter oder gesperrter Dienst ist etwas anderes als eine
  // unbekannte Adresse und muss auch so benannt werden.
  const [problem, setProblem] = useState<GeocodeProblem | null>(null)
  /** Anfrage, zu der die Treffer gehoeren — siehe `stale` weiter unten. */
  const [hitsQuery, setHitsQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  /** Ist der Text im Feld eine frische Anfrage oder die uebernommene Adresse? */
  const [retyped, setRetyped] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const uid = useId()
  const popId = `${uid}-pop`
  const listId = `${uid}-list`
  const optionId = (index: number): string => `${uid}-opt-${index}`

  // Eine Instanz fuer die gesamte Lebensdauer: sie haelt die Entprellung und
  // bricht beim Abmelden ab. Ohne den Abbruch meldete eine noch laufende
  // Anfrage in eine bereits abgemeldete Komponente zurueck.
  const searchRef = useRef<DebouncedAddressSearch | null>(null)
  if (searchRef.current === null) searchRef.current = createAddressSearch(DEBOUNCE_MS)
  const search = searchRef.current

  // Eigene Instanz mit laengerer Entprellung fuer die gruendliche Nachsuche.
  const deepRef = useRef<DebouncedAddressSearch | null>(null)
  if (deepRef.current === null) deepRef.current = createAddressSearch(DEEP_DEBOUNCE_MS)
  const deepSearch = deepRef.current

  useEffect(
    () => () => {
      search.cancel()
      deepSearch.cancel()
    },
    [search, deepSearch],
  )

  const trimmed = query.trim()
  const mode = popMode(trimmed, retyped, searchPoint !== null)
  const showPop = open && mode !== 'none'
  const showList = mode === 'hits' && hits.length > 0
  const showClear = query !== '' || searchPoint !== null
  /**
   * Die stehende Liste gehoert noch zur vorigen Anfrage. Sie bleibt sichtbar,
   * damit zwischen zwei Tastenanschlaegen nichts flackert — aber sie darf
   * nicht mehr blind uebernommen werden: sonst springt die Karte auf eine
   * Adresse, die zu einem laengst ueberholten Praefix gehoert.
   */
  const stale = hitsQuery !== trimmed

  // Klick ausserhalb schliesst nur die Flaeche. Der gewaehlte Punkt bleibt,
  // damit die Nadel auf der Karte nicht bei jedem Kartenklick verschwindet.
  useEffect(() => {
    if (!showPop) return
    const onPointerDown = (event: MouseEvent): void => {
      const root = rootRef.current
      if (root && event.target instanceof Node && !root.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [showPop])

  // Die Tastaturauswahl muss auch unterhalb des sichtbaren Bereichs mitlaufen.
  useEffect(() => {
    if (activeIndex < 0) return
    const node = listRef.current?.children.item(activeIndex)
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  /**
   * Treffer aus dem eigenen Bestand. Kosten null und stehen sofort da - haeufig
   * ist der gesuchte Ort ohnehin schon gespeichert.
   */
  const ownMatches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length < MIN_QUERY_LENGTH) return []
    const byId = new Map(categories.map((c) => [c.id, c]))
    return locations
      .filter((l) =>
        `${l.name} ${l.address ?? ''} ${l.tags.join(' ')}`.toLowerCase().includes(needle),
      )
      .slice(0, OWN_MATCH_LIMIT)
      .map((location) => ({
        location,
        category: location.category_id ? byId.get(location.category_id) : undefined,
      }))
  }, [query, locations, categories])

  function applyOwn(location: MapLocation): void {
    search.cancel()
    deepSearch.cancel()
    selectLocation(location.id)
    focusPoint({ lat: location.lat, lng: location.lng }, FOCUS_ZOOM)
    setOpen(false)
  }

  function runSearch(value: string): void {
    setQuery(value)
    setRetyped(true)
    setActiveIndex(-1)
    setOpen(true)

    const next = value.trim()
    if (next.length < MIN_QUERY_LENGTH) {
      search.cancel()
      deepSearch.cancel()
      setHits([])
      setHitsQuery(next)
      setSearching(false)
      return
    }
    setSearching(true)
    setDeepening(false)
    deepSearch.cancel()

    // Schnell: nur der erste Schritt beim bevorzugten Dienst.
    search(
      next,
      (result, forQuery) => {
        setHits(result.matches)
        setProblem(result.problem)
        setHitsQuery(forQuery)
        setActiveIndex(-1)
        setSearching(false)

        // Bleibt es leer und lag kein Fehler vor, war die Eingabe vermutlich
        // nur noch nicht vollstaendig. Nach einer Pause wird gruendlich
        // gesucht - waehrend des Tippens waere das reine Wartezeit.
        if (result.matches.length === 0 && result.problem === null) {
          setDeepening(true)
          deepSearch(
            forQuery,
            (deep, deepQuery) => {
              setDeepening(false)
              setHits(deep.matches)
              setProblem(deep.problem)
              setHitsQuery(deepQuery)
            },
            { mode: 'full' },
          )
        }
      },
      { mode: 'quick' },
    )
  }

  function applyHit(hit: AddressMatch): void {
    search.cancel()
    deepSearch.cancel()
    setSearchPoint({ lat: hit.lat, lng: hit.lng, label: hit.label })
    focusPoint({ lat: hit.lat, lng: hit.lng }, FOCUS_ZOOM)
    setQuery(shortName(hit.label))
    setHits([])
    setHitsQuery('')
    setSearching(false)
    setActiveIndex(-1)
    setRetyped(false)
    // Offen lassen: an der Stelle der Trefferliste steht jetzt die Umgebung.
    setOpen(true)
    inputRef.current?.focus()
  }

  function clearInput(): void {
    search.cancel()
    deepSearch.cancel()
    setQuery('')
    setHits([])
    setHitsQuery('')
    setSearching(false)
    setActiveIndex(-1)
    setRetyped(false)
  }

  function clearAll(): void {
    clearInput()
    setSearchPoint(null)
    setOpen(false)
    inputRef.current?.focus()
  }

  function moveActive(step: number): void {
    if (hits.length === 0) return
    setActiveIndex((current) => {
      const next = current + step
      if (next < 0) return hits.length - 1
      if (next >= hits.length) return 0
      return next
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (mode === 'none') return
      event.preventDefault()
      if (!showPop) {
        setOpen(true)
        return
      }
      if (showList) moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }

    if (event.key === 'Enter') {
      if (!showList) return
      // Ohne Hervorhebung gilt der erste Treffer — aber nur, solange er zur
      // getippten Anfrage gehoert. Eine hervorgehobene Zeile hat der Nutzer
      // dagegen gerade gesehen und gewaehlt.
      const hit = activeIndex >= 0 ? hits[activeIndex] : stale ? undefined : hits[0]
      if (!hit) return
      event.preventDefault()
      applyHit(hit)
      return
    }

    if (event.key === 'Escape') {
      if (showPop) {
        // Aeltere Browser stellen bei Escape den vorigen Feldinhalt wieder her;
        // das waere die zweite Stufe schon beim ersten Druck.
        event.preventDefault()
        setOpen(false)
        setActiveIndex(-1)
        return
      }
      // Zweites Escape raeumt das Feld. Der Punkt und damit die Nadel bleiben;
      // dafuer ist der Loeschknopf da.
      if (query !== '') {
        event.preventDefault()
        clearInput()
      }
    }
  }

  // Vorgelesene Rueckmeldung: die Trefferliste erscheint sonst lautlos.
  const statusText =
    showPop && mode === 'hits'
      ? searching
        ? 'Adressen werden gesucht …'
        : hits.length === 0
          ? deepening
            ? 'Suche wird erweitert …'
            : (problemText(problem) ?? 'Keine Adresse gefunden.')
          : `${pluralize(hits.length, 'Adresse', 'Adressen')} gefunden.`
      : ''

  return (
    <div className="addr-search" ref={rootRef}>
      <input
        ref={inputRef}
        className="input"
        // Bewusst kein type="search": dessen browsereigenes Loeschkreuz saesse
        // genau auf dem eigenen Loeschknopf.
        type="text"
        value={query}
        placeholder="Adresse suchen …"
        aria-label="Adresse suchen"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={showPop}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls={showPop ? (showList ? listId : popId) : undefined}
        aria-activedescendant={showList && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        onChange={(e) => runSearch(e.target.value)}
        onKeyDown={onKeyDown}
        // Unbedingt oeffnen: was nichts zu zeigen hat, bleibt ueber `mode`
        // ohnehin zu. Der Klick faengt den Fall ab, dass das Feld den Fokus
        // schon hat und die Flaeche mit Escape geschlossen wurde.
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      />

      <span className="sr-only" role="status" aria-live="polite">
        {statusText}
      </span>

      {showClear && (
        <IconButton
          className="addr-search-clear"
          label="Adresssuche zuruecksetzen"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clearAll}
        >
          ✕
        </IconButton>
      )}

      {showPop && (
        <div className="addr-pop" id={popId}>
          <div className="addr-pop-scroll">
            {mode === 'hint' && (
              <div className="empty small">
                Mindestens {MIN_QUERY_LENGTH} Zeichen eingeben.
              </div>
            )}

            {mode === 'hits' && ownMatches.length > 0 && (
              <>
                <div className="addr-section">
                  <span className="addr-section-title">Eigene Standorte</span>
                </div>
                {ownMatches.map((entry) => (
                  <button
                    key={entry.location.id}
                    type="button"
                    className="addr-hit"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyOwn(entry.location)}
                  >
                    <span aria-hidden="true" style={{ fontSize: 16, lineHeight: '20px' }}>
                      {symbolEmoji(entry.location.icon ?? entry.category?.icon)}
                    </span>
                    <span className="addr-hit-main">
                      <span className="addr-hit-title truncate">{entry.location.name}</span>
                      <span className="addr-hit-sub truncate">
                        {[entry.category?.name, entry.location.address].filter(Boolean).join(' · ') ||
                          'Ohne Kategorie'}
                      </span>
                    </span>
                  </button>
                ))}
              </>
            )}

            {mode === 'hits' && (
              <>
                {searching && (
                  <div className="row" style={{ padding: '10px 11px' }}>
                    <Spinner />
                    <span className="small muted">Adressen werden gesucht …</span>
                  </div>
                )}

                {!searching && hits.length === 0 && (
                  <EmptyState>
                    {deepening ? (
                      <span className="row" style={{ gap: 8, justifyContent: 'center' }}>
                        <Spinner /> Suche wird erweitert …
                      </span>
                    ) : (
                      (problemText(problem) ?? 'Keine Adresse gefunden.')
                    )}
                  </EmptyState>
                )}

                {showList && (
                  <>
                    <div className="addr-section">
                      <span className="addr-section-title">Gefundene Adressen</span>
                    </div>
                    <div
                      id={listId}
                      role="listbox"
                      aria-label="Gefundene Adressen"
                      aria-busy={searching}
                      ref={listRef}
                    >
                      {hits.map((hit, index) => {
                        const detail = detailName(hit.label)
                        return (
                          <button
                            key={`${hit.lat},${hit.lng},${index}`}
                            id={optionId(index)}
                            type="button"
                            role="option"
                            aria-selected={index === activeIndex}
                            tabIndex={-1}
                            className={`addr-hit ${index === activeIndex ? 'is-active' : ''}`}
                            // Ohne dies nimmt der Klick dem Feld den Fokus,
                            // noch bevor die Auswahl ankommt.
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => applyHit(hit)}
                          >
                            <span aria-hidden="true">📍</span>
                            <span
                              className="addr-hit-main"
                              style={{ display: 'flex', flexDirection: 'column' }}
                            >
                              <span className="addr-hit-title truncate">{shortName(hit.label)}</span>
                              {detail !== '' && (
                                <span className="addr-hit-sub truncate">{detail}</span>
                              )}
                              {/* Ohne diesen Hinweis ginge eine Strassenmitte
                                  als exakte Hausnummer durch. */}
                              {hit.note !== null && (
                                <span className="addr-hit-sub" style={{ marginTop: 2 }}>
                                  <Badge tone="warning">{hit.note}</Badge>
                                </span>
                              )}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {mode === 'nearby' && searchPoint !== null && <NearbyPanel point={searchPoint} />}
          </div>
        </div>
      )}
    </div>
  )
}
