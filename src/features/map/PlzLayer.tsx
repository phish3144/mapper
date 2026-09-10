/**
 * Die zweistelligen PLZ-Leitregionen als Umriss ueber der Karte.
 *
 * Bewusst nur die 95 Leitregionen (01 … 99) und nicht die rund 8.200
 * fuenfstelligen Gebiete: fuer die Frage "welches Gebiet deckt welches Team
 * ab?" ist die grobe Ebene die richtige, und die feine waere roh ueber 100 MB.
 *
 * Der Datensatz wird ERST GELADEN, wenn die Ebene eingeschaltet wird, und
 * danach im Modul behalten. Wer die Regionen nie einschaltet, zahlt nichts;
 * wer sie zweimal einschaltet, laedt einmal.
 */
import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { GeoJSON, Marker } from 'react-leaflet'

/** Liegt in public/ und wird deshalb ueber den Basispfad angesprochen. */
const QUELLE = `${import.meta.env.BASE_URL}plz2.geojson`

/**
 * Nur so viel Struktur, wie hier gebraucht wird - ein Typpaket fuer GeoJSON
 * waere fuer zwei Felder zu viel Abhaengigkeit.
 */
interface PlzFeature {
  type: 'Feature'
  /** Die Geometrie reicht Leaflet unveraendert durch. */
  geometry: unknown
  properties: {
    plz: string
    /** Wo die Nummer stehen soll: [lon, lat], beim Bauen ausgerechnet. */
    c: [number, number]
  }
}

interface PlzCollection {
  type: 'FeatureCollection'
  features: PlzFeature[]
}

/**
 * Einmal geladen, bleibt geladen. Ein Modulwert und kein Zustand, damit das
 * Aus- und Wiedereinschalten der Ebene keinen zweiten Abruf ausloest.
 */
let gemerkt: PlzCollection | null = null
let laeuft: Promise<PlzCollection> | null = null

async function ladeRegionen(): Promise<PlzCollection> {
  if (gemerkt) return gemerkt
  // Auch die laufende Anfrage merken: zwei schnelle Klicks sollen nicht zwei
  // Abrufe ergeben.
  laeuft ??= fetch(QUELLE)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<PlzCollection>
    })
    .then((daten) => {
      gemerkt = daten
      return daten
    })
    .finally(() => {
      laeuft = null
    })
  return laeuft
}

/** Nur fuer Tests: den Modulspeicher leeren. */
export function resetPlzCache(): void {
  gemerkt = null
  laeuft = null
}

/** Dieselbe gedeckte Farbe in beiden Themen - sie soll die Karte nicht uebertoenen. */
const PLZ_COLOR = '#7c5cbf'

const PLZ_ATTR =
  'PLZ-Regionen: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> (ODbL)'

const iconSpeicher = new Map<string, L.DivIcon>()

/**
 * Die Nummer der Region als Kartenzeichen.
 *
 * Zwischengespeichert wie die Standortnadeln: ein je Rendern neu gebautes
 * Icon liesse Leaflet 95-mal das DOM austauschen.
 */
function plzIcon(plz: string): L.DivIcon {
  const vorhanden = iconSpeicher.get(plz)
  if (vorhanden) return vorhanden
  const icon = L.divIcon({
    html: `<span class="plz-label">${plz}</span>`,
    className: '',
    iconSize: [30, 18],
    iconAnchor: [15, 9],
  })
  iconSpeicher.set(plz, icon)
  return icon
}

export default function PlzLayer({ onError }: { onError?: (message: string) => void }) {
  const [daten, setDaten] = useState<PlzCollection | null>(gemerkt)

  const beschriftungen = useMemo<[string, [number, number]][]>(
    () =>
      (daten?.features ?? []).map((f) => [
        f.properties.plz,
        // GeoJSON zaehlt [lon, lat], Leaflet [lat, lon].
        [f.properties.c[1], f.properties.c[0]],
      ]),
    [daten],
  )

  useEffect(() => {
    if (daten) return
    let abgemeldet = false
    void ladeRegionen().then(
      (d) => {
        if (!abgemeldet) setDaten(d)
      },
      () => {
        // Die Regionen sind Beiwerk: faellt der Abruf aus, bleibt die Karte
        // benutzbar. Gesagt werden muss es trotzdem, sonst schaltet die
        // Anwenderin eine Ebene ein, die stumm nichts tut.
        if (!abgemeldet) onError?.('Die PLZ-Regionen konnten nicht geladen werden.')
      },
    )
    return () => {
      abgemeldet = true
    }
  }, [daten, onError])

  if (!daten) return null

  return (
    <>
      <GeoJSON
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={daten as any}
        // Der Datensatz stammt aus OpenStreetMap und steht unter ODbL. Die
        // Nennung haengt an der Ebene und nicht an der Kachelquelle: ueber
        // "Satellit" liegen Esri-Kacheln, die OSM gar nicht nennen.
        attribution={PLZ_ATTR}
        // Kein Fuellton: die Umrisse liegen ueber den Standorten, und eine
        // gefuellte Flaeche wuerde Nadeln und Tourenlinie eintrueben. Der
        // Umriss allein beantwortet die Frage.
        style={{ color: PLZ_COLOR, weight: 1.5, opacity: 0.7, fill: false }}
        // Ohne dies schluckt die Ebene Klicks auf die Standorte darunter.
        interactive={false}
      />
      {beschriftungen.map(([plz, punkt]) => (
        <Marker
          key={plz}
          position={punkt}
          icon={plzIcon(plz)}
          interactive={false}
          // Unter den Standortnadeln (0/500) und der Route (1000): die
          // Regionsnummer ist Hintergrundwissen, kein Bedienelement.
          zIndexOffset={-1000}
        />
      ))}
    </>
  )
}
