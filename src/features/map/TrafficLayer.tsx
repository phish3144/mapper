/**
 * Sperrungen und Baustellen der Autobahnen ueber der Karte.
 *
 * Zwei Dinge bestimmen den Aufbau:
 *
 * 1. Der Stand ist gross - rund 3.800 Meldungen, davon 600 mit Linie und
 *    zusammen ueber 17.000 Stuetzpunkten. Gezeichnet wird deshalb nur, was im
 *    Ausschnitt liegt, und zwar auf eine Leinwand statt in SVG: 600 einzelne
 *    <path>-Elemente machen das Verschieben der Karte spuerbar zaeh.
 * 2. Baustellen sind bundesweit ein Nebel aus 3.200 Punkten. Sie erscheinen
 *    deshalb erst ab einer Zoomstufe, auf der man sie auch zuordnen kann;
 *    Sperrungen sind immer zu sehen, denn genau die sucht man.
 *
 * Die Daten werden ERST GEHOLT, wenn die Ebene eingeschaltet wird.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, Polyline, Popup, useMap } from 'react-leaflet'
import { useStore } from '@/lib/store'
import { describeError } from '@/lib/supabase'
import {
  bereich,
  gemerkterStand,
  ladeVerkehr,
  linie,
  zeitraumText,
  type Verkehrsmeldung,
  type Verkehrsstand,
} from '@/lib/traffic'

/** Rot fuer "hier geht es nicht durch", Bernstein fuer "hier stockt es". */
const SPERRUNG_FARBE = '#d92d20'
const BAUSTELLE_FARBE = '#e8820c'

/**
 * Ab hier werden auch Baustellen gezeigt.
 *
 * Nachgemessen und nicht geschaetzt: ueber dem Ruhrgebiet liegen auf Stufe 9
 * 793 Baustellen im Ausschnitt und uebermalen die Sperrungen, auf Stufe 10
 * sind es 541 auf der vierfachen Flaeche - da zeichnen sie die Autobahnen
 * nach, statt sie zuzudecken.
 */
export const BAUSTELLEN_AB_ZOOM = 10

/**
 * Die Namensnennung ist Bedingung der Datenlizenz Deutschland 2.0 und haengt
 * an der Karte, nicht an der Kachelquelle.
 */
const VERKEHR_ATTR =
  'Verkehr: <a href="https://autobahn.api.bund.de/" target="_blank" rel="noreferrer">Autobahn GmbH des Bundes</a> (dl-de/by-2-0)'

const SPERRUNG_STIL: L.PathOptions = { color: SPERRUNG_FARBE, weight: 5, opacity: 0.9, lineCap: 'round' }
const SPERRUNG_PUNKT_STIL: L.PathOptions = {
  color: '#fff',
  weight: 2,
  fillColor: SPERRUNG_FARBE,
  fillOpacity: 0.95,
}
const BAUSTELLE_STIL: L.PathOptions = {
  color: '#fff',
  weight: 1,
  fillColor: BAUSTELLE_FARBE,
  fillOpacity: 0.9,
}
/** Kleiner als die Sperrungen: sie sind Beiwerk und sollen es auch aussehen. */
const BAUSTELLE_RADIUS = 4

export interface Verkehrsergebnis {
  stand: Verkehrsstand | null
  laedt: boolean
}

/**
 * Holt den Stand, solange die Ebene an ist.
 *
 * Sitzt hier und nicht in der Ebene selbst, weil auch die Bedienleiste ihn
 * braucht - sie zeigt an, wie alt er ist. Eine zweite Stelle, die faellt,
 * waere eine zweite Wahrheit.
 */
export function useVerkehr(on: boolean): Verkehrsergebnis {
  const notify = useStore((s) => s.notify)
  const [stand, setStand] = useState<Verkehrsstand | null>(gemerkterStand)
  const [laedt, setLaedt] = useState(false)

  useEffect(() => {
    if (!on) return
    let abgemeldet = false
    setLaedt(true)
    void ladeVerkehr().then(
      (d) => {
        if (abgemeldet) return
        setStand(d)
        setLaedt(false)
      },
      (fehler: unknown) => {
        // Verkehrsmeldungen sind Beiwerk: faellt der Abruf aus, bleibt die
        // Karte benutzbar. Gesagt werden muss es trotzdem, sonst schaltet man
        // eine Ebene ein, die stumm nichts tut.
        if (abgemeldet) return
        setLaedt(false)
        notify('error', `Verkehrsmeldungen: ${describeError(fehler)}`)
      },
    )
    return () => {
      abgemeldet = true
    }
  }, [on, notify])

  return { stand: on ? stand : null, laedt }
}

