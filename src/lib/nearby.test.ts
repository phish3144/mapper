import { describe, expect, it } from 'vitest'
import type { LatLng, MapLocation } from '@/types/domain'
import {
  bearingDegrees,
  compassPoint,
  directionLabel,
  nearestLocations,
  withTravel,
} from './nearby'
import type { CompassPoint, NearbyEntry } from './nearby'

const BERLIN: LatLng = { lat: 52.52, lng: 13.405 }

/** Ein Breitengrad sind rund 111,19 km - die Erwartungen unten rechnen damit. */
const KM_PER_DEGREE_LAT = 111.19

function makeLocation(id: string, partial: Partial<MapLocation> = {}): MapLocation {
  return {
    id,
    workspace_id: 'ws-1',
    category_id: null,
    name: id,
    icon: null,
    lat: BERLIN.lat,
    lng: BERLIN.lng,
    address: null,
    notes: null,
    service_minutes: 0,
    time_windows: [],
    tags: [],
    is_active: true,
    visibility: 'workspace',
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

/** Standort in noerdlicher Verschiebung; deltaLat in Grad. */
function northOf(id: string, deltaLat: number, partial: Partial<MapLocation> = {}): MapLocation {
  return makeLocation(id, { lat: BERLIN.lat + deltaLat, ...partial })
}

const ids = (entries: NearbyEntry[]): string[] => entries.map((e) => e.location.id)

/** Winkelabstand ueber die 360-Grad-Naht hinweg. */
function angleDiff(actual: number, expected: number): number {
  const raw = Math.abs(((actual - expected) % 360) + 360) % 360
  return raw > 180 ? 360 - raw : raw
}

function expectBearing(actual: number, expected: number, tolerance = 1): void {
  expect(Number.isFinite(actual)).toBe(true)
  expect(angleDiff(actual, expected)).toBeLessThanOrEqual(tolerance)
}

describe('bearingDegrees - Himmelsrichtungen', () => {
  it('zeigt nach Norden', () => {
    expectBearing(bearingDegrees(BERLIN, { lat: BERLIN.lat + 1, lng: BERLIN.lng }), 0)
  })

  it('zeigt nach Osten', () => {
    expectBearing(bearingDegrees(BERLIN, { lat: BERLIN.lat, lng: BERLIN.lng + 1 }), 90)
  })

  it('zeigt nach Sueden', () => {
    expectBearing(bearingDegrees(BERLIN, { lat: BERLIN.lat - 1, lng: BERLIN.lng }), 180)
  })

  it('zeigt nach Westen', () => {
    expectBearing(bearingDegrees(BERLIN, { lat: BERLIN.lat, lng: BERLIN.lng - 1 }), 270)
  })

  it('zeigt nach Nordosten', () => {
    const bearing = bearingDegrees(BERLIN, { lat: BERLIN.lat + 0.01, lng: BERLIN.lng + 0.0164 })
    expectBearing(bearing, 45, 2)
  })
})

describe('bearingDegrees - Randfaelle', () => {
  it('liefert fuer den identischen Punkt kein NaN', () => {
    const bearing = bearingDegrees(BERLIN, { ...BERLIN })
    expect(Number.isNaN(bearing)).toBe(false)
    expect(bearing).toBe(0)
  })

  it('bleibt immer im Bereich 0 bis unter 360', () => {
    const targets: LatLng[] = [
      { lat: 53, lng: 13 },
      { lat: 51, lng: 14 },
      { lat: 52, lng: 12 },
      { lat: -33.9, lng: 151.2 },
      { lat: 40.7, lng: -74 },
    ]
    for (const target of targets) {
      const bearing = bearingDegrees(BERLIN, target)
      expect(bearing).toBeGreaterThanOrEqual(0)
      expect(bearing).toBeLessThan(360)
    }
  })

  it('rechnet ueber den Grosskreis, nicht ueber die naive Koordinatendifferenz', () => {
    // Gleiche Breite, 40 Grad weiter oestlich: naiv waere das exakt 90 Grad,
    // ueber den Grosskreis sind es rund 71.
    const bearing = bearingDegrees({ lat: 70, lng: 0 }, { lat: 70, lng: 40 })
    expect(bearing).toBeGreaterThan(65)
    expect(bearing).toBeLessThan(78)
    expect(angleDiff(bearing, 90)).toBeGreaterThan(10)
  })

  it('ueberquert den Datumswechsel ohne Sprung', () => {
    expectBearing(bearingDegrees({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 }), 90)
  })

  it('behandelt unbrauchbare Koordinaten als Norden statt als NaN', () => {
    const bearing = bearingDegrees(BERLIN, { lat: Number.NaN, lng: Number.NaN })
    expect(Number.isNaN(bearing)).toBe(false)
    expect(bearing).toBe(0)
  })
})

describe('compassPoint - Sektoren', () => {
  it('ordnet die Sektormitten zu', () => {
    expect(compassPoint(0)).toBe('N')
    expect(compassPoint(45)).toBe('NO')
    expect(compassPoint(90)).toBe('O')
    expect(compassPoint(135)).toBe('SO')
    expect(compassPoint(180)).toBe('S')
    expect(compassPoint(225)).toBe('SW')
    expect(compassPoint(270)).toBe('W')
    expect(compassPoint(315)).toBe('NW')
  })

  it('schlaegt die Sektorgrenze dem naechsten Sektor zu', () => {
    expect(compassPoint(22.4)).toBe('N')
    expect(compassPoint(22.5)).toBe('NO')
    expect(compassPoint(67.4)).toBe('NO')
    expect(compassPoint(67.5)).toBe('O')
    expect(compassPoint(112.5)).toBe('SO')
    expect(compassPoint(157.5)).toBe('S')
    expect(compassPoint(202.5)).toBe('SW')
    expect(compassPoint(247.5)).toBe('W')
    expect(compassPoint(292.5)).toBe('NW')
  })

  it('haelt Norden ueber die 360-Grad-Naht zusammen', () => {
    expect(compassPoint(337.4)).toBe('NW')
    expect(compassPoint(337.5)).toBe('N')
    expect(compassPoint(359.9)).toBe('N')
    expect(compassPoint(360)).toBe('N')
  })

  it('normalisiert negative Werte und Werte ueber 360', () => {
    expect(compassPoint(-45)).toBe('NW')
    expect(compassPoint(-90)).toBe('W')
    expect(compassPoint(-1)).toBe('N')
    expect(compassPoint(720)).toBe('N')
    expect(compassPoint(405)).toBe('NO')
    expect(compassPoint(-405)).toBe('NW')
  })

  it('faellt bei unbrauchbaren Zahlen auf Norden zurueck', () => {
    expect(compassPoint(Number.NaN)).toBe('N')
    expect(compassPoint(Number.POSITIVE_INFINITY)).toBe('N')
    expect(compassPoint(Number.NEGATIVE_INFINITY)).toBe('N')
  })
})

describe('directionLabel', () => {
  it('schreibt jede Richtung auf Deutsch aus', () => {
    const expected: Record<CompassPoint, string> = {
      N: 'Norden',
      NO: 'Nordosten',
      O: 'Osten',
      SO: 'Suedosten',
      S: 'Sueden',
      SW: 'Suedwesten',
      W: 'Westen',
      NW: 'Nordwesten',
    }
    for (const [point, label] of Object.entries(expected)) {
      expect(directionLabel(point as CompassPoint)).toBe(label)
    }
  })
})

describe('nearestLocations - Reihenfolge', () => {
  it('sortiert aufsteigend nach Luftlinie', () => {
    const locations = [
      northOf('fern', 0.5, { name: 'Fern' }),
      northOf('nah', 0.01, { name: 'Nah' }),
      northOf('mittel', 0.1, { name: 'Mittel' }),
    ]
    expect(ids(nearestLocations(BERLIN, locations))).toEqual(['nah', 'mittel', 'fern'])
  })

  it('rechnet die Luftlinie in Kilometern', () => {
    const entries = nearestLocations(BERLIN, [northOf('a', 0.01)])
    expect(entries[0].airKm).toBeCloseTo(0.01 * KM_PER_DEGREE_LAT, 2)
  })

  it('setzt die Himmelsrichtung vom Suchpunkt zum Standort', () => {
    const locations = [
      makeLocation('nord', { lat: BERLIN.lat + 0.2 }),
      makeLocation('sued', { lat: BERLIN.lat - 0.2 }),
      makeLocation('ost', { lng: BERLIN.lng + 0.2 }),
      makeLocation('west', { lng: BERLIN.lng - 0.2 }),
    ]
    const byId = new Map(nearestLocations(BERLIN, locations).map((e) => [e.location.id, e.direction]))
    expect(byId.get('nord')).toBe('N')
    expect(byId.get('sued')).toBe('S')
    expect(byId.get('ost')).toBe('O')
    expect(byId.get('west')).toBe('W')
  })

  it('laesst Fahrzeit und Fahrstrecke zunaechst leer', () => {
    const [entry] = nearestLocations(BERLIN, [northOf('a', 0.01)])
    expect(entry.travelSec).toBeNull()
    expect(entry.travelMeters).toBeNull()
  })
})

describe('nearestLocations - Gleichstand', () => {
  it('sortiert gleich weit entfernte Standorte nach Namen', () => {
    const locations = [
      makeLocation('b', { name: 'Beta' }),
      makeLocation('a', { name: 'Alpha' }),
      makeLocation('c', { name: 'Gamma' }),
    ]
    expect(ids(nearestLocations(BERLIN, locations))).toEqual(['a', 'b', 'c'])
  })

  it('vergleicht Namen mit Zahlen numerisch', () => {
    const locations = [
      makeLocation('s10', { name: 'Stelle 10' }),
      makeLocation('s2', { name: 'Stelle 2' }),
      makeLocation('s1', { name: 'Stelle 1' }),
    ]
    expect(ids(nearestLocations(BERLIN, locations))).toEqual(['s1', 's2', 's10'])
  })

  it('bleibt bei gleichem Namen ueber die Kennung eindeutig', () => {
    const locations = [
      makeLocation('z', { name: 'Filiale' }),
      makeLocation('a', { name: 'Filiale' }),
    ]
    expect(ids(nearestLocations(BERLIN, locations))).toEqual(['a', 'z'])
  })

  it('liefert unabhaengig von der Eingabereihenfolge dasselbe Ergebnis', () => {
    // Spiegelbildliche Punkte haben exakt dieselbe Luftlinie - der reine
    // Entfernungsvergleich koennte hier beliebig ausgehen.
    const locations = [
      northOf('nord', 0.05, { name: 'Nordpunkt' }),
      northOf('sued', -0.05, { name: 'Anderer Punkt' }),
    ]
    const forward = ids(nearestLocations(BERLIN, locations))
    const backward = ids(nearestLocations(BERLIN, [...locations].reverse()))
    expect(forward).toEqual(['sued', 'nord'])
    expect(backward).toEqual(forward)
  })
})

describe('nearestLocations - Optionen', () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    northOf(`l${String(i).padStart(2, '0')}`, 0.01 * (i + 1), { name: `Stelle ${i + 1}` }),
  )

  it('begrenzt ohne Angabe auf acht Treffer', () => {
    expect(nearestLocations(BERLIN, many)).toHaveLength(8)
  })

  it('beachtet ein eigenes Limit', () => {
    expect(ids(nearestLocations(BERLIN, many, { limit: 3 }))).toEqual(['l00', 'l01', 'l02'])
  })

  it('gibt bei Limit 0 nichts zurueck', () => {
    expect(nearestLocations(BERLIN, many, { limit: 0 })).toEqual([])
  })

  it('liefert bei negativem oder unbrauchbarem Limit nichts bzw. die Vorgabe', () => {
    expect(nearestLocations(BERLIN, many, { limit: -5 })).toEqual([])
    expect(nearestLocations(BERLIN, many, { limit: Number.NaN })).toHaveLength(8)
    expect(nearestLocations(BERLIN, many, { limit: undefined })).toHaveLength(8)
  })

  it('nimmt bei Limit Infinity alles mit, so wie maxKm null', () => {
    expect(nearestLocations(BERLIN, many, { limit: Number.POSITIVE_INFINITY })).toHaveLength(12)
    expect(nearestLocations(BERLIN, many, { limit: Number.NEGATIVE_INFINITY })).toEqual([])
  })

  it('schneidet ein gebrochenes Limit ab, statt aufzurunden', () => {
    expect(ids(nearestLocations(BERLIN, many, { limit: 2.9 }))).toEqual(['l00', 'l01'])
  })

  it('setzt die Richtung auch nach dem Abschneiden richtig', () => {
    // Der naechste Standort liegt im Sueden, alle weiter entfernten im Norden:
    // wird die Peilung erst nach dem Sortieren gerechnet, muss sie mitwandern.
    const locations = [northOf('nord', 0.4, { name: 'Nord' }), northOf('sued', -0.1, { name: 'Sued' })]
    const entries = nearestLocations(BERLIN, locations, { limit: 1 })
    expect(ids(entries)).toEqual(['sued'])
    expect(entries[0].direction).toBe('S')
  })

  it('laesst bei maxKm 0 nur den Standort auf dem Suchpunkt uebrig', () => {
    const locations = [makeLocation('hier', { name: 'Hier' }), northOf('dort', 0.01, { name: 'Dort' })]
    expect(ids(nearestLocations(BERLIN, locations, { maxKm: 0 }))).toEqual(['hier'])
  })

  it('gibt bei negativem maxKm nichts zurueck', () => {
    expect(nearestLocations(BERLIN, many, { maxKm: -1 })).toEqual([])
  })

  it('behandelt maxKm NaN und Infinity als ohne Grenze', () => {
    expect(nearestLocations(BERLIN, many, { maxKm: Number.NaN, limit: 20 })).toHaveLength(12)
    expect(
      nearestLocations(BERLIN, many, { maxKm: Number.POSITIVE_INFINITY, limit: 20 }),
    ).toHaveLength(12)
  })

  it('verbindet onlyActive und maxKm', () => {
    const locations = [
      northOf('nah_inaktiv', 0.01, { name: 'Nah inaktiv', is_active: false }),
      northOf('nah_aktiv', 0.02, { name: 'Nah aktiv' }),
      northOf('fern_aktiv', 0.5, { name: 'Fern aktiv' }),
    ]
    expect(ids(nearestLocations(BERLIN, locations, { onlyActive: true, maxKm: 5 }))).toEqual([
      'nah_aktiv',
    ])
  })

  it('schneidet ueber maxKm ab', () => {
    // 0,05 Grad Breite sind rund 5,6 km - vier Standorte liegen darunter.
    const entries = nearestLocations(BERLIN, many, { maxKm: 5.6, limit: 20 })
    expect(ids(entries)).toEqual(['l00', 'l01', 'l02', 'l03', 'l04'])
    for (const entry of entries) expect(entry.airKm).toBeLessThanOrEqual(5.6)
  })

  it('behandelt maxKm null als ohne Grenze', () => {
    expect(nearestLocations(BERLIN, many, { maxKm: null, limit: 20 })).toHaveLength(12)
  })

  it('wendet maxKm vor dem Limit an', () => {
    const entries = nearestLocations(BERLIN, many, { maxKm: 2.3, limit: 8 })
    expect(ids(entries)).toEqual(['l00', 'l01'])
  })

  it('blendet mit onlyActive inaktive Standorte aus', () => {
    const locations = [
      northOf('inaktiv', 0.01, { name: 'Inaktiv', is_active: false }),
      northOf('aktiv', 0.2, { name: 'Aktiv' }),
    ]
    expect(ids(nearestLocations(BERLIN, locations, { onlyActive: true }))).toEqual(['aktiv'])
    expect(ids(nearestLocations(BERLIN, locations))).toEqual(['inaktiv', 'aktiv'])
    expect(ids(nearestLocations(BERLIN, locations, { onlyActive: false }))).toEqual([
      'inaktiv',
      'aktiv',
    ])
  })
})

