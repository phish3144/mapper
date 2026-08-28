/**
 * Adressen einwerfen, Tour bekommen - fest in der Seitenleiste, kein Dialog.
 *
 * Der Kasten steht immer da, ueber der Routenliste wie ueber dem Routeneditor.
 * Das ist der Kern: wer eine Tour bauen will, muss nicht erst wissen, dass es
 * dafuer einen Knopf gibt, der ein Fenster oeffnet. Und weil der Kasten beim
 * Wechsel zwischen Liste und Editor stehen bleibt, ueberlebt der Bericht den
 * Augenblick, in dem die frisch gebaute Tour aufgeht - die nicht gefundenen
 * Zeilen bleiben zum Nachbessern im Feld.
 *
 * Liegt eine Route offen, haengt der Kasten an sie an, statt eine zweite
 * danebenzustellen.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, PALETTE } from '@/components/ui'
import { useCanEdit, useStore } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import * as db from '@/lib/db'
import { describeError } from '@/lib/supabase'
import { findAddress } from '@/lib/geocode'
import { getRouteProvider, haversineMatrix } from '@/lib/routing'
import type { TravelMatrix } from '@/lib/routing'
import { optimizeOrder } from '@/lib/planner'
import type { PlanStopInput } from '@/lib/planner'
import { pluralize } from '@/lib/format'
import {
  MAX_ADDRESSES,
  TOUR_GROUP_NAME,
  buildAddressIndex,
  checkMatch,
  findByPoint,
  findByText,
  locationName,
  needsReview,
  normalizeAddressKey,
  orderedUnique,
  parseAddressLines,
  tourName,
} from './quickTour'
import type { ResolvedLine } from './quickTour'
import type { LatLng, MapLocation, Route, RouteStop } from '@/types/domain'

const START_ADDRESS_KEY = 'mapper.startAddress'
const MAX_SHOWN_LINES = 8
/** So viele gespeicherte Standorte schlaegt das Startfeld hoechstens vor. */
const MAX_START_SUGGESTIONS = 8

const ADDR_HIT_CLASS = (aktiv: boolean): string => (aktiv ? 'addr-hit is-active' : 'addr-hit')

interface TourReport {
  created: number
  reused: number
  missing: number
  lines: ResolvedLine[]
  note: string | null
}

interface GemerkterStart {
  text: string
  /** Kennung des gewaehlten Standorts; null bei frei eingegebener Adresse. */
  id: string | null
}

/**
 * Der zuletzt benutzte Start. Frueher stand hier nur Text; seit der Start
 * waehlbar ist, gehoert die Kennung dazu - sonst muesste ein wiedergefundener
 * Standort erneut geokodiert werden, obwohl seine Koordinaten laengst
 * vorliegen. Alte Eintraege sind reiner Text und werden weiter gelesen.
 */
function readStart(): GemerkterStart {
  try {
    const roh = localStorage.getItem(START_ADDRESS_KEY)
    if (!roh) return { text: '', id: null }
    if (!roh.startsWith('{')) return { text: roh, id: null }
    const gelesen = JSON.parse(roh) as Partial<GemerkterStart>
    return { text: typeof gelesen.text === 'string' ? gelesen.text : '', id: gelesen.id ?? null }
  } catch {
    // Privates Fenster, gesperrte Speicherung, Unsinn im Speicher: kein Grund,
    // das Feld zu verweigern.
    return { text: '', id: null }
  }
}

function rememberStart(text: string, id: string | null): void {
  try {
    if (text.trim() === '') localStorage.removeItem(START_ADDRESS_KEY)
    else localStorage.setItem(START_ADDRESS_KEY, JSON.stringify({ text: text.trim(), id }))
  } catch {
    /* Kein Speicher, kein Beinbruch. */
  }
}

