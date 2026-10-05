import { describe, expect, it } from 'vitest'
import { navigationsPunkte, tourAbschnitte, tourAlsText } from './tourText'

const stopp = (i: number, extra: object = {}) => ({
  name: `Stopp ${i}`,
  address: null,
  lat: 52 + i / 100,
  lng: 13 + i / 100,
  ...extra,
})

describe('navigationsPunkte', () => {
  it('haengt bei einer Rundtour den Start ans Ende', () => {
    const p = navigationsPunkte([stopp(1), stopp(2)], true)
    expect(p).toHaveLength(3)
    expect(p[2]).toEqual(p[0])
  })
  it('laesst eine einfache Tour, wie sie ist', () => {
    expect(navigationsPunkte([stopp(1), stopp(2)], false)).toHaveLength(2)
  })
})

describe('tourAbschnitte', () => {
  it('nennt fuer jeden Abschnitt die Stopps, die er abdeckt', () => {
    const punkte = Array.from({ length: 25 }, (_, i) => stopp(i))
    expect(tourAbschnitte(punkte).map((a) => [a.von, a.bis])).toEqual([
      [1, 11],
      [11, 21],
      [21, 25],
    ])
  })
  it('kommt mit einem einzigen Stopp aus', () => {
    expect(tourAbschnitte([stopp(1)]).map((a) => [a.von, a.bis])).toEqual([[1, 1]])
  })
})

describe('tourAlsText', () => {
  it('listet die Stopps in Reihenfolge, mit Adresse oder Koordinaten und Ankunft', () => {
    const ankunft = new Date(2026, 9, 5, 9, 30)
    const text = tourAlsText({
      name: 'Tour vom 05.10.2026',
      stopps: [stopp(1, { address: 'Bahnhofstr. 5, 29336 Nienhagen', ankunft }), stopp(2)],
      rundtour: false,
      gesamtMeter: 25300,
      gesamtSekunden: 1740,
    })
    const zeilen = text.split('\n')
    expect(zeilen[0]).toBe('Tour vom 05.10.2026 — 2 Stopps')
    expect(zeilen).toContain('1. Stopp 1 — Bahnhofstr. 5, 29336 Nienhagen — an 09:30')
    expect(zeilen).toContain('2. Stopp 2 — 52.020000, 13.020000')
    expect(text).toContain('Gesamt: 25,3 km, 29 Min. Fahrt')
    expect(text).toMatch(/Navigation: https:\/\/www\.google\.com\/maps\/dir\/\?api=1/)
  })

  it('teilt lange Touren in benannte Abschnitte', () => {
    const text = tourAlsText({
      name: 'Lang',
      stopps: Array.from({ length: 14 }, (_, i) => stopp(i)),
      rundtour: false,
    })
    expect(text).toContain('Stopps 1–11: https://')
    expect(text).toContain('Stopps 11–14: https://')
  })

  it('sagt bei einer Rundtour, wohin es am Ende zurueckgeht', () => {
    const text = tourAlsText({ name: 'Rund', stopps: [stopp(1), stopp(2)], rundtour: true })
    expect(text).toContain('Zurück zu: Stopp 1')
  })
})