describe('nearestLocations - Grenzfaelle', () => {
  it('gibt bei leerer Liste ein leeres Array zurueck', () => {
    expect(nearestLocations(BERLIN, [])).toEqual([])
  })

  it('kommt mit einem einzigen Standort zurecht', () => {
    const entries = nearestLocations(BERLIN, [northOf('einzig', 0.02, { name: 'Einzig' })])
    expect(entries).toHaveLength(1)
    expect(entries[0].location.id).toBe('einzig')
    expect(entries[0].direction).toBe('N')
    expect(entries[0].airKm).toBeGreaterThan(0)
  })

  it('nimmt den Standort auf dem Suchpunkt selbst mit', () => {
    const entries = nearestLocations(BERLIN, [makeLocation('hier', { name: 'Hier' })])
    expect(entries[0].airKm).toBeCloseTo(0, 6)
    expect(entries[0].direction).toBe('N')
  })

  it('ueberspringt Standorte mit unbrauchbaren Koordinaten', () => {
    const locations = [
      makeLocation('kaputt', { name: 'Kaputt', lat: Number.NaN, lng: Number.NaN }),
      makeLocation('ausserhalb', { name: 'Ausserhalb', lat: 999, lng: 13.4 }),
      northOf('gut', 0.3, { name: 'Gut' }),
    ]
    expect(ids(nearestLocations(BERLIN, locations))).toEqual(['gut'])
  })

  it('gibt ohne gueltigen Suchpunkt nichts zurueck', () => {
    const locations = [northOf('a', 0.01)]
    expect(nearestLocations({ lat: Number.NaN, lng: 13.4 }, locations)).toEqual([])
    expect(nearestLocations({ lat: 91, lng: 13.4 }, locations)).toEqual([])
  })

  it('veraendert die Eingabe nicht', () => {
    const locations = [
      northOf('fern', 0.5, { name: 'Fern' }),
      northOf('nah', 0.01, { name: 'Nah' }),
    ]
    const snapshot = [...locations]
    const frozen = Object.freeze(locations)
    const entries = nearestLocations(BERLIN, frozen)
    expect(ids(entries)).toEqual(['nah', 'fern'])
    expect(locations).toEqual(snapshot)
    expect(locations[0].id).toBe('fern')
    // Der Standort selbst wird durchgereicht, nicht kopiert oder veraendert.
    expect(entries[0].location).toBe(locations[1])
  })
})