export default function QuickTourPanel({ route }: { route: Route | null }) {
  const canEdit = useCanEdit()
  const workspaceId = useStore((s) => s.currentWorkspaceId)
  const locations = useStore((s) => s.locations)
  const notify = useStore((s) => s.notify)
  const setActiveRoute = useUi((s) => s.setActiveRoute)
  const focusBounds = useUi((s) => s.focusBounds)

  const [startText, setStartText] = useState(() => readStart().text)
  const [startLocationId, setStartLocationId] = useState<string | null>(() => readStart().id)
  const [startOffen, setStartOffen] = useState(false)
  const [startAktiv, setStartAktiv] = useState(-1)
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [report, setReport] = useState<TourReport | null>(null)

  const startRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Rettungsanker: scheitert ein Schritt NACH createRoute, darf der naechste
  // Versuch keine zweite Tour anlegen.
  const routeIdRef = useRef<string | null>(null)

  const parsed = useMemo(() => parseAddressLines(text, MAX_ADDRESSES), [text])
  const anhaengen = route !== null
  const mitStart = !anhaengen && startText.trim() !== ''

  /**
   * Vorschlaege aus dem eigenen Bestand. Ein leeres Feld zeigt die ersten
   * Standorte, damit ueberhaupt sichtbar wird, dass hier etwas zu waehlen ist -
   * ein Feld, das nur auf Eingabe reagiert, sieht aus wie ein blosses Textfeld.
   */
  const startVorschlaege = useMemo(() => {
    if (!startOffen) return []
    const suche = normalizeAddressKey(startText)
    const bewertet: { ort: MapLocation; rang: number }[] = []
    for (const ort of locations) {
      if (suche === '') {
        bewertet.push({ ort, rang: 2 })
        continue
      }
      const name = normalizeAddressKey(ort.name)
      const adresse = normalizeAddressKey(ort.address ?? '')
      if (name.startsWith(suche) || adresse.startsWith(suche)) bewertet.push({ ort, rang: 0 })
      else if (name.includes(suche) || adresse.includes(suche)) bewertet.push({ ort, rang: 1 })
    }
    bewertet.sort((a, b) => a.rang - b.rang || a.ort.name.localeCompare(b.ort.name, 'de'))
    return bewertet.slice(0, MAX_START_SUGGESTIONS).map((x) => x.ort)
  }, [locations, startText, startOffen])

  useEffect(() => {
    if (!startOffen) return
    const zu = (e: MouseEvent) => {
      if (!startRef.current?.contains(e.target as Node)) setStartOffen(false)
    }
    document.addEventListener('mousedown', zu)
    return () => document.removeEventListener('mousedown', zu)
  }, [startOffen])

  function waehleStart(ort: MapLocation): void {
    setStartText(ort.name)
    setStartLocationId(ort.id)
    setStartOffen(false)
    setStartAktiv(-1)
    // Der Startpunkt ist der letzte fehlende Baustein: stehen unten schon
    // Adressen, wird jetzt gebaut statt noch einen Knopfdruck zu verlangen.
    // Die Wahl geht als Argument mit - der Zustand oben traegt in diesem
    // Durchlauf noch den alten Wert.
    if (!anhaengen && !running && parsed.lines.length > 0) {
      void run({ text: ort.name, id: ort.id })
    }
  }

  if (!canEdit) return null

  /** Loest eine Zeile auf: erst im Bestand suchen, dann fragen. */
  async function resolveLine(
    line: string,
    index: ReadonlyMap<string, MapLocation>,
    bestand: readonly MapLocation[],
    signal: AbortSignal,
  ): Promise<ResolvedLine> {
    const vorhanden = findByText(line, index)
    if (vorhanden) {
      return {
        raw: line,
        kind: 'reused',
        locationId: vorhanden.id,
        point: { lat: vorhanden.lat, lng: vorhanden.lng },
        label: vorhanden.name,
        hint: null,
      }
    }

    const lookup = await findAddress(line, { limit: 5, countryCodes: 'de,at,ch', signal })
    if (signal.aborted) {
      return { raw: line, kind: 'missing', locationId: null, point: null, label: null, hint: 'Abgebrochen.' }
    }

    const { match, hint } = checkMatch(lookup)
    if (!match) {
      return { raw: line, kind: 'missing', locationId: null, point: null, label: null, hint }
    }

    const punkt: LatLng = { lat: match.lat, lng: match.lng }
    // Dieselbe Stelle, andere Schreibweise: der Textabgleich hat sie nicht
    // gefunden, die Koordinate schon.
    const amSelbenFleck = findByPoint(punkt, bestand)
    if (amSelbenFleck) {
      return {
        raw: line,
        kind: 'reused',
        locationId: amSelbenFleck.id,
        point: { lat: amSelbenFleck.lat, lng: amSelbenFleck.lng },
        label: amSelbenFleck.name,
        hint: null,
      }
    }

    const zweifel = hint ?? (needsReview(line) ? 'Ohne Ort und Postleitzahl - bitte pruefen' : null)
    return {
      raw: line,
      kind: zweifel ? 'unsure' : 'created',
      locationId: null,
      point: punkt,
      label: match.label,
      hint: zweifel,
    }
  }

  async function run(startWahl?: { text: string; id: string | null }): Promise<void> {
    if (!workspaceId) return
    // Bei der Auswahl aus der Liste kommt der Start als Argument, sonst steht
    // er im Zustand. Ab hier gilt nur noch diese eine Fassung.
    const start = startWahl ?? { text: startText, id: startLocationId }
    const startGesetzt = !anhaengen && start.text.trim() !== ''
    const zeilen = startGesetzt ? [start.text.trim(), ...parsed.lines] : parsed.lines
    if (zeilen.length === 0) return

    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setReport(null)
    setProgress({ done: 0, total: zeilen.length })

    const bestand = [...useStore.getState().locations]
    const index = buildAddressIndex(bestand)
    const aufgeloest: ResolvedLine[] = []

    try {
      // Ein aus der Liste gewaehlter Start hat seine Koordinaten bereits - der
      // darf keine Anfrage kosten und kann auch nicht danebengreifen.
      const gewaehlterStart =
        startGesetzt && start.id ? (bestand.find((l) => l.id === start.id) ?? null) : null

      for (const [i, zeile] of zeilen.entries()) {
        if (controller.signal.aborted) break
        if (i === 0 && gewaehlterStart) {
          aufgeloest.push({
            raw: zeile,
            kind: 'reused',
            locationId: gewaehlterStart.id,
            point: { lat: gewaehlterStart.lat, lng: gewaehlterStart.lng },
            label: gewaehlterStart.name,
            hint: null,
          })
        } else {
          aufgeloest.push(await resolveLine(zeile, index, bestand, controller.signal))
        }
        setProgress((p) => ({ ...p, done: p.done + 1 }))
      }

      if (controller.signal.aborted) {
        setReport({ created: 0, reused: 0, missing: 0, lines: [], note: 'Abgebrochen. Es wurde nichts angelegt.' })
        return
      }

      const anzulegen = aufgeloest.filter((l) => l.locationId === null && l.point !== null)
      const gefunden = aufgeloest.filter((l) => l.locationId !== null || l.point !== null)

      if (gefunden.length === 0) {
        setReport({
          created: 0,
          reused: 0,
          missing: aufgeloest.length,
          lines: aufgeloest,
          note: 'Keine der Adressen wurde gefunden. Es wurde nichts angelegt.',
        })
        return
      }

      // --- Standorte anlegen -------------------------------------------------
      if (anzulegen.length > 0) {
        const angelegt = await db.createLocations(
          workspaceId,
          anzulegen.map((l) => ({
            name: locationName(l.raw),
            lat: l.point?.lat ?? 0,
            lng: l.point?.lng ?? 0,
            address: l.label,
            notes: null,
            category_id: null,
            service_minutes: 0,
            time_windows: [],
            tags: [],
            is_active: true,
            icon: null,
            visibility: 'workspace' as const,
          })),
        )
        // Zuordnung ueber den Namen, nicht ueber die Position: das INSERT sagt
        // keine Reihenfolge zu. Die Namen sind nach der Entdopplung eindeutig.
        const nachName = new Map(angelegt.map((l) => [l.name, l]))
        for (const zeile of anzulegen) {
          const treffer = nachName.get(locationName(zeile.raw))
          if (treffer) zeile.locationId = treffer.id
        }

        // Die Gruppe erst jetzt - sie soll nicht entstehen, wenn nichts hineinkommt.
        const neueIds = anzulegen.map((l) => l.locationId).filter((id): id is string => id !== null)
        if (neueIds.length > 0) {
          const vorhandeneGruppe = useStore
            .getState()
            .groups.find((g) => g.name.toLowerCase() === TOUR_GROUP_NAME.toLowerCase())
          const gruppe =
            vorhandeneGruppe ??
            (await db.createGroup(workspaceId, {
              name: TOUR_GROUP_NAME,
              color: PALETTE[useStore.getState().groups.length % PALETTE.length],
            }))
          await db.addLocationsToGroup(neueIds, gruppe.id)
          if (!vorhandeneGruppe) await useStore.getState().reloadWorkspaceData()
        }
      }

      await useStore.getState().refreshLocations()

      // --- Route und Stopps --------------------------------------------------
      const startZeile = startGesetzt ? aufgeloest[0] : null
      let routeId = routeIdRef.current ?? route?.id ?? null
      if (routeId === null) {
        const neu = await db.createRoute(workspaceId, {
          name: tourName(new Date()),
          mode: 'manual',
          rule: {},
          start_location_id: startZeile?.locationId ?? null,
        })
        routeId = neu.id
        routeIdRef.current = neu.id
      }

      await useStore.getState().loadStops(routeId)
      const schonDrin = new Set((useStore.getState().stopsByRoute[routeId] ?? []).map((s) => s.location_id))
      const neueStopps = orderedUnique(
        aufgeloest.map((l) => l.locationId).filter((id): id is string => id !== null && !schonDrin.has(id)),
      )
      if (neueStopps.length > 0) {
        const hoechste = (useStore.getState().stopsByRoute[routeId] ?? []).reduce(
          (max, s) => Math.max(max, s.position),
          -1,
        )
        await db.addRouteStops(routeId, neueStopps, hoechste + 1)
        await useStore.getState().loadStops(routeId)
      }

      // --- Reihenfolge rechnen ----------------------------------------------
      const nachId = new Map(useStore.getState().locations.map((l) => [l.id, l]))
      const stopps: { stop: RouteStop; location: MapLocation }[] = []
      for (const stop of [...(useStore.getState().stopsByRoute[routeId] ?? [])].sort(
        (a, b) => a.position - b.position,
      )) {
        const location = nachId.get(stop.location_id)
        // Ein Stopp ohne sichtbaren Standort kommt vor - dann fehlt er hier,
        // statt die Matrixindizes stillschweigend zu verschieben.
        if (location) stopps.push({ stop, location })
      }

      let geschaetzt = false
      if (stopps.length >= 3) {
        const punkte = stopps.map((e) => ({ lat: e.location.lat, lng: e.location.lng }))
        let matrix: TravelMatrix
        try {
          matrix = await getRouteProvider().matrix(punkte, 'driving', controller.signal)
        } catch {
          matrix = haversineMatrix(punkte)
          geschaetzt = true
        }
        const planStopps: PlanStopInput[] = stopps.map((e) => ({
          locationId: e.location.id,
          point: { lat: e.location.lat, lng: e.location.lng },
          serviceMinutes: e.location.service_minutes,
          timeWindows: e.location.time_windows,
        }))
        const startLocationId = startZeile?.locationId ?? route?.start_location_id ?? null
        const startIndex = startLocationId
          ? stopps.findIndex((e) => e.location.id === startLocationId)
          : -1
        const ergebnis = optimizeOrder(planStopps, matrix, {
          departAt: route?.depart_at ? new Date(route.depart_at) : null,
          fixedStartIndex: startIndex >= 0 ? startIndex : null,
          fixedEndIndex: null,
          roundtrip: route?.roundtrip ?? false,
        })
        await db.reorderRouteStops(
          routeId,
          ergebnis.order.map((i) => stopps[i].stop.id),
        )
        await useStore.getState().loadStops(routeId)
      }

      await useStore.getState().refreshRoutes()
      setActiveRoute(routeId)
      focusBounds(stopps.map((e) => ({ lat: e.location.lat, lng: e.location.lng })))
      if (startGesetzt) rememberStart(start.text, startZeile?.locationId ?? null)

      const erzeugt = aufgeloest.filter((l) => l.kind === 'created' || l.kind === 'unsure').length
      const wiederverwendet = aufgeloest.filter((l) => l.kind === 'reused').length
      const fehlend = aufgeloest.filter((l) => l.kind === 'missing')
      const zuPruefen = aufgeloest.filter((l) => l.hint !== null && l.kind !== 'missing')

      // Nicht Gefundenes bleibt im Feld stehen, dazu der abgeschnittene Rest -
      // sonst waere es nach dem Lauf unwiederbringlich weg.
      setText([...fehlend.map((l) => l.raw), ...parsed.rest].join('\n'))
      notify(
        'success',
        `${pluralize(stopps.length, 'Stopp', 'Stopps')} in der Tour${geschaetzt ? ' (Fahrzeiten geschaetzt)' : ''}.`,
      )
      setReport({
        created: erzeugt,
        reused: wiederverwendet,
        missing: fehlend.length,
        lines: [...fehlend, ...zuPruefen],
        note: geschaetzt ? 'Der Routing-Dienst hat nicht geantwortet - Reihenfolge nach Luftlinie.' : null,
      })
    } catch (e) {
      setReport({
        created: aufgeloest.filter((l) => l.locationId !== null).length,
        reused: 0,
        missing: 0,
        lines: [],
        note: `${describeError(e)}${
          routeIdRef.current ? ' Die begonnene Tour bleibt bestehen - ein weiterer Versuch haengt daran an.' : ''
        }`,
      })
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  const prozent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const anzahl = parsed.lines.length + (mitStart ? 1 : 0)
  const knopfText = anhaengen
    ? `${pluralize(parsed.lines.length, 'Adresse', 'Adressen')} hinzufuegen`
    : `Tour aus ${pluralize(anzahl, 'Adresse', 'Adressen')} erstellen`

  return (
    <div className="sidebar-head" style={{ paddingBottom: 10 }}>
      <div className="panel panel-pad">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <strong className="small">{anhaengen ? 'Adressen zu dieser Tour' : 'Tour aus Adressen'}</strong>
          {parsed.lines.length > 0 && !running && (
            <span className="small faint">{pluralize(parsed.lines.length, 'Zeile', 'Zeilen')}</span>
          )}
        </div>

        {!anhaengen && (
          <div
            className="addr-search"
            ref={startRef}
            style={{ flex: 'none', maxWidth: 'none', marginBottom: 6 }}
          >
            <input
              className="input"
              value={startText}
              disabled={running}
              role="combobox"
              aria-label="Startadresse, optional"
              aria-expanded={startOffen && startVorschlaege.length > 0}
              aria-haspopup="listbox"
              aria-autocomplete="list"
              placeholder="Start (optional) — Standort waehlen oder Adresse tippen"
              onFocus={() => setStartOffen(true)}
              onChange={(e) => {
                setStartText(e.target.value)
                // Getippt heisst: nicht mehr der gewaehlte Standort.
                setStartLocationId(null)
                setStartOffen(true)
                setStartAktiv(-1)
              }}
              onKeyDown={(e) => {
                if (startVorschlaege.length === 0) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setStartOffen(true)
                  setStartAktiv((i) => (i + 1) % startVorschlaege.length)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setStartAktiv((i) => (i <= 0 ? startVorschlaege.length - 1 : i - 1))
                } else if (e.key === 'Enter' && startAktiv >= 0) {
                  e.preventDefault()
                  waehleStart(startVorschlaege[startAktiv])
                } else if (e.key === 'Escape') {
                  setStartOffen(false)
                  setStartAktiv(-1)
                }
              }}
            />
            {startLocationId !== null && (
              <div className="field-hint" style={{ marginTop: 4 }}>
                Gespeicherter Standort — wird nicht neu gesucht.
              </div>
            )}
            {startOffen && startVorschlaege.length > 0 && (
              <div className="addr-pop">
                <div className="addr-section">
                  <span className="addr-section-title">
                    {parsed.lines.length > 0
                      ? 'Standort waehlen — die Tour wird sofort gebaut'
                      : 'Gespeicherte Standorte'}
                  </span>
                </div>
                <div className="addr-pop-scroll" role="listbox" aria-label="Gespeicherte Standorte">
                  {startVorschlaege.map((ort, i) => (
                    <button
                      key={ort.id}
                      type="button"
                      role="option"
                      aria-selected={i === startAktiv}
                      tabIndex={-1}
                      className={ADDR_HIT_CLASS(i === startAktiv)}
                      // Ohne dies nimmt der Klick dem Feld den Fokus, noch bevor
                      // die Auswahl ankommt.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => waehleStart(ort)}
                    >
                      <span aria-hidden="true">📍</span>
                      <span className="addr-hit-main" style={{ display: 'flex', flexDirection: 'column' }}>
                        <span className="addr-hit-title truncate">{ort.name}</span>
                        {ort.address && <span className="addr-hit-sub truncate">{ort.address}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <textarea
          className="textarea"
          rows={4}
          value={text}
          disabled={running}
          aria-label="Adressen, eine je Zeile"
          placeholder={'Adressen einfuegen — eine je Zeile\nBahnhofstr. 5, 29336 Nienhagen\nDorfstr. 1, 12345 Musterdorf'}
          onChange={(e) => {
            setText(e.target.value)
            setReport(null)
          }}
        />

        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <Button
            variant="primary"
            block
            busy={running}
            disabled={parsed.lines.length === 0 && !mitStart}
            onClick={() => void run()}
          >
            {running ? 'Adressen werden gesucht …' : knopfText}
          </Button>
          {running && (
            <Button size="sm" onClick={() => abortRef.current?.abort()}>
              Abbrechen
            </Button>
          )}
        </div>

        {parsed.rest.length > 0 && !running && (
          <div className="field-hint" style={{ marginTop: 6 }}>
            Hoechstens {MAX_ADDRESSES} Zeilen je Lauf. Die uebrigen {parsed.rest.length} bleiben danach
            stehen.
          </div>
        )}

        {running && (
          <div style={{ marginTop: 8 }}>
            <div className="row-between small muted" style={{ marginBottom: 4 }}>
              <span>
                Adresse {Math.min(progress.done + 1, progress.total)} von {progress.total}
              </span>
              <span>{prozent} %</span>
            </div>
            <div
              style={{ height: 6, borderRadius: 999, background: 'var(--bg-subtle)', overflow: 'hidden' }}
              role="progressbar"
              aria-label="Fortschritt der Adresssuche"
              aria-valuenow={prozent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div style={{ width: `${prozent}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
          </div>
        )}

        {report && !running && (
          <div style={{ marginTop: 10 }}>
            <div className="small muted" style={{ marginBottom: report.lines.length > 0 ? 6 : 0 }}>
              {report.created} angelegt · {report.reused} wiederverwendet · {report.missing} nicht gefunden
              {report.note ? ` · ${report.note}` : ''}
            </div>
            {report.lines.length > 0 && (
              <ul className="small scroll-y" style={{ maxHeight: 130, margin: 0, paddingLeft: 18 }}>
                {report.lines.slice(0, MAX_SHOWN_LINES).map((line, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <span className="mono">{line.raw}</span>{' '}
                    <Badge tone={line.kind === 'missing' ? 'danger' : 'warning'}>
                      {line.kind === 'missing' ? 'nicht gefunden' : 'pruefen'}
                    </Badge>
                    {line.hint && <div className="faint">{line.hint}</div>}
                  </li>
                ))}
                {report.lines.length > MAX_SHOWN_LINES && (
                  <li className="faint">… und {report.lines.length - MAX_SHOWN_LINES} weitere</li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
