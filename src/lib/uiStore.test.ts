/**
 * Der Oberflaechenzustand rund um die angezeigte Strecke.
 *
 * Geprueft wird hier vor allem eine Regel, die man beim Lesen des Codes leicht
 * uebersieht: das Leeren der Adresssuche raeumt die Strecke weg - aber nur die
 * Strecke, die zur Suche gehoert.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { RoutePreview, UiStore } from './uiStore'

/**
 * uiStore liest beim Laden das Thema aus localStorage. Die Tests laufen in
 * node, dort gibt es das nicht - ein winziger Ersatz genuegt, geprueft wird
 * die Strecke und nicht die Themenwahl.
 */
let useUi: UiStore

beforeAll(async () => {
  const werte = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => werte.get(k) ?? null,
    setItem: (k: string, v: string) => void werte.set(k, v),
    removeItem: (k: string) => void werte.delete(k),
    clear: () => werte.clear(),
    key: () => null,
    length: 0,
  }
  useUi = (await import('./uiStore')).useUi
})

const HANNOVER = { lat: 52.37, lng: 9.73 }
const BERLIN = { lat: 52.52, lng: 13.4 }

function strecke(patch: Partial<RoutePreview> = {}): RoutePreview {
  return {
    from: HANNOVER,
    fromLabel: 'Hannover',
    to: BERLIN,
    toLabel: 'Berlin',
    locationId: null,
    ...patch,
  }
}

beforeEach(() => {
  useUi.setState({ routePreview: null, routeOrigin: null, searchPoint: null, focus: null })
})

describe('starteRoute', () => {
  it('zeigt die Strecke und holt beide Enden in den Ausschnitt', () => {
    useUi.getState().starteRoute(strecke())
    const s = useUi.getState()
    expect(s.routePreview?.toLabel).toBe('Berlin')
    expect(s.focus?.points).toEqual([HANNOVER, BERLIN])
  })

  it('schliesst die offene Zielwahl', () => {
    useUi.setState({ routeOrigin: { point: HANNOVER, label: 'Hannover', locationId: 'l1' } })
    useUi.getState().starteRoute(strecke())
    expect(useUi.getState().routeOrigin).toBeNull()
  })
})

describe('setSearchPoint', () => {
  it('raeumt beim Leeren die Strecke der Suche weg', () => {
    useUi.setState({ routePreview: strecke({ belongsToSearch: true }) })
    useUi.getState().setSearchPoint(null)
    expect(useUi.getState().routePreview).toBeNull()
  })

  it('laesst eine Strecke zwischen zwei Standorten stehen', () => {
    // Sie haengt nicht an der Suche. Verschwaende sie mit ihr, waere das fuer
    // die Anwenderin ein Fehler ohne erkennbaren Anlass.
    useUi.setState({ routePreview: strecke() })
    useUi.getState().setSearchPoint(null)
    expect(useUi.getState().routePreview?.toLabel).toBe('Berlin')
  })

  it('behaelt die Strecke, solange ein Bezugspunkt gesetzt wird', () => {
    useUi.setState({ routePreview: strecke({ belongsToSearch: true }) })
    useUi.getState().setSearchPoint({ lat: 50.1, lng: 8.7, label: 'Frankfurt' })
    expect(useUi.getState().routePreview).not.toBeNull()
  })
})
