/**
 * Das Ziel einer Strecke waehlen.
 *
 * Die Umgebungsliste beantwortet "was ist in der Naehe?" und zeigt deshalb
 * nur die naechsten acht. Hier geht es um die andere Frage: "ich will zu
 * DIESEM Ort" - und der kann 400 km weit weg sein. Gesucht wird deshalb im
 * ganzen Bestand, nicht im Umkreis.
 *
 * Gespeicherte Standorte stehen oben, weil sie das sind, was die Anwenderin
 * fast immer meint. Sie sind nach FAHRZEIT sortiert und zeigen die
 * Fahrstrecke - die Luftlinie lag nachgemessen im Mittel ein Drittel darunter
 * und taugt nur, solange der Routendienst nicht geantwortet hat. Eine freie Adresse geht trotzdem: wer zu einem Ort will,
 * den es noch nicht gibt, soll deswegen nicht erst einen Standort anlegen
 * muessen - das war ausdruecklich unerwuenscht.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, EmptyState, GroupStripe, Spinner } from '@/components/ui'
import { createAddressSearch, type AddressMatch, type DebouncedAddressSearch } from '@/lib/geocode'
import { formatDistance, formatDuration } from '@/lib/format'
import { haversineKm } from '@/lib/geo'
import { ROAD_CANDIDATES, rankByTravel } from '@/lib/nearby'
import { useLocationColors, useStore } from '@/lib/store'
import { symbolEmoji } from '@/lib/symbols'
import type { LatLng, MapLocation } from '@/types/domain'
import { useTravelFrom } from './useTravelFrom'

/** Genug zum Auswaehlen, wenig genug zum Ueberblicken. */
const TREFFER_GRENZE = 8
const DEBOUNCE_MS = 300
/** Ab hier lohnt die Adressabfrage; darunter trifft sie fast alles. */
const MIN_ADRESSE = 3

export interface Ziel {
  point: LatLng
  label: string
  locationId: string | null
}

