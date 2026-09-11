import { describe, expect, it } from 'vitest'
import { bereich, linie, zeitraumText, standZeit } from './traffic'
import type { Verkehrsmeldung } from './traffic'

function meldung(overrides: Partial<Verkehrsmeldung> = {}): Verkehrsmeldung {
  return { k: 'c', r: 'A3', t: 'Vollsperrung', s: 'AS Koeln-Ost', lat: 50.9, lng: 7.1, ...overrides }
}

describe('linie', () => {
  it('macht aus der flachen Folge Paare in Leaflet-Reihenfolge', () => {
    expect(linie([50.1, 7.2, 50.3, 7.4])).toEqual([
      [50.1, 7.2],
      [50.3, 7.4],
    ])
  })

  it('gibt ohne Geometrie eine leere Liste', () => {
    expect(linie(undefined)).toEqual([])
  })

  it('verwirft ein angebrochenes letztes Paar, statt es zu raten', () => {
    expect(linie([50.1, 7.2, 50.3])).toEqual([[50.1, 7.2]])
  })
})

describe('bereich', () => {
  it('nimmt ohne Linie den Punkt selbst', () => {
    expect(bereich(meldung({ lat: 50.9, lng: 7.1, g: undefined }))).toEqual([50.9, 7.1, 50.9, 7.1])
  })

  it('umfasst alle Punkte der Linie', () => {
    const m = meldung({ lat: 50.5, lng: 7.5, g: [50.1, 7.9, 50.9, 7.2, 50.4, 7.0] })
    expect(bereich(m)).toEqual([50.1, 7.0, 50.9, 7.9])
  })

  it('schliesst den Meldepunkt mit ein, auch wenn er ausserhalb der Linie liegt', () => {
    // Die Quelle setzt den Punkt gelegentlich neben den Abschnitt. Faellt er
    // aus dem Rahmen, verschwaende die Meldung beim Zuschnitt auf den
    // Kartenausschnitt.
    const m = meldung({ lat: 51.5, lng: 6.0, g: [50.1, 7.0, 50.2, 7.1] })
    expect(bereich(m)).toEqual([50.1, 6.0, 51.5, 7.1])
  })
})

describe('zeitraumText', () => {
  it('nennt beide Enden', () => {
    expect(zeitraumText('01.02.2026|05.02.2026')).toBe('01.02.2026 bis 05.02.2026')
  })

  it('sagt "ab", wenn nur der Beginn bekannt ist', () => {
    expect(zeitraumText('01.02.2026|')).toBe('ab 01.02.2026')
  })

  it('sagt "bis", wenn nur das Ende bekannt ist', () => {
    expect(zeitraumText('|05.02.2026')).toBe('bis 05.02.2026')
  })

  it('gibt null statt eines geratenen Zeitraums', () => {
    expect(zeitraumText(undefined)).toBeNull()
    expect(zeitraumText('|')).toBeNull()
    expect(zeitraumText('  |  ')).toBeNull()
  })
})

describe('standZeit', () => {
  it('gibt die Uhrzeit zweistellig aus', () => {
    expect(standZeit('2026-02-01T09:05:00Z')).toMatch(/^\d{2}:\d{2}$/)
  })

  it('bleibt bei unbrauchbarem Zeitstempel ruhig', () => {
    expect(standZeit('gar kein Datum')).toBe('?')
  })
})
