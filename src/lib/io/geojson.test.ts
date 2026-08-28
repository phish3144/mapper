import { describe, expect, it } from 'vitest'
import type { Category, Group, MapLocation } from '@/types/domain'
import { locationsToGeoJson, parseGeoJson } from './geojson'

function makeLocation(partial: Partial<MapLocation> = {}): MapLocation {
  return {
    id: 'loc-1',
    workspace_id: 'ws-1',
    category_id: null,
    name: 'Lager Nord',
    lat: 52.520008,
    lng: 13.404954,
    address: null,
    notes: null,
    service_minutes: 0,
    time_windows: [],
    tags: [],
    is_active: true,
    visibility: 'workspace',
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

function makeCategory(id: string, name: string): Category {
  return {
    id,
    workspace_id: 'ws-1',
    name,
    color: '#336699',
    icon: 'pin',
    description: null,
    sort_order: 0,
    visibility: 'workspace',
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function makeGroup(id: string, name: string): Group {
  return {
    id,
    workspace_id: 'ws-1',
    name,
    color: '#993366',
    description: null,
    sort_order: 0,
    visibility: 'workspace',
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

describe('locationsToGeoJson', () => {
  it('schreibt Punkte in GeoJSON-Reihenfolge [lng, lat]', () => {
    const collection = locationsToGeoJson([makeLocation()], [], new Map())
    expect(collection.type).toBe('FeatureCollection')
    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [13.404954, 52.520008],
    })
  })

  it('uebernimmt Kategorie, Gruppen und Zeitfenster in die Eigenschaften', () => {
    const location = makeLocation({
      category_id: 'cat-1',
      address: 'Hauptstrasse 1',
      notes: 'Klingel defekt',
      tags: ['kunde', 'nord'],
      service_minutes: 15,
      is_active: false,
      time_windows: [{ dow: 1, from: '08:00', to: '12:00' }],
    })
    const collection = locationsToGeoJson(
      [location],
      [makeCategory('cat-1', 'Baustelle')],
      new Map([['loc-1', [makeGroup('grp-1', 'Team A'), makeGroup('grp-2', 'Team B')]]]),
    )
    expect(collection.features[0].properties).toEqual({
      name: 'Lager Nord',
      kategorie: 'Baustelle',
      gruppen: ['Team A', 'Team B'],
      adresse: 'Hauptstrasse 1',
      notizen: 'Klingel defekt',
      tags: ['kunde', 'nord'],
      aufenthalt_minuten: 15,
      aktiv: false,
      zeitfenster: [{ dow: 1, von: '08:00', bis: '12:00' }],
    })
  })
})

describe('parseGeoJson', () => {
  it('liest den Export verlustfrei zurueck', () => {
    const locations = [
      makeLocation({
        id: 'loc-1',
        category_id: 'cat-1',
        name: 'Lager "Nord"; Rampe 2',
        address: 'Hauptstrasse 1',
        notes: 'Zeile 1\nZeile 2',
        tags: ['kunde', 'nord'],
        service_minutes: 20,
        time_windows: [
          { dow: 1, from: '08:00', to: '12:00' },
          { dow: 7, from: '10:00', to: '14:30' },
        ],
      }),
      makeLocation({
        id: 'loc-2',
        name: 'Depot Sued',
        lat: -33.8688,
        lng: 151.2093,
        is_active: false,
      }),
    ]
    const text = JSON.stringify(
      locationsToGeoJson(
        locations,
        [makeCategory('cat-1', 'Baustelle')],
        new Map([['loc-1', [makeGroup('grp-1', 'Team A')]]]),
      ),
    )
    const result = parseGeoJson(text)
    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      {
        name: 'Lager "Nord"; Rampe 2',
        lat: 52.520008,
        lng: 13.404954,
        address: 'Hauptstrasse 1',
        notes: 'Zeile 1\nZeile 2',
        tags: ['kunde', 'nord'],
        serviceMinutes: 20,
        timeWindows: [
          { dow: 1, from: '08:00', to: '12:00' },
          { dow: 7, from: '10:00', to: '14:30' },
        ],
        categoryName: 'Baustelle',
        groupNames: ['Team A'],
        isActive: true,
      },
      {
        name: 'Depot Sued',
        lat: -33.8688,
        lng: 151.2093,
        tags: [],
        serviceMinutes: 0,
        timeWindows: [],
        groupNames: [],
        isActive: false,
      },
    ])
  })

  it('liest [lng, lat] herum richtig und dreht offensichtlich vertauschte Werte', () => {
    const normal = parseGeoJson(
      JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [13.4, 52.5] },
        properties: { name: 'Berlin' },
      }),
    )
    expect(normal.errors).toEqual([])
    expect(normal.rows[0]).toMatchObject({ lat: 52.5, lng: 13.4 })

    // 123.9 kann keine Breite sein - hier lag die Reihenfolge [lat, lng] vor.
    const swapped = parseGeoJson(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-33.87, 151.21] },
            properties: { name: 'Sydney' },
          },
        ],
      }),
    )
    expect(swapped.errors).toEqual([])
    expect(swapped.rows[0]).toMatchObject({ lat: -33.87, lng: 151.21 })
  })

  it('akzeptiert BOM, englische Schluessel und Zeitfenster als Text', () => {
    const text =
      '\uFEFF' +
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: ['13,4', '52,5'] },
            properties: {
              Name: 'Werkstatt',
              category: 'Service',
              groups: 'Team A, Team B',
              address: 'Ringstrasse 7',
              notes: 'Hinterhof',
              tags: ['werkstatt'],
              serviceMinutes: '12',
              active: 'nein',
              zeitfenster: 'Mo 8:00-12:00|Sonntag 10:00 bis 14:00',
            },
          },
        ],
      })
    const result = parseGeoJson(text)
    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      {
        name: 'Werkstatt',
        lat: 52.5,
        lng: 13.4,
        address: 'Ringstrasse 7',
        notes: 'Hinterhof',
        tags: ['werkstatt'],
        serviceMinutes: 12,
        timeWindows: [
          { dow: 1, from: '08:00', to: '12:00' },
          { dow: 7, from: '10:00', to: '14:00' },
        ],
        categoryName: 'Service',
        groupNames: ['Team A', 'Team B'],
        isActive: false,
      },
    ])
  })

  it('sammelt fehlerhafte Features samt Indexangabe, statt abzubrechen', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [13.4, 52.5] }, properties: { name: 'Gut' } },
        { type: 'Feature', properties: { name: 'Ohne Geometrie' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [300, 200] }, properties: { name: 'Zu weit' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [13.4, 52.5] }, properties: {} },
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[13.4, 52.5], [13.5, 52.6]] },
          properties: { name: 'Linie' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [13.4, 52.5] },
          properties: { name: 'Kaputte Zeit', zeitfenster: 'Mo 25:00-99:00' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [13.41, 52.51] },
          properties: { name: 'Auch gut', aufenthalt_minuten: 5 },
        },
      ],
    })
    const result = parseGeoJson(text)
    expect(result.rows.map((row) => row.name)).toEqual(['Gut', 'Auch gut'])
    expect(result.errors).toHaveLength(5)
    expect(result.errors[0]).toContain('Feature 2')
    expect(result.errors[0]).toContain('Geometrie')
    expect(result.errors[1]).toContain('Feature 3')
    expect(result.errors[2]).toBe('Feature 4: Der Name fehlt.')
    expect(result.errors[3]).toContain('Feature 5')
    expect(result.errors[4]).toContain('Feature 6')
  })

  it('meldet ungueltiges JSON und fremde Strukturen, ohne zu werfen', () => {
    const broken = parseGeoJson('{ "type": "FeatureCollection", ')
    expect(broken.rows).toEqual([])
    expect(broken.errors).toHaveLength(1)
    expect(broken.errors[0]).toContain('kein gueltiges JSON')

    expect(parseGeoJson('   ').errors).toEqual(['Die Datei ist leer.'])
    expect(parseGeoJson('{"type":"Topology"}').errors[0]).toContain('Unerwarteter Aufbau')
    expect(parseGeoJson('{"type":"FeatureCollection","features":[]}').errors).toEqual([
      'Die Datei enthaelt keine Features.',
    ])
  })
})

