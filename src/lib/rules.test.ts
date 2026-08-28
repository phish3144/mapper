import { describe, expect, it } from 'vitest'
import type { Category, Group, MapLocation, RouteRule } from '@/types/domain'
import { applyRule, describeRule, isEmptyRule, normalizeRule } from './rules'

const CENTER = { lat: 52.52, lng: 13.405 }

function makeLocation(id: string, partial: Partial<MapLocation> = {}): MapLocation {
  return {
    id,
    workspace_id: 'ws-1',
    category_id: null,
    name: id,
    lat: CENTER.lat,
    lng: CENTER.lng,
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

function makeCategory(id: string, name: string): Category {
  return {
    id,
    workspace_id: 'ws-1',
    name,
    color: '#123456',
    icon: 'pin',
    description: null,
    sort_order: 0,
    visibility: 'workspace',
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeGroup(id: string, name: string): Group {
  return {
    id,
    workspace_id: 'ws-1',
    name,
    color: '#654321',
    description: null,
    sort_order: 0,
    visibility: 'workspace',
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const noMemberships = new Map<string, string[]>()

const ids = (locations: MapLocation[]): string[] => locations.map((l) => l.id)

describe('applyRule - Grundverhalten', () => {
  it('waehlt ohne Filter alle aktiven Standorte', () => {
    const locations = [
      makeLocation('a', { name: 'Alpha' }),
      makeLocation('b', { name: 'Beta' }),
    ]
    expect(ids(applyRule({}, locations, noMemberships))).toEqual(['a', 'b'])
  })

  it('gibt bei leerer Eingabe ein leeres Array zurueck', () => {
    expect(applyRule({ maxStops: 5 }, [], noMemberships)).toEqual([])
  })
})

describe('applyRule - onlyActive', () => {
  const locations = [
    makeLocation('a', { name: 'Aktiv', is_active: true }),
    makeLocation('i', { name: 'Inaktiv', is_active: false }),
  ]

  it('blendet inaktive Standorte per Vorgabe aus', () => {
    expect(ids(applyRule({}, locations, noMemberships))).toEqual(['a'])
  })

  it('nimmt inaktive Standorte mit, wenn onlyActive false ist', () => {
    expect(ids(applyRule({ onlyActive: false }, locations, noMemberships))).toEqual(['a', 'i'])
  })

  it('behandelt onlyActive: true wie die Vorgabe', () => {
    expect(ids(applyRule({ onlyActive: true }, locations, noMemberships))).toEqual(['a'])
  })
})

describe('applyRule - Kategorien', () => {
  const locations = [
    makeLocation('a', { name: 'Alpha', category_id: 'cat-1' }),
    makeLocation('b', { name: 'Beta', category_id: 'cat-2' }),
    makeLocation('c', { name: 'Gamma', category_id: null }),
  ]

  it('filtert auf die genannten Kategorien', () => {
    expect(ids(applyRule({ categoryIds: ['cat-2'] }, locations, noMemberships))).toEqual(['b'])
  })

  it('akzeptiert mehrere Kategorien als Oder-Verknuepfung', () => {
    const result = applyRule({ categoryIds: ['cat-1', 'cat-2'] }, locations, noMemberships)
    expect(ids(result)).toEqual(['a', 'b'])
  })

  it('schliesst Standorte ohne Kategorie aus, sobald der Filter greift', () => {
    expect(ids(applyRule({ categoryIds: ['cat-1'] }, locations, noMemberships))).toEqual(['a'])
  })

  it('ignoriert eine leere Kategorienliste', () => {
    expect(ids(applyRule({ categoryIds: [] }, locations, noMemberships))).toEqual(['a', 'b', 'c'])
  })
})

describe('applyRule - Gruppen', () => {
  const locations = [
    makeLocation('a', { name: 'Alpha' }),
    makeLocation('b', { name: 'Beta' }),
    makeLocation('c', { name: 'Gamma' }),
  ]
  const memberships = new Map<string, string[]>([
    ['a', ['g-nord']],
    ['b', ['g-sued', 'g-nord']],
  ])

  it('nimmt Standorte auf, die in mindestens einer Gruppe liegen', () => {
    expect(ids(applyRule({ groupIds: ['g-nord'] }, locations, memberships))).toEqual(['a', 'b'])
  })

  it('verknuepft mehrere Gruppen als Oder', () => {
    const result = applyRule({ groupIds: ['g-sued', 'g-west'] }, locations, memberships)
    expect(ids(result)).toEqual(['b'])
  })

  it('schliesst Standorte ohne Eintrag in der Zuordnung aus', () => {
    expect(ids(applyRule({ groupIds: ['g-nord'] }, locations, memberships))).not.toContain('c')
  })

  it('ignoriert eine leere Gruppenliste', () => {
    expect(ids(applyRule({ groupIds: [] }, locations, memberships))).toEqual(['a', 'b', 'c'])
  })
})

describe('applyRule - Tags', () => {
  const locations = [
    makeLocation('a', { name: 'Alpha', tags: ['Kunde', 'Nord'] }),
    makeLocation('b', { name: 'Beta', tags: ['kunde'] }),
    makeLocation('c', { name: 'Gamma', tags: ['Lager'] }),
    makeLocation('d', { name: 'Delta', tags: [] }),
  ]

  it('verknuepft Tags per Vorgabe mit oder', () => {
    const result = applyRule({ tags: ['kunde', 'lager'] }, locations, noMemberships)
    expect(ids(result)).toEqual(['a', 'b', 'c'])
  })

  it('verlangt bei tagMatch all alle Tags', () => {
    const result = applyRule({ tags: ['kunde', 'nord'], tagMatch: 'all' }, locations, noMemberships)
    expect(ids(result)).toEqual(['a'])
  })

  it('vergleicht ohne Beachtung der Gross-/Kleinschreibung', () => {
    const result = applyRule({ tags: ['KUNDE'], tagMatch: 'all' }, locations, noMemberships)
    expect(ids(result)).toEqual(['a', 'b'])
  })

  it('ignoriert eine leere Tagliste', () => {
    expect(ids(applyRule({ tags: [], tagMatch: 'all' }, locations, noMemberships))).toHaveLength(4)
  })
})

describe('applyRule - Umkreis', () => {
  // 0,01 Grad Breite entsprechen rund 1,11 km.
  const locations = [
    makeLocation('nah', { name: 'Nah', lat: CENTER.lat + 0.01, lng: CENTER.lng }),
    makeLocation('mittel', { name: 'Mittel', lat: CENTER.lat + 0.05, lng: CENTER.lng }),
    makeLocation('fern', { name: 'Fern', lat: CENTER.lat + 0.5, lng: CENTER.lng }),
  ]

  it('behaelt nur Standorte innerhalb des Radius', () => {
    const result = applyRule({ center: CENTER, radiusKm: 10 }, locations, noMemberships)
    expect(ids(result)).toEqual(['nah', 'mittel'])
  })

  it('greift nicht ohne Radius', () => {
    const result = applyRule({ center: CENTER, radiusKm: null }, locations, noMemberships)
    expect(ids(result)).toEqual(['nah', 'mittel', 'fern'])
  })

  it('greift nicht ohne Mittelpunkt', () => {
    const result = applyRule({ center: null, radiusKm: 1 }, locations, noMemberships)
    expect(result).toHaveLength(3)
  })

  it('ignoriert einen Radius von 0', () => {
    const result = applyRule({ center: CENTER, radiusKm: 0 }, locations, noMemberships)
    expect(result).toHaveLength(3)
  })
})

describe('applyRule - Sortierung', () => {
  it('sortiert ohne Mittelpunkt nach Namen mit deutscher Sortierung und Zahlen', () => {
    const locations = [
      makeLocation('s10', { name: 'Stopp 10' }),
      makeLocation('z', { name: 'Zoo' }),
      makeLocation('s2', { name: 'Stopp 2' }),
      makeLocation('ae', { name: 'Ärztehaus' }),
    ]
    expect(ids(applyRule({}, locations, noMemberships))).toEqual(['ae', 's2', 's10', 'z'])
  })

  it('sortiert mit Mittelpunkt nach Entfernung aufsteigend', () => {
    const locations = [
      makeLocation('fern', { name: 'A fern', lat: CENTER.lat + 0.3, lng: CENTER.lng }),
      makeLocation('nah', { name: 'Z nah', lat: CENTER.lat + 0.01, lng: CENTER.lng }),
      makeLocation('mittel', { name: 'M mittel', lat: CENTER.lat + 0.1, lng: CENTER.lng }),
    ]
    const result = applyRule({ center: CENTER }, locations, noMemberships)
    expect(ids(result)).toEqual(['nah', 'mittel', 'fern'])
  })

  it('loest gleiche Entfernungen ueber den Namen auf', () => {
    const locations = [
      makeLocation('b', { name: 'Beta', lat: CENTER.lat + 0.01, lng: CENTER.lng }),
      makeLocation('a', { name: 'Alpha', lat: CENTER.lat + 0.01, lng: CENTER.lng }),
    ]
    const result = applyRule({ center: CENTER, radiusKm: 50 }, locations, noMemberships)
    expect(ids(result)).toEqual(['a', 'b'])
  })

  it('liefert bei gleichem Namen eine feste Reihenfolge ueber die Kennung', () => {
    const locations = [
      makeLocation('b2', { name: 'Filiale' }),
      makeLocation('a1', { name: 'Filiale' }),
    ]
    expect(ids(applyRule({}, locations, noMemberships))).toEqual(['a1', 'b2'])
    expect(ids(applyRule({}, [...locations].reverse(), noMemberships))).toEqual(['a1', 'b2'])
  })
})

describe('applyRule - maxStops', () => {
  const locations = [
    makeLocation('c', { name: 'Gamma' }),
    makeLocation('a', { name: 'Alpha' }),
    makeLocation('b', { name: 'Beta' }),
  ]

  it('schneidet nach der Sortierung ab', () => {
    expect(ids(applyRule({ maxStops: 2 }, locations, noMemberships))).toEqual(['a', 'b'])
  })

  it('schneidet auch nach der Entfernungssortierung ab', () => {
    const spread = [
      makeLocation('fern', { name: 'Fern', lat: CENTER.lat + 0.3, lng: CENTER.lng }),
      makeLocation('nah', { name: 'Nah', lat: CENTER.lat + 0.01, lng: CENTER.lng }),
    ]
    const result = applyRule({ center: CENTER, maxStops: 1 }, spread, noMemberships)
    expect(ids(result)).toEqual(['nah'])
  })

  it('ignoriert eine Obergrenze ohne Sinn', () => {
    expect(applyRule({ maxStops: 0 }, locations, noMemberships)).toHaveLength(3)
    expect(applyRule({ maxStops: -5 }, locations, noMemberships)).toHaveLength(3)
    expect(applyRule({ maxStops: null }, locations, noMemberships)).toHaveLength(3)
  })

  it('laesst eine zu grosse Obergrenze wirkungslos', () => {
    expect(applyRule({ maxStops: 99 }, locations, noMemberships)).toHaveLength(3)
  })
})

describe('applyRule - Kombination', () => {
  const locations = [
    makeLocation('treffer1', {
      name: 'Filiale Nord',
      category_id: 'cat-filiale',
      tags: ['Kunde', 'Premium'],
      lat: CENTER.lat + 0.01,
      lng: CENTER.lng,
    }),
    makeLocation('treffer2', {
      name: 'Filiale Mitte',
      category_id: 'cat-filiale',
      tags: ['kunde', 'premium'],
      lat: CENTER.lat + 0.02,
      lng: CENTER.lng,
    }),
    makeLocation('falscheKategorie', {
      name: 'Lager Nord',
      category_id: 'cat-lager',
      tags: ['Kunde', 'Premium'],
      lat: CENTER.lat + 0.01,
      lng: CENTER.lng,
    }),
    makeLocation('falscheGruppe', {
      name: 'Filiale Sued',
      category_id: 'cat-filiale',
      tags: ['Kunde', 'Premium'],
      lat: CENTER.lat + 0.01,
      lng: CENTER.lng,
    }),
    makeLocation('tagFehlt', {
      name: 'Filiale Ost',
      category_id: 'cat-filiale',
      tags: ['Kunde'],
      lat: CENTER.lat + 0.01,
      lng: CENTER.lng,
    }),
    makeLocation('zuWeit', {
      name: 'Filiale Fern',
      category_id: 'cat-filiale',
      tags: ['Kunde', 'Premium'],
      lat: CENTER.lat + 1,
      lng: CENTER.lng,
    }),
    makeLocation('inaktiv', {
      name: 'Filiale Alt',
      category_id: 'cat-filiale',
      tags: ['Kunde', 'Premium'],
      lat: CENTER.lat + 0.005,
      lng: CENTER.lng,
      is_active: false,
    }),
  ]
  const memberships = new Map<string, string[]>([
    ['treffer1', ['g-nord']],
    ['treffer2', ['g-nord', 'g-mitte']],
    ['falscheKategorie', ['g-nord']],
    ['falscheGruppe', ['g-sued']],
    ['tagFehlt', ['g-nord']],
    ['zuWeit', ['g-nord']],
    ['inaktiv', ['g-nord']],
  ])

  it('wendet alle Filter gemeinsam an und sortiert nach Entfernung', () => {
    const rule: RouteRule = {
      categoryIds: ['cat-filiale'],
      groupIds: ['g-nord', 'g-mitte'],
      tags: ['KUNDE', 'PREMIUM'],
      tagMatch: 'all',
      center: CENTER,
      radiusKm: 20,
      onlyActive: true,
      maxStops: 5,
    }
    expect(ids(applyRule(rule, locations, memberships))).toEqual(['treffer1', 'treffer2'])
  })

  it('begrenzt die Kombination zusaetzlich per maxStops', () => {
    const rule: RouteRule = {
      categoryIds: ['cat-filiale'],
      groupIds: ['g-nord', 'g-mitte'],
      tags: ['kunde'],
      center: CENTER,
      radiusKm: 20,
      maxStops: 1,
    }
    expect(ids(applyRule(rule, locations, memberships))).toEqual(['treffer1'])
  })
})

describe('applyRule - Unveraenderlichkeit', () => {
  it('laesst Eingabe-Array und Standorte unberuehrt', () => {
    const locations = [
      makeLocation('c', { name: 'Gamma', tags: ['x'] }),
      makeLocation('a', { name: 'Alpha', tags: ['x'] }),
      makeLocation('b', { name: 'Beta', tags: ['x'] }),
    ]
    const before = locations.map((l) => ({ ...l, tags: [...l.tags] }))
    const rule: RouteRule = { tags: ['X'], center: CENTER, radiusKm: 100, maxStops: 2 }
    applyRule(rule, locations, new Map())
    expect(locations).toEqual(before)
    expect(ids(locations)).toEqual(['c', 'a', 'b'])
  })

  it('kommt mit einem eingefrorenen Array zurecht', () => {
    const locations = Object.freeze([
      makeLocation('c', { name: 'Gamma' }),
      makeLocation('a', { name: 'Alpha' }),
    ]) as MapLocation[]
    expect(ids(applyRule({}, locations, noMemberships))).toEqual(['a', 'c'])
  })

  it('veraendert die uebergebene Regel nicht', () => {
    const rule: RouteRule = { categoryIds: ['cat-1'], tags: ['Kunde'] }
    applyRule(rule, [makeLocation('a', { category_id: 'cat-1', tags: ['kunde'] })], noMemberships)
    expect(rule).toEqual({ categoryIds: ['cat-1'], tags: ['Kunde'] })
  })
})

describe('applyRule - Randfaelle', () => {
  it('sortiert unbrauchbare Koordinaten ans Ende, statt die Reihenfolge zu zerlegen', () => {
    const locations = [
      makeLocation('kaputt', { name: 'Kaputt', lat: Number.NaN, lng: CENTER.lng }),
      makeLocation('ok', { name: 'Ok', lat: CENTER.lat + 0.01, lng: CENTER.lng }),
      makeLocation('kaputt2', { name: 'Auch kaputt', lat: CENTER.lat, lng: Number.NaN }),
    ]
    const result = applyRule({ center: CENTER }, locations, noMemberships)
    // Gleichstand bei +Infinity wird ueber den Namen aufgeloest, nicht ueber NaN-Vergleiche.
    expect(ids(result)).toEqual(['ok', 'kaputt2', 'kaputt'])
  })

  it('schliesst unbrauchbare Koordinaten aus dem Umkreis aus', () => {
    const locations = [
      makeLocation('kaputt', { name: 'Kaputt', lat: Number.NaN, lng: CENTER.lng }),
      makeLocation('ok', { name: 'Ok' }),
    ]
    expect(ids(applyRule({ center: CENTER, radiusKm: 5 }, locations, noMemberships))).toEqual(['ok'])
  })

  it('behandelt einen leeren Eintrag in der Zuordnung wie keine Mitgliedschaft', () => {
    const memberships = new Map<string, string[]>([['a', []]])
    expect(applyRule({ groupIds: ['g-1'] }, [makeLocation('a')], memberships)).toEqual([])
  })

  it('vergleicht Tags des Standorts getrimmt und ohne Gross-/Kleinschreibung', () => {
    const locations = [makeLocation('a', { tags: ['  Kunde  ', 'NORD'] })]
    expect(ids(applyRule({ tags: [' kunde ', 'nord'], tagMatch: 'all' }, locations, noMemberships))).toEqual(['a'])
  })

  it('kommt mit einem einzelnen Standort und maxStops 1 zurecht', () => {
    const locations = [makeLocation('a', { name: 'Alpha' })]
    expect(ids(applyRule({ maxStops: 1, center: CENTER }, locations, noMemberships))).toEqual(['a'])
  })

  it('liefert fuer eine leere Standortliste auch mit Mittelpunkt ein leeres Array', () => {
    expect(applyRule({ center: CENTER, radiusKm: 5 }, [], noMemberships)).toEqual([])
  })

  it('nimmt eine voellig kaputte Regel entgegen', () => {
    const broken = { categoryIds: 42, groupIds: null, tags: 'kunde', center: 'Berlin' } as unknown as RouteRule
    const locations = [makeLocation('a', { name: 'Alpha' }), makeLocation('b', { name: 'Beta' })]
    expect(ids(applyRule(broken, locations, noMemberships))).toEqual(['a', 'b'])
  })
})

describe('normalizeRule', () => {
  const fallback: RouteRule = {
    categoryIds: [],
    groupIds: [],
    tags: [],
    tagMatch: 'any',
    center: null,
    radiusKm: null,
    onlyActive: true,
    maxStops: null,
  }

  it('liefert fuer nicht auswertbare Eingaben die Vorgaben', () => {
    expect(normalizeRule(null)).toEqual(fallback)
    expect(normalizeRule(undefined)).toEqual(fallback)
    expect(normalizeRule('Regel')).toEqual(fallback)
    expect(normalizeRule(42)).toEqual(fallback)
    expect(normalizeRule(true)).toEqual(fallback)
    expect(normalizeRule({})).toEqual(fallback)
    expect(normalizeRule([1, 2, 3])).toEqual(fallback)
  })

  it('verwirft unbekannte Felder', () => {
    const result = normalizeRule({ categoryIds: ['c1'], unsinn: { tief: [1] }, mode: 'rule' })
    expect(result).toEqual({ ...fallback, categoryIds: ['c1'] })
    expect(Object.keys(result).sort()).toEqual(Object.keys(fallback).sort())
  })

  it('saeubert Listen von Muell und Dopplungen', () => {
    const result = normalizeRule({
      categoryIds: ['c1', ' c2 ', '', 7, null, { id: 'c3' }, 'c1'],
      groupIds: 'g1',
      tags: ['Kunde', 'kunde', '  Nord  ', false],
    })
    expect(result.categoryIds).toEqual(['c1', 'c2'])
    expect(result.groupIds).toEqual([])
    expect(result.tags).toEqual(['Kunde', 'Nord'])
  })

  it('faellt bei unbekanntem tagMatch auf any zurueck', () => {
    expect(normalizeRule({ tagMatch: 'alle' }).tagMatch).toBe('any')
    expect(normalizeRule({ tagMatch: 'all' }).tagMatch).toBe('all')
    expect(normalizeRule({ tagMatch: 'any' }).tagMatch).toBe('any')
    expect(normalizeRule({ tagMatch: 1 }).tagMatch).toBe('any')
  })

  it('prueft den Mittelpunkt', () => {
    expect(normalizeRule({ center: { lat: 52.5, lng: 13.4 } }).center).toEqual({ lat: 52.5, lng: 13.4 })
    expect(normalizeRule({ center: { lat: 52.5, lng: 13.4, extra: 'x' } }).center).toEqual({
      lat: 52.5,
      lng: 13.4,
    })
    expect(normalizeRule({ center: { lat: 91, lng: 13.4 } }).center).toBeNull()
    expect(normalizeRule({ center: { lat: '52.5', lng: '13.4' } }).center).toBeNull()
    expect(normalizeRule({ center: [52.5, 13.4] }).center).toBeNull()
    expect(normalizeRule({ center: 'Berlin' }).center).toBeNull()
    expect(normalizeRule({ center: { lat: Number.NaN, lng: 13.4 } }).center).toBeNull()
  })

  it('laesst nur einen Radius groesser als 0 zu', () => {
    expect(normalizeRule({ radiusKm: 12.5 }).radiusKm).toBe(12.5)
    expect(normalizeRule({ radiusKm: 0 }).radiusKm).toBeNull()
    expect(normalizeRule({ radiusKm: -3 }).radiusKm).toBeNull()
    expect(normalizeRule({ radiusKm: '20' }).radiusKm).toBeNull()
    expect(normalizeRule({ radiusKm: Number.POSITIVE_INFINITY }).radiusKm).toBeNull()
  })

  it('nimmt fuer onlyActive nur echte Wahrheitswerte', () => {
    expect(normalizeRule({ onlyActive: false }).onlyActive).toBe(false)
    expect(normalizeRule({ onlyActive: 'false' }).onlyActive).toBe(true)
    expect(normalizeRule({ onlyActive: 0 }).onlyActive).toBe(true)
  })

  it('macht aus maxStops eine ganze Zahl ab 1', () => {
    expect(normalizeRule({ maxStops: 12 }).maxStops).toBe(12)
    expect(normalizeRule({ maxStops: 12.9 }).maxStops).toBe(12)
    expect(normalizeRule({ maxStops: 0.4 }).maxStops).toBeNull()
    expect(normalizeRule({ maxStops: 0 }).maxStops).toBeNull()
    expect(normalizeRule({ maxStops: -2 }).maxStops).toBeNull()
    expect(normalizeRule({ maxStops: '3' }).maxStops).toBeNull()
  })

  it('ist unveraenderlich unter Wiederholung', () => {
    const once = normalizeRule({ tags: [' Kunde ', 'kunde'], maxStops: 3.7, radiusKm: 12.5 })
    expect(normalizeRule(once)).toEqual(once)
  })

  it('uebernimmt kein __proto__ aus dem jsonb', () => {
    const evil = JSON.parse('{"__proto__":{"boese":1},"categoryIds":["c1"]}') as unknown
    const result = normalizeRule(evil)
    expect(result.categoryIds).toEqual(['c1'])
    expect(Object.keys(result)).not.toContain('boese')
    expect(({} as Record<string, unknown>).boese).toBeUndefined()
  })

  it('veraendert die Eingabe nicht', () => {
    const raw = { categoryIds: ['c1', 'c1'], tags: [' Kunde '], center: { lat: 52.5, lng: 13.4 } }
    const copy = JSON.parse(JSON.stringify(raw)) as unknown
    const result = normalizeRule(raw)
    expect(raw).toEqual(copy)
    result.categoryIds?.push('c2')
    expect(raw.categoryIds).toEqual(['c1', 'c1'])
  })
})

describe('isEmptyRule', () => {
  it('erkennt Regeln ohne Einschraenkung', () => {
    expect(isEmptyRule({})).toBe(true)
    expect(isEmptyRule({ categoryIds: [], groupIds: [], tags: [] })).toBe(true)
    expect(isEmptyRule({ onlyActive: true })).toBe(true)
    expect(isEmptyRule({ onlyActive: false })).toBe(true)
    expect(isEmptyRule({ tagMatch: 'all' })).toBe(true)
    expect(isEmptyRule({ center: CENTER })).toBe(true)
    expect(isEmptyRule({ radiusKm: 10 })).toBe(true)
    expect(isEmptyRule({ maxStops: 0 })).toBe(true)
  })

  it('erkennt gesetzte Filter', () => {
    expect(isEmptyRule({ categoryIds: ['c1'] })).toBe(false)
    expect(isEmptyRule({ groupIds: ['g1'] })).toBe(false)
    expect(isEmptyRule({ tags: ['kunde'] })).toBe(false)
    expect(isEmptyRule({ center: CENTER, radiusKm: 10 })).toBe(false)
    expect(isEmptyRule({ maxStops: 3 })).toBe(false)
  })
})

describe('describeRule', () => {
  const categories = [makeCategory('cat-1', 'Filiale'), makeCategory('cat-2', 'Lager')]
  const groups = [makeGroup('g-1', 'Nord'), makeGroup('g-2', 'Sued')]

  it('beschreibt die leere Regel und nennt dabei die Vorgabe "nur aktive"', () => {
    expect(describeRule({}, categories, groups)).toBe('Alle aktiven Standorte')
    expect(describeRule({ onlyActive: false }, categories, groups)).toBe('Alle Standorte')
    expect(describeRule({ center: CENTER }, categories, groups)).toBe('Alle aktiven Standorte')
  })

  it('setzt eine vollstaendige Regel zusammen', () => {
    const rule: RouteRule = {
      categoryIds: ['cat-1', 'cat-2'],
      groupIds: ['g-1'],
      center: CENTER,
      radiusKm: 20,
      onlyActive: true,
      maxStops: 12,
    }
    expect(describeRule(rule, categories, groups)).toBe(
      'Kategorien Filiale, Lager · Gruppe Nord · im Umkreis von 20 km · nur aktive · max. 12 Stopps',
    )
  })

  it('unterscheidet Einzahl und Mehrzahl', () => {
    expect(describeRule({ categoryIds: ['cat-1'] }, categories, groups)).toBe(
      'Kategorie Filiale · nur aktive',
    )
    expect(describeRule({ groupIds: ['g-1', 'g-2'] }, categories, groups)).toBe(
      'Gruppen Nord, Sued · nur aktive',
    )
    expect(describeRule({ maxStops: 1 }, categories, groups)).toBe('nur aktive · max. 1 Stopp')
  })

  it('nennt die Verknuepfung der Tags', () => {
    expect(describeRule({ tags: ['kunde'] }, categories, groups)).toBe('Tag kunde · nur aktive')
    expect(describeRule({ tags: ['kunde', 'nord'] }, categories, groups)).toBe(
      'Tags kunde oder nord · nur aktive',
    )
    expect(describeRule({ tags: ['kunde', 'nord'], tagMatch: 'all' }, categories, groups)).toBe(
      'Tags kunde und nord · nur aktive',
    )
  })

  it('weist auf inaktive Standorte hin', () => {
    expect(describeRule({ categoryIds: ['cat-1'], onlyActive: false }, categories, groups)).toBe(
      'Kategorie Filiale · auch inaktive',
    )
  })

  it('nennt den Umkreis nur mit Mittelpunkt und Radius', () => {
    expect(describeRule({ categoryIds: ['cat-1'], radiusKm: 5 }, categories, groups)).toBe(
      'Kategorie Filiale · nur aktive',
    )
    expect(describeRule({ categoryIds: ['cat-1'], center: CENTER }, categories, groups)).toBe(
      'Kategorie Filiale · nur aktive',
    )
  })

  it('schreibt Kilometer mit Komma', () => {
    expect(describeRule({ center: CENTER, radiusKm: 2.5 }, categories, groups)).toBe(
      'im Umkreis von 2,5 km · nur aktive',
    )
    expect(describeRule({ center: CENTER, radiusKm: 0.75 }, categories, groups)).toBe(
      'im Umkreis von 0,75 km · nur aktive',
    )
    expect(describeRule({ center: CENTER, radiusKm: 1 / 3 }, categories, groups)).toBe(
      'im Umkreis von 0,33 km · nur aktive',
    )
  })

  it('rundet einen winzigen Radius nicht auf 0 km', () => {
    // 0 km wuerde behaupten, dass nichts getroffen wird - der Filter greift aber.
    expect(describeRule({ center: CENTER, radiusKm: 0.004 }, categories, groups)).toBe(
      'im Umkreis von unter 0,01 km · nur aktive',
    )
    expect(describeRule({ center: CENTER, radiusKm: 0.01 }, categories, groups)).toBe(
      'im Umkreis von 0,01 km · nur aktive',
    )
  })

  it('fasst gleichnamige Eintraege zusammen', () => {
    const doppelt = [makeCategory('cat-1', 'Filiale'), makeCategory('cat-3', 'Filiale')]
    expect(describeRule({ categoryIds: ['cat-1', 'cat-3'] }, doppelt, groups)).toBe(
      'Kategorie Filiale · nur aktive',
    )
  })

  it('kennzeichnet unbekannte Kennungen', () => {
    expect(describeRule({ categoryIds: ['weg', 'fort'] }, categories, groups)).toBe(
      'Kategorie unbekannt · nur aktive',
    )
  })

  it('sortiert die Namen unabhaengig von der Reihenfolge in der Regel', () => {
    expect(describeRule({ categoryIds: ['cat-2', 'cat-1'] }, categories, groups)).toBe(
      'Kategorien Filiale, Lager · nur aktive',
    )
  })

  it('kommt mit einer beschaedigten Regel zurecht', () => {
    const broken = { categoryIds: 'cat-1', radiusKm: -1, maxStops: 4 } as unknown as RouteRule
    expect(describeRule(broken, categories, groups)).toBe('nur aktive · max. 4 Stopps')
  })
})
