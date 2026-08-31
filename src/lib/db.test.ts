import { describe, expect, it } from 'vitest'
import { groupAffectedRoutes, type StopRouteRow } from './db'

function zeile(route_id: string, name: string | null): StopRouteRow {
  return { route_id, routes: name === null ? null : { name } }
}

describe('groupAffectedRoutes', () => {
  it('zaehlt die Stopps je Route zusammen', () => {
    const betroffen = groupAffectedRoutes([
      zeile('r1', 'Sondertour HaMu MV'),
      zeile('r1', 'Sondertour HaMu MV'),
      zeile('r2', 'Tour vom 28.08.2026'),
      zeile('r1', 'Sondertour HaMu MV'),
    ])
    expect(betroffen).toEqual([
      { routeId: 'r1', routeName: 'Sondertour HaMu MV', stops: 3 },
      { routeId: 'r2', routeName: 'Tour vom 28.08.2026', stops: 1 },
    ])
  })

  it('stellt die schwerste Auswirkung nach vorn', () => {
    const betroffen = groupAffectedRoutes([
      zeile('r1', 'Eine'),
      zeile('r2', 'Zwei'),
      zeile('r2', 'Zwei'),
    ])
    expect(betroffen.map((r) => r.routeName)).toEqual(['Zwei', 'Eine'])
  })

  it('sortiert bei Gleichstand stabil nach Namen', () => {
    const einmal = groupAffectedRoutes([zeile('r1', 'Beta'), zeile('r2', 'Alpha')])
    const andersherum = groupAffectedRoutes([zeile('r2', 'Alpha'), zeile('r1', 'Beta')])
    expect(einmal).toEqual(andersherum)
    expect(einmal.map((r) => r.routeName)).toEqual(['Alpha', 'Beta'])
  })

  it('verschweigt eine unsichtbare Route nicht, erfindet aber keinen Namen', () => {
    // Der Stopp geht verloren, auch wenn die Route selbst nicht sichtbar ist.
    const betroffen = groupAffectedRoutes([zeile('r9', null)])
    expect(betroffen).toEqual([{ routeId: 'r9', routeName: 'Nicht sichtbare Route', stops: 1 }])
  })

  it('meldet nichts, wenn nichts betroffen ist', () => {
    expect(groupAffectedRoutes([])).toEqual([])
  })
})