/** Eine Meldung samt allem, was sich einmal je Stand ausrechnen laesst. */
interface Vorbereitet {
  id: string
  m: Verkehrsmeldung
  /** Umfassungsrahmen [sued, west, nord, ost] - fuer den Zuschnitt. */
  box: [number, number, number, number]
  /** Die Linie als Leaflet-Paare, oder leer. */
  pts: [number, number][]
  /** Der Meldepunkt. Vorab gebaut, damit die Kennung stabil bleibt: sonst
   *  setzte react-leaflet bei jedem Zeichnen hundertfach dieselbe Lage neu. */
  mitte: [number, number]
}

interface Ausschnitt {
  sued: number
  west: number
  nord: number
  ost: number
  zoom: number
}

export default function TrafficLayer({ stand }: { stand: Verkehrsstand | null }) {
  const map = useMap()

  /**
   * Eine Leinwand statt SVG. Sie gehoert dieser Ebene allein und wird mit ihr
   * wieder abgeraeumt; `padding` zeichnet etwas ueber den Rand hinaus, damit
   * beim Verschieben nicht sichtbar nachgemalt wird.
   */
  const leinwand = useMemo(() => L.canvas({ padding: 0.3 }), [])

  const [sicht, setSicht] = useState<Ausschnitt | null>(null)

  useEffect(() => {
    const merken = () => {
      const b = map.getBounds()
      setSicht({
        sued: b.getSouth(),
        west: b.getWest(),
        nord: b.getNorth(),
        ost: b.getEast(),
        zoom: map.getZoom(),
      })
    }
    merken()
    map.on('moveend zoomend', merken)
    return () => {
      map.off('moveend zoomend', merken)
    }
  }, [map])

  useEffect(() => {
    map.attributionControl?.addAttribution(VERKEHR_ATTR)
    return () => {
      map.attributionControl?.removeAttribution(VERKEHR_ATTR)
    }
  }, [map])

  // Einmal je Stand: Rahmen und Linien ausrechnen. Beim Verschieben der Karte
  // bleibt dann nur noch der Vergleich von vier Zahlen je Meldung.
  const alle = useMemo<Vorbereitet[]>(
    () =>
      (stand?.items ?? []).map((m, i) => ({
        id: `${m.k}${i}`,
        m,
        box: bereich(m),
        pts: linie(m.g),
        mitte: [m.lat, m.lng],
      })),
    [stand],
  )

  const { sperrungen, baustellen } = useMemo(() => {
    const sperrungen: Vorbereitet[] = []
    const baustellen: Vorbereitet[] = []
    if (!sicht) return { sperrungen, baustellen }
    const mitBaustellen = sicht.zoom >= BAUSTELLEN_AB_ZOOM
    for (const v of alle) {
      if (v.m.k === 'b' && !mitBaustellen) continue
      const [sued, west, nord, ost] = v.box
      if (nord < sicht.sued || sued > sicht.nord || ost < sicht.west || west > sicht.ost) continue
      ;(v.m.k === 'c' ? sperrungen : baustellen).push(v)
    }
    return { sperrungen, baustellen }
  }, [alle, sicht])

  // Gemessen an der Quelle ist der Mittelwert eines gesperrten Abschnitts
  // 400 m lang - bei Zoomstufe 8 sind das vier Pixel. Die Linie allein wuerde
  // die Sperrung also verschweigen. Deshalb steht IMMER ein Punkt da, und die
  // Linie kommt dazu, sobald es etwas zu sehen gibt.
  const punktRadius = sicht && sicht.zoom >= BAUSTELLEN_AB_ZOOM ? 7 : 4

  return (
    <>
      {sperrungen.map((v) => (
        <Fragment key={v.id}>
          {v.pts.length > 1 && (
            <Polyline positions={v.pts} renderer={leinwand} pathOptions={SPERRUNG_STIL}>
              <Popup>
                <MeldungsBlase m={v.m} />
              </Popup>
            </Polyline>
          )}
          <CircleMarker
            center={v.mitte}
            radius={punktRadius}
            renderer={leinwand}
            pathOptions={SPERRUNG_PUNKT_STIL}
          >
            <Popup>
              <MeldungsBlase m={v.m} />
            </Popup>
          </CircleMarker>
        </Fragment>
      ))}

      {baustellen.map((v) => (
        <CircleMarker
          key={v.id}
          center={v.mitte}
          radius={BAUSTELLE_RADIUS}
          renderer={leinwand}
          pathOptions={BAUSTELLE_STIL}
        >
          <Popup>
            <MeldungsBlase m={v.m} />
          </Popup>
        </CircleMarker>
      ))}
    </>
  )
}

function MeldungsBlase({ m }: { m: Verkehrsmeldung }) {
  const zeit = zeitraumText(m.z)
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <span className={m.k === 'c' ? 'verkehr-marke ist-sperrung' : 'verkehr-marke ist-baustelle'}>
          {m.k === 'c' ? 'Sperrung' : 'Baustelle'}
        </span>
        <strong>{m.r}</strong>
      </div>
      {m.t && <div>{m.t}</div>}
      {m.s && <div className="small muted">{m.s}</div>}
      {zeit && <div className="small muted">{zeit}</div>}
    </div>
  )
}
