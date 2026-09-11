/**
 * Das Ziel einer Strecke waehlen.
 *
 * Die Umgebungsliste beantwortet "was ist in der Naehe?" und zeigt deshalb
 * nur die naechsten acht. Hier geht es um die andere Frage: "ich will zu
 * DIESEM Ort" - und der kann 400 km weit weg sein. Gesucht wird deshalb im
 * ganzen Bestand, nicht im Umkreis.
 *
 * Gespeicherte Standorte stehen oben, weil sie das sind, was die Anwenderin
 * fast immer meint. Eine freie Adresse geht trotzdem: wer zu einem Ort will,
 * den es noch nicht gibt, soll deswegen nicht erst einen Standort anlegen
 * muessen - das war ausdruecklich unerwuenscht.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, EmptyState, GroupStripe, Spinner } from '@/components/ui'
import { createAddressSearch, type AddressMatch, type DebouncedAddressSearch } from '@/lib/geocode'
import { formatDistance } from '@/lib/format'
import { haversineKm } from '@/lib/geo'
import { useLocationColors, useStore } from '@/lib/store'
import { symbolEmoji } from '@/lib/symbols'
import type { LatLng, MapLocation } from '@/types/domain'

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
}: {
  origin: LatLng
  onPick: (ziel: Ziel) => void
  onCancel: () => void
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

  /**
   * Gespeicherte Standorte, nach Entfernung zum Start sortiert. Ohne
   * Eingabe sind das schlicht die naechstgelegenen - so ist die Liste auch
   * beim Oeffnen schon nuetzlich und nicht leer.
   */
  const eigene = useMemo(() => {
    const passend = locations
      .filter((l) => l.is_active)
      .filter((l) =>
        gesucht === ''
          ? true
          : `${l.name} ${l.address ?? ''} ${l.tags.join(' ')}`.toLowerCase().includes(gesucht),
      )
      .map((l) => ({ location: l, km: haversineKm(origin, { lat: l.lat, lng: l.lng }) }))
    passend.sort((a, b) => a.km - b.km)
    return passend.slice(0, TREFFER_GRENZE)
  }, [locations, gesucht, origin])

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
      <div className="addr-section row-between">
        <span className="addr-section-title">Route zu …</span>
        <button type="button" className="linkish small" onClick={onCancel}>
          Zurueck
        </button>
      </div>

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
          {eigene.map(({ location, km }) => (
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
                  {formatDistance(km * 1000)} Luftlinie
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

      <div style={{ padding: '4px 9px 8px' }}>
        <Button size="sm" variant="ghost" block onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </div>
  )
}
