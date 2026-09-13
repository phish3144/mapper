import { describe, expect, it } from 'vitest'
import { MAP_SYMBOLS, searchSymbols, symbolEmoji } from './symbols'

describe('searchSymbols', () => {
  it('findet dieselbe Beschriftung mit und ohne Umlaut', () => {
    // Die Beschriftungen tragen Umlaute ("Bürogebäude"). Wer "buero" tippt -
    // die Schreibweise, die vor der Umstellung galt - soll trotzdem finden.
    const mitUmlaut = searchSymbols('büro').map((s) => s.id)
    const ohneUmlaut = searchSymbols('buero').map((s) => s.id)
    expect(mitUmlaut.length).toBeGreaterThan(0)
    expect(ohneUmlaut).toEqual(mitUmlaut)
  })

  it('faltet auch das scharfe S', () => {
    const a = searchSymbols('straße').map((s) => s.id)
    const b = searchSymbols('strasse').map((s) => s.id)
    expect(a).toEqual(b)
  })

  it('gibt ohne Eingabe alle Symbole', () => {
    expect(searchSymbols('   ')).toEqual(MAP_SYMBOLS)
  })

  it('sucht auch in Kennung und Gruppe, nicht nur in der Beschriftung', () => {
    // 'werk' ist eine Kennung, 'Gebäude' eine Gruppe.
    expect(searchSymbols('werk').some((s) => s.id === 'werk')).toBe(true)
    expect(searchSymbols('gebäude').length).toBeGreaterThan(1)
  })

  it('findet nichts zu einer Eingabe, die es nicht gibt', () => {
    expect(searchSymbols('zzzzzz')).toEqual([])
  })
})

describe('Bestand', () => {
  it('hat eindeutige Kennungen', () => {
    const ids = MAP_SYMBOLS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('behält die Kennungen in ASCII - sie stehen so in der Datenbank', () => {
    // Die Beschriftungen dürfen Umlaute tragen, die Kennungen nicht: sie sind
    // in location.icon gespeichert. Eine Umstellung dort träfe den Bestand.
    for (const s of MAP_SYMBOLS) expect(s.id).toMatch(/^[a-z0-9_-]+$/)
  })

  it('gibt zu einer unbekannten Kennung ein Ersatzsymbol statt nichts', () => {
    expect(symbolEmoji('gibtesnicht')).toBeTruthy()
  })
})
