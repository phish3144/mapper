/**
 * Die Strecke zwischen zwei Punkten - einmal geholt, zweimal benutzt.
 *
 * Die gezeichnete Linie und die Ergebnisleiste brauchen dasselbe Ergebnis.
 * Ohne gemeinsamen Speicher fragten beide denselben Routing-Dienst, und bei
 * dessen Drosselung gewaenne mal der eine, mal der andere - die Leiste zeigte
 * dann eine andere Entfernung als die Linie.
 */
import { useEffect, useState } from 'react'
import { getRouteProvider } from '@/lib/routing'
import { haversineKm } from '@/lib/geo'
import type { LatLng } from '@/types/domain'

export interface RouteLeg {
  geometry: LatLng[]
  meters: number
  seconds: number
  /** true, solange nur die Luftlinie vorliegt - kein Dienst hat geantwortet. */
  estimated: boolean
}

const schluessel = (from: LatLng, to: LatLng): string =>
  `${from.lat.toFixed(5)},${from.lng.toFixed(5)}|${to.lat.toFixed(5)},${to.lng.toFixed(5)}`

/** Fertige Strecken. Klein gehalten: es geht um die zuletzt gezeigte, nicht um ein Archiv. */
const speicher = new Map<string, RouteLeg>()
const laufend = new Map<string, Promise<RouteLeg>>()
const MAX_EINTRAEGE = 30

/** Luftlinie als Sofortantwort, damit ein Klick nicht auf das Netz wartet. */
function luftlinie(from: LatLng, to: LatLng): RouteLeg {
  return { geometry: [from, to], meters: haversineKm(from, to) * 1000, seconds: 0, estimated: true }
}

async function hole(from: LatLng, to: LatLng, key: string): Promise<RouteLeg> {
  try {
    const result = await getRouteProvider().route([from, to], 'driving')
    const leg: RouteLeg = {
      geometry: result.geometry.length > 1 ? result.geometry : [from, to],
      meters: result.distanceM,
      seconds: result.durationSec,
      estimated: false,
    }
    if (speicher.size >= MAX_EINTRAEGE) speicher.delete(speicher.keys().next().value as string)
    speicher.set(key, leg)
    return leg
  } catch {
    // Ohne Dienst bleibt die Luftlinie. Bewusst NICHT merken: beim naechsten
    // Mal soll es wieder versucht werden.
    return luftlinie(from, to)
  } finally {
    laufend.delete(key)
  }
}

/** Nur fuer Tests. */
export function resetRouteLegCache(): void {
  speicher.clear()
  laufend.clear()
}

export function useRouteLeg(from: LatLng | null, to: LatLng | null): RouteLeg | null {
  const key = from && to ? schluessel(from, to) : ''
  const [leg, setLeg] = useState<RouteLeg | null>(() => (key ? (speicher.get(key) ?? null) : null))

  useEffect(() => {
    if (!from || !to || key === '') {
      setLeg(null)
      return
    }
    const fertig = speicher.get(key)
    if (fertig) {
      setLeg(fertig)
      return
    }
    let abgemeldet = false
    setLeg(luftlinie(from, to))
    // Zwei Aufrufer, eine Anfrage: der zweite haengt sich an die laufende an.
    const versprechen = laufend.get(key) ?? hole(from, to, key)
    laufend.set(key, versprechen)
    void versprechen.then((l) => {
      if (!abgemeldet) setLeg(l)
    })
    return () => {
      abgemeldet = true
    }
    // from/to stecken vollstaendig im Schluessel; auf die Objekte zu hoeren
    // hiesse, bei jedem Rendern neu zu laden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return leg
}