describe('withTravel', () => {
  const base = (): NearbyEntry[] =>
    nearestLocations(BERLIN, [
      northOf('a', 0.01, { name: 'A' }),
      northOf('b', 0.02, { name: 'B' }),
      northOf('c', 0.03, { name: 'C' }),
    ])

  it('ordnet Fahrzeit und Fahrstrecke der Reihe nach zu', () => {
    const result = withTravel(base(), [60, 120, 180], [1000, 2000, 3000])
    expect(result.map((e) => e.travelSec)).toEqual([60, 120, 180])
    expect(result.map((e) => e.travelMeters)).toEqual([1000, 2000, 3000])
    expect(ids(result)).toEqual(['a', 'b', 'c'])
  })

  it('laesst die Luftlinie und die Richtung unangetastet', () => {
    const entries = base()
    const result = withTravel(entries, [60, 120, 180], [1000, 2000, 3000])
    expect(result.map((e) => e.airKm)).toEqual(entries.map((e) => e.airKm))
    expect(result.map((e) => e.direction)).toEqual(entries.map((e) => e.direction))
  })

  it('akzeptiert die Null als gueltigen Wert', () => {
    const result = withTravel(base(), [0, 1, 2], [0, 1, 2])
    expect(result[0].travelSec).toBe(0)
    expect(result[0].travelMeters).toBe(0)
  })

  it('macht aus Infinity, NaN und negativen Werten null', () => {
    const result = withTravel(
      base(),
      [Number.POSITIVE_INFINITY, Number.NaN, -30],
      [-1, Number.NEGATIVE_INFINITY, Number.NaN],
    )
    expect(result.map((e) => e.travelSec)).toEqual([null, null, null])
    expect(result.map((e) => e.travelMeters)).toEqual([null, null, null])
  })

  it('mischt gueltige und unbrauchbare Werte richtig', () => {
    const result = withTravel(base(), [60, Number.NaN, 180], [1000, 2000, -5])
    expect(result.map((e) => e.travelSec)).toEqual([60, null, 180])
    expect(result.map((e) => e.travelMeters)).toEqual([1000, 2000, null])
  })

  it('laesst den Rest bei kuerzeren Arrays leer', () => {
    const result = withTravel(base(), [60], [1000, 2000])
    expect(result.map((e) => e.travelSec)).toEqual([60, null, null])
    expect(result.map((e) => e.travelMeters)).toEqual([1000, 2000, null])
  })

  it('kommt mit gaenzlich leeren Arrays zurecht', () => {
    const result = withTravel(base(), [], [])
    expect(result).toHaveLength(3)
    expect(result.every((e) => e.travelSec === null && e.travelMeters === null)).toBe(true)
  })

  it('gibt bei leerer Eintragsliste ein leeres Array zurueck', () => {
    expect(withTravel([], [60], [1000])).toEqual([])
  })

  it('veraendert die Eingabe nicht und liefert neue Objekte', () => {
    const entries = base()
    const snapshot = entries.map((e) => ({ ...e }))
    const result = withTravel(entries, [60, 120, 180], [1000, 2000, 3000])
    expect(entries).toEqual(snapshot)
    expect(entries.every((e) => e.travelSec === null && e.travelMeters === null)).toBe(true)
    expect(result[0]).not.toBe(entries[0])
    expect(result[0].location).toBe(entries[0].location)
  })
})
