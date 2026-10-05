import { describe, expect, it } from 'vitest'
import {
  MAX_WAYPOINTS,
  koordinatenText,
  navigationUrl,
  navigationUrlTo,
  tourNavigationUrls,
} from './navigation'

const HANNOVER = { lat: 52.3759, lng: 9.732 }
const BERLIN = { lat: 52.52, lng: 13.405 }

describe('navigationUrl', () => {
  it('baut eine Google-Maps-Adresse mit Start, Ziel und Fahrprofil', () => {
    const url = new URL(navigationUrl(HANNOVER, BERLIN))
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/')
    expect(url.searchParams.get('api')).toBe('1')
    expect(url.searchParams.get('origin')).toBe('52.375900,9.732000')
    expect(url.searchParams.get('destination')).toBe('52.520000,13.405000')
    expect(url.searchParams.get('travelmode')).toBe('driving')
  })

  it('übergibt reine Koordinaten', () => {
    // Ein Standortname wie "Bisol GmbH - Team Hannover" ist keine Adresse und
    // wuerde dort neu und womoeglich falsch gesucht. Start und Ziel duerfen
    // deshalb nichts als Zahlen enthalten.
    const url = new URL(navigationUrl(HANNOVER, BERLIN))
    for (const feld of ['origin', 'destination']) {
      expect(url.searchParams.get(feld)).toMatch(/^-?\d+\.\d{6},-?\d+\.\d{6}$/)
    }
  })

  it('hält die Reihenfolge ein - Start ist Start', () => {
    const hin = new URL(navigationUrl(HANNOVER, BERLIN))
    const zurueck = new URL(navigationUrl(BERLIN, HANNOVER))
    expect(hin.searchParams.get('origin')).toBe(zurueck.searchParams.get('destination'))
    expect(hin.searchParams.get('destination')).toBe(zurueck.searchParams.get('origin'))
  })

  it('rundet auf sechs Stellen - mehr ist bei einer Adresse Schein', () => {
    const url = new URL(navigationUrl({ lat: 52.1234567891, lng: 9.9876543219 }, BERLIN))
    expect(url.searchParams.get('origin')).toBe('52.123457,9.987654')
  })
})

describe('navigationUrlTo', () => {
  it('laesst den Start weg, damit Google den Standort des Geraets nimmt', () => {
    const url = new URL(navigationUrlTo(BERLIN))
    expect(url.searchParams.has('origin')).toBe(false)
    expect(url.searchParams.get('destination')).toBe('52.520000,13.405000')
    expect(url.searchParams.get('travelmode')).toBe('driving')
  })
})

describe('tourNavigationUrls', () => {
  const stopps = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 50 + i / 100, lng: 9 + i / 100 }))
  const teile = (u: string) => {
    const url = new URL(u)
    const wp = url.searchParams.get('waypoints')
    return [url.searchParams.get('origin'), ...(wp ? wp.split('|') : []), url.searchParams.get('destination')]
  }

  it('gibt fuer keinen Stopp nichts und fuer einen die Navigation dorthin', () => {
    expect(tourNavigationUrls([])).toEqual([])
    expect(tourNavigationUrls([BERLIN])).toEqual([navigationUrlTo(BERLIN)])
  })

  it('passt bis zu elf Stopps in einen Verweis', () => {
    expect(tourNavigationUrls(stopps(2))).toHaveLength(1)
    const urls = tourNavigationUrls(stopps(MAX_WAYPOINTS + 2))
    expect(urls).toHaveLength(1)
    expect(teile(urls[0])).toHaveLength(MAX_WAYPOINTS + 2)
  })

  it('teilt laengere Touren so, dass jeder Abschnitt am Ende des vorigen beginnt', () => {
    const punkte = stopps(25)
    const urls = tourNavigationUrls(punkte)
    expect(urls.length).toBe(3)
    const abschnitte = urls.map(teile)
    for (let i = 1; i < abschnitte.length; i++) {
      expect(abschnitte[i][0]).toBe(abschnitte[i - 1][abschnitte[i - 1].length - 1])
    }
    // Zusammengesetzt ergeben die Abschnitte genau die Tour, jeder Stopp einmal.
    const alle = abschnitte.flatMap((a, i) => (i === 0 ? a : a.slice(1)))
    expect(alle).toEqual(punkte.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`))
    for (const a of abschnitte) expect(a.length - 2).toBeLessThanOrEqual(MAX_WAYPOINTS)
  })

  it('bleibt unter der Laengengrenze von Google', () => {
    for (const u of tourNavigationUrls(stopps(40))) expect(u.length).toBeLessThan(2048)
  })
})

describe('koordinatenText', () => {
  it('schreibt Punkt als Dezimaltrenner, damit Google es beim Einfuegen versteht', () => {
    expect(koordinatenText({ lat: 52.4807349, lng: 13.4418912 })).toBe('52.480735, 13.441891')
  })
})
