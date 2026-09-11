import { describe, expect, it } from 'vitest'
import { MAX_ENTRIES, entryKey, mergeEntry, parseHistory, type SearchEntry } from './searchHistory'

function eintrag(label: string, lat: number, lng: number, at = 1): SearchEntry {
  return { label, lat, lng, at }
}

describe('entryKey', () => {
  it('nennt dieselbe Lage gleich, auch bei mehr Nachkommastellen', () => {
    expect(entryKey({ lat: 52.37901, lng: 9.74102 })).toBe(entryKey({ lat: 52.37899, lng: 9.74098 }))
  })

  it('trennt Orte, die wirklich auseinanderliegen', () => {
    expect(entryKey({ lat: 52.379, lng: 9.741 })).not.toBe(entryKey({ lat: 52.38, lng: 9.741 }))
  })
})

describe('mergeEntry', () => {
  it('setzt den neuen Eintrag nach vorn', () => {
    const vorher = [eintrag('Berlin', 52.52, 13.4)]
    const nachher = mergeEntry(vorher, eintrag('Hannover', 52.37, 9.73, 2))
    expect(nachher.map((e) => e.label)).toEqual(['Hannover', 'Berlin'])
  })

  it('verdraengt dieselbe Lage, statt sie doppelt zu fuehren', () => {
    const vorher = [eintrag('Georgstr. 10', 52.379, 9.741), eintrag('Berlin', 52.52, 13.4)]
    const nachher = mergeEntry(vorher, eintrag('Georgstraße 10, Hannover', 52.37902, 9.74098, 2))
    expect(nachher).toHaveLength(2)
    // Die neuere Schreibweise gewinnt - sie kommt vom aktuellen Dienst.
    expect(nachher[0].label).toBe('Georgstraße 10, Hannover')
  })

  it('bleibt bei hoechstens MAX_ENTRIES', () => {
    let liste: SearchEntry[] = []
    for (let i = 0; i < MAX_ENTRIES + 4; i++) liste = mergeEntry(liste, eintrag(`Ort ${i}`, 50 + i, 8, i))
    expect(liste).toHaveLength(MAX_ENTRIES)
    expect(liste[0].label).toBe(`Ort ${MAX_ENTRIES + 3}`)
    // Die aeltesten sind weg, nicht die neuesten.
    expect(liste.some((e) => e.label === 'Ort 0')).toBe(false)
  })

  it('aendert die uebergebene Liste nicht', () => {
    const vorher = [eintrag('Berlin', 52.52, 13.4)]
    mergeEntry(vorher, eintrag('Hannover', 52.37, 9.73, 2))
    expect(vorher).toHaveLength(1)
  })
})

describe('parseHistory', () => {
  it('liest zurueck, was geschrieben wurde', () => {
    const liste = [eintrag('Hannover', 52.37, 9.73, 5)]
    expect(parseHistory(JSON.stringify(liste))).toEqual(liste)
  })

  it('gibt bei fehlendem oder kaputtem Inhalt eine leere Liste', () => {
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('kein JSON')).toEqual([])
    expect(parseHistory('{"nicht":"eine Liste"}')).toEqual([])
  })

  it('wirft unbrauchbare Eintraege raus und behaelt die guten', () => {
    const roh = JSON.stringify([
      { label: 'Gut', lat: 52.37, lng: 9.73, at: 1 },
      { label: '', lat: 52.4, lng: 9.8, at: 2 },
      { label: 'Ohne Lage', lat: null, lng: 9.8, at: 3 },
      { label: 'Auch gut', lat: 52.52, lng: 13.4, at: 4 },
    ])
    expect(parseHistory(roh).map((e) => e.label)).toEqual(['Gut', 'Auch gut'])
  })

  it('entfernt Dubletten derselben Lage', () => {
    // Gleich bis auf die fuenfte Stelle - das ist unter einem Meter und
    // damit derselbe Ort. Ab der vierten Stelle (rund 11 m) trennt der
    // Schluessel bewusst, dort stehen schon zwei Hausnummern.
    const roh = JSON.stringify([
      { label: 'Erst', lat: 52.37901, lng: 9.74102, at: 2 },
      { label: 'Dasselbe', lat: 52.37898, lng: 9.74099, at: 1 },
    ])
    expect(parseHistory(roh).map((e) => e.label)).toEqual(['Erst'])
  })

  it('kuerzt eine zu lang gewordene Liste', () => {
    const roh = JSON.stringify(
      Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => ({ label: `Ort ${i}`, lat: 50 + i, lng: 8, at: i })),
    )
    expect(parseHistory(roh)).toHaveLength(MAX_ENTRIES)
  })
})