describe('parseGeoJson, Randfaelle', () => {
  const parse = (value: unknown) => parseGeoJson(JSON.stringify(value))

  it('nimmt ein einzelnes Zeitfenster auch ohne umgebende Liste an', () => {
    const result = parse({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [13.4, 52.5] },
      properties: { name: 'A', zeitfenster: { dow: 0, von: '10:00', bis: '14:00' } },
    })
    expect(result.errors).toEqual([])
    expect(result.rows[0].timeWindows).toEqual([{ dow: 7, from: '10:00', to: '14:00' }])
  })

  it('meldet eine FeatureCollection mit unbrauchbarem features-Feld als Aufbaufehler', () => {
    expect(parse({ type: 'FeatureCollection', features: { a: 1 } }).errors[0]).toContain(
      'Unerwarteter Aufbau',
    )
    expect(parse({ type: 'FeatureCollection' }).errors).toEqual([
      'Die Datei enthaelt keine Features.',
    ])
  })

  it('behandelt eine fehlende Geometrie wie eine leere', () => {
    const result = parse({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: { name: 'A' } }],
    })
    expect(result.rows).toEqual([])
    expect(result.errors[0]).toContain('Geometrie')
  })

  it('liest die Nullinsel als gueltigen Punkt', () => {
    const result = parse({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { name: 'Nullinsel', aufenthalt_minuten: 0, aktiv: false },
    })
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ lat: 0, lng: 0, serviceMinutes: 0, isActive: false })
  })

  it('uebernimmt eine leere Sammlung ohne Standorte fehlerfrei aus dem Export', () => {
    const collection = locationsToGeoJson([], [], new Map())
    expect(collection.features).toEqual([])
    expect(parseGeoJson(JSON.stringify(collection)).errors).toEqual([
      'Die Datei enthaelt keine Features.',
    ])
  })

  it('erkennt zerlegte Umlaute in Eigenschaftsnamen', () => {
    const result = parseGeoJson(
      '{"type":"Feature","geometry":{"type":"Point","coordinates":[13.4,52.5]},' +
        '"properties":{"name":"A","O\u0308ffnungszeiten":"Mo 08:00-12:00"}}',
    )
    expect(result.errors).toEqual([])
    expect(result.rows[0].timeWindows).toEqual([{ dow: 1, from: '08:00', to: '12:00' }])
  })
})
