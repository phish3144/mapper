import { describe, expect, it } from 'vitest'
import { ORPHAN_FALLBACK_NAME, stopPlace } from './stops'
import type { MapLocation, RouteStop } from '@/types/domain'

function stop(overrides: Partial<RouteStop> = {}): RouteStop {
  return {
    id: 's1',
    route_id: 'r1',
    location_id: 'l1',
    lat: 52.5,
    lng: 13.4,
    label: 'Vettin 104',
    position: 0,
    service_minutes_override: null,
    note: null,
    created_at: '2026-08-31T07:00:00Z',
    ...overrides,
  }
}

function location(overrides: Partial<MapLocation> = {}): MapLocation {
  return {
    id: 'l1',
    workspace_id: 'ws',
    category_id: null,
    name: 'Bisol GmbH',
    icon: null,
    lat: 48.1,
    lng: 11.6,
    address: null,
    notes: null,
    service_minutes: 30,
    time_windows: [],
    tags: [],
    is_active: true,
    visibility: 'workspace',
    created_by: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('stopPlace', () => {
  it('nimmt den echten Standort, wenn es ihn gibt', () => {
    const ort = stopPlace(stop(), location())
    expect(ort.id).toBe('l1')
    expect(ort.name).toBe('Bisol GmbH')
    // Der Standort gewinnt: er ist die gepflegte Quelle, der Stopp nur die
    // Kopie vom Tag des Hinzufuegens.
    expect(ort.lat).toBe(48.1)
    expect(ort.service_minutes).toBe(30)
  })

  it('springt mit der eigenen Koordinate des Stopps ein, wenn der Standort weg ist', () => {
    // Genau der Fall, der vorher die Tour leer machte.
    const ort = stopPlace(stop(), undefined)
    expect(ort.lat).toBe(52.5)
    expect(ort.lng).toBe(13.4)
    expect(ort.name).toBe('Vettin 104')
  })

  it('kennzeichnet den Platzhalter mit leerer Kennung', () => {
    // Daran erkennen die Ansichten, dass es nichts auszuwaehlen gibt und
    // weder Gruppe noch Kategorie existiert.
    expect(stopPlace(stop(), undefined).id).toBe('')
    expect(stopPlace(stop(), undefined).category_id).toBeNull()
  })

  it('fällt auf einen benennenden Text zurück, wenn auch die Beschriftung fehlt', () => {
    expect(stopPlace(stop({ label: null }), undefined).name).toBe(ORPHAN_FALLBACK_NAME)
    expect(stopPlace(stop({ label: '   ' }), undefined).name).toBe(ORPHAN_FALLBACK_NAME)
  })

  it('erfindet keine Zeitfenster für einen Platzhalter', () => {
    const ort = stopPlace(stop(), undefined)
    expect(ort.time_windows).toEqual([])
    expect(ort.service_minutes).toBe(0)
  })
})