export default function RouteTargetPicker({
  origin,
  onPick,
  onCancel,
  embedded = false,
  excludeId = null,
}: {
  origin: LatLng
  onPick: (ziel: Ziel) => void
  onCancel: () => void
  /** Der Standort, an dem die Strecke beginnt - er taugt nicht als Ziel. */
  excludeId?: string | null
  /**
   * In einem Dialog gezeichnet. Dann traegt dessen Kopfzeile bereits Titel
   * und Schliessen - eine eigene Ueberschrift und ein zweiter Abbrechen-Knopf
   * waeren die dritte und vierte Moeglichkeit, dasselbe zu tun.
   */
  embedded?: boolean
}) {
  const locations = useStore((s) => s.locations)
  const colorsOf = useLocationColors()
  const [text, setText] = useState('')
  const [adressen, setAdressen] = useState<AddressMatch[]>([])
  const [sucht, setSucht] = useState(false)

  const feldRef = useRef<HTMLInputElement>(null)
  const sucheRef = useRef<DebouncedAddressSearch | null>(null)
  if (sucheRef.current === null) sucheRef.current = createAddressSearch(DEBOUNCE_MS)
  const suche = sucheRef.current

  useEffect(() => {
    feldRef.current?.focus()
    return () => suche.cancel()
  }, [suche])

  const gesucht = text.trim().toLowerCase()

  /** Alle waehlbaren Standorte mit ihrer Luftlinie, naechste zuerst. */
  const waehlbar = useMemo(() => {
    const liste = locations
      .filter((l) => l.is_active && l.id !== excludeId)
      .map((l) => ({ location: l, airKm: haversineKm(origin, { lat: l.lat, lng: l.lng }) }))
    liste.sort((a, b) => a.airKm - b.airKm)
    return liste
  }, [locations, origin, excludeId])

  /**
   * Die Fahrzeit wird fuer die naechsten ROAD_CANDIDATES gerechnet, und zwar
   * UNABHAENGIG von der Eingabe: so kostet das Oeffnen eine Anfrage und nicht
   * jeder Tastendruck eine. Wer gezielt einen weit entfernten Standort sucht,
   * bekommt fuer ihn die Luftlinie - als solche benannt.
   */
  const targets = useMemo(
    () =>
      waehlbar
        .slice(0, ROAD_CANDIDATES)
        .map(({ location: l }) => ({ id: l.id, lat: l.lat, lng: l.lng })),
    [waehlbar],
  )
  const { travel } = useTravelFrom(origin, targets)
  const fahrt = useMemo(() => {
    const map = new Map<string, { sec: number | null; meters: number | null }>()
    if (!travel) return map
    targets.forEach((t, i) => {
      const sec = travel.durations[i]
      const meters = travel.distances[i]
      map.set(t.id, {
        sec: Number.isFinite(sec) && sec >= 0 ? sec : null,
        meters: Number.isFinite(meters) && meters >= 0 ? meters : null,
      })
    })
    return map
  }, [travel, targets])

  /**
   * Gespeicherte Standorte, nach Fahrzeit zum Start sortiert. Ohne Eingabe
   * sind das schlicht die am schnellsten erreichbaren - so ist die Liste auch
   * beim Oeffnen schon nuetzlich und nicht leer.
   */
  const eigene = useMemo(() => {
    const passend = waehlbar
      .filter(({ location: l }) =>
        gesucht === ''
          ? true
          : `${l.name} ${l.address ?? ''} ${l.tags.join(' ')}`.toLowerCase().includes(gesucht),
      )
      .map((e) => ({
        ...e,
        travelSec: fahrt.get(e.location.id)?.sec ?? null,
        travelMeters: fahrt.get(e.location.id)?.meters ?? null,
      }))
    return rankByTravel(passend, TREFFER_GRENZE)
  }, [waehlbar, gesucht, fahrt])

  function tippen(wert: string): void {
    setText(wert)
    const next = wert.trim()
    if (next.length < MIN_ADRESSE) {
      suche.cancel()
      setAdressen([])
      setSucht(false)
      return
    }
    setSucht(true)
    suche(
      next,
      (ergebnis) => {
        setAdressen(ergebnis.matches.slice(0, 4))
        setSucht(false)
      },
      { mode: 'quick' },
    )
  }

  function waehleStandort(l: MapLocation): void {
    onPick({ point: { lat: l.lat, lng: l.lng }, label: l.name, locationId: l.id })
  }

  return (
    <div className="col" style={{ gap: 0 }}>
      {!embedded && (
        <div className="addr-section row-between">
          <span className="addr-section-title">Route zu …</span>
          <button type="button" className="linkish small" onClick={onCancel}>
            Zurück
          </button>
        </div>
      )}

      <div style={{ padding: '6px 9px' }}>
        <input
          ref={feldRef}
          className="input"
          type="text"
          value={text}
          placeholder="Ziel: gespeicherter Standort oder Adresse …"
          aria-label="Ziel der Route"
          autoComplete="off"
          onChange={(e) => tippen(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
      </div>

      {eigene.length > 0 && (
        <>
          <div className="addr-section">
            <span className="addr-section-title">Gespeicherte Standorte</span>
          </div>
          {eigene.map(({ location, airKm, travelSec, travelMeters }) => (
            <button
              key={location.id}
              type="button"
              className="addr-hit"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => waehleStandort(location)}
            >
              <span className="row" style={{ gap: 4, flex: '0 0 auto' }} aria-hidden="true">
                <span>{symbolEmoji(location.icon)}</span>
                <GroupStripe colors={colorsOf(location)} />
              </span>
              <span className="addr-hit-main">
                <span className="addr-hit-title truncate">{location.name}</span>
                <span className="addr-hit-sub truncate">
                  {travelMeters !== null
                    ? `${formatDistance(travelMeters)}${
                        travelSec !== null ? ` · ${formatDuration(travelSec)}` : ''
                      }`
                    : `${formatDistance(airKm * 1000)} Luftlinie`}
                  {location.address ? ` · ${location.address}` : ''}
                </span>
              </span>
            </button>
          ))}
        </>
      )}

      {gesucht.length >= MIN_ADRESSE && (
        <>
          <div className="addr-section">
            <span className="addr-section-title">Adressen</span>
          </div>
          {sucht && (
            <div className="row" style={{ padding: '8px 11px' }}>
              <Spinner />
              <span className="small muted">Adressen werden gesucht …</span>
            </div>
          )}
          {!sucht &&
            adressen.map((hit, i) => (
              <button
                key={`${hit.lat},${hit.lng},${i}`}
                type="button"
                className="addr-hit"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  onPick({ point: { lat: hit.lat, lng: hit.lng }, label: hit.label, locationId: null })
                }
              >
                <span aria-hidden="true">📍</span>
                <span className="addr-hit-main">
                  <span className="addr-hit-title truncate">{hit.label}</span>
                  <span className="addr-hit-sub truncate">
                    {formatDistance(haversineKm(origin, { lat: hit.lat, lng: hit.lng }) * 1000)} Luftlinie
                  </span>
                </span>
              </button>
            ))}
          {!sucht && adressen.length === 0 && (
            <div className="small faint" style={{ padding: '6px 11px 10px' }}>
              Keine Adresse zu dieser Eingabe gefunden.
            </div>
          )}
        </>
      )}

      {eigene.length === 0 && gesucht.length < MIN_ADRESSE && (
        <EmptyState>
          {locations.length === 0
            ? 'Noch keine Standorte gespeichert. Tippe eine Adresse ein.'
            : 'Kein gespeicherter Standort passt. Tippe weiter für eine Adresse.'}
        </EmptyState>
      )}

      {!embedded && (
        <div style={{ padding: '4px 9px 8px' }}>
          <Button size="sm" variant="ghost" block onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
      )}
    </div>
  )
}
