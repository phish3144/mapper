import { describe, expect, it } from 'vitest'
import {
  buildAddressIndex,
  checkMatch,
  findByPoint,
  findByText,
  locationName,
  needsReview,
  normalizeAddressKey,
  orderedUnique,
  parseAddressLines,
  tourName,
} from './quickTour'
import type { AddressLookup, AddressMatch } from '@/lib/geocode'
import type { MapLocation } from '@/types/domain'

function ort(patch: Partial<MapLocation> & Pick<MapLocation, 'id' | 'name' | 'lat' | 'lng'>): MapLocation {
  return {
    workspace_id: 'w',
    category_id: null,
    icon: null,
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
    ...patch,
  }
}

function treffer(patch: Partial<AddressMatch> & Pick<AddressMatch, 'lat' | 'lng'>): AddressMatch {
  return {
    label: 'irgendwo',
    type: 'house',
    boundingBox: null,
    houseNumber: '5',
    road: 'Bahnhofstrasse',
    precision: 'exact',
    note: null,
    ...patch,
  }
}

function lookup(matches: AddressMatch[], problem: AddressLookup['problem'] = null): AddressLookup {
  return { matches, problem }
}

describe('parseAddressLines', () => {
  it('wirft leere Zeilen und Dubletten ohne Rücksicht auf Schreibweise weg', () => {
    const { lines, rest } = parseAddressLines(
      'Bahnhofstr. 5, 29336 Nienhagen\n\n   \nBAHNHOFSTR. 5, 29336 NIENHAGEN\nDorfstr. 1, 12345 Musterdorf',
    )
    expect(lines).toEqual(['Bahnhofstr. 5, 29336 Nienhagen', 'Dorfstr. 1, 12345 Musterdorf'])
    expect(rest).toEqual([])
  })

  it('kappt bei der Obergrenze und gibt den Rest zurück, statt ihn zu verlieren', () => {
    const eingabe = Array.from({ length: 7 }, (_, i) => `Weg ${i + 1}, 12345 Ort`).join('\n')
    const { lines, rest } = parseAddressLines(eingabe, 5)
    expect(lines).toHaveLength(5)
    expect(rest).toEqual(['Weg 6, 12345 Ort', 'Weg 7, 12345 Ort'])
  })

  it('liest auch Zeilen mit Wagenrücklauf', () => {
    expect(parseAddressLines('Eins, 12345 Ort\r\nZwei, 12345 Ort').lines).toHaveLength(2)
  })
})

describe('normalizeAddressKey', () => {
  it('glättet Satzzeichen, Abstände und Großschreibung', () => {
    expect(normalizeAddressKey('Bahnhofstr. 5,  29336   Nienhagen')).toBe('bahnhofstr 5 29336 nienhagen')
  })

  it('hält verschiedene Schreibweisen des Straßennamens auseinander', () => {
    expect(normalizeAddressKey('Bahnhofstr. 5')).not.toBe(normalizeAddressKey('Bahnhofstrasse 5'))
  })
})

describe('findByText', () => {
  const bestand = [
    ort({ id: 'a', name: 'Kunde Meier', lat: 52.5, lng: 13.4, address: 'Bahnhofstr. 5, 29336 Nienhagen' }),
    ort({ id: 'b', name: 'Dorfstr. 1, 12345 Musterdorf', lat: 51, lng: 10 }),
  ]
  const index = buildAddressIndex(bestand)

  it('findet über die Adresse', () => {
    expect(findByText('bahnhofstr 5, 29336 nienhagen', index)?.id).toBe('a')
  })

  it('findet über den Namen, wenn keine Adresse gepflegt ist', () => {
    expect(findByText('Dorfstr. 1, 12345 Musterdorf', index)?.id).toBe('b')
  })

  it('findet nichts bei abweichender Schreibweise', () => {
    expect(findByText('Bahnhofstrasse 5, 29336 Nienhagen', index)).toBeNull()
  })
})

describe('findByPoint', () => {
  const bestand = [ort({ id: 'a', name: 'Vorhanden', lat: 52.5, lng: 13.4 })]

  it('erkennt denselben Fleck', () => {
    // rund 22 m noerdlich
    expect(findByPoint({ lat: 52.5002, lng: 13.4 }, bestand)?.id).toBe('a')
  })

  it('hält den Nachbarn auseinander', () => {
    // rund 220 m noerdlich
    expect(findByPoint({ lat: 52.502, lng: 13.4 }, bestand)).toBeNull()
  })

  it('nimmt den nächsten, wenn mehrere in Reichweite liegen', () => {
    const zwei = [...bestand, ort({ id: 'b', name: 'Näher', lat: 52.5001, lng: 13.4 })]
    expect(findByPoint({ lat: 52.50012, lng: 13.4 }, zwei)?.id).toBe('b')
  })
})

describe('checkMatch', () => {
  it('nennt den Grund, wenn nichts gefunden wurde', () => {
    expect(checkMatch(lookup([], 'rate-limit'))).toEqual({
      match: null,
      hint: 'Der Adressdienst hat gedrosselt - später noch einmal versuchen.',
    })
  })

  it('reicht den Genauigkeitshinweis des Geocoders durch', () => {
    const ergebnis = checkMatch(
      lookup([treffer({ lat: 52.5, lng: 13.4, note: 'Hausnummer nicht gefunden — Straßenmitte' })]),
    )
    expect(ergebnis.hint).toBe('Hausnummer nicht gefunden — Straßenmitte')
  })

  it('schweigt bei einem sauberen Treffer', () => {
    expect(checkMatch(lookup([treffer({ lat: 52.5, lng: 13.4 })])).hint).toBeNull()
  })

  it('meldet Mehrdeutigkeit, wenn der zweite Treffer weit weg liegt', () => {
    const ergebnis = checkMatch(
      lookup([treffer({ lat: 52.5, lng: 13.4 }), treffer({ lat: 48.1, lng: 11.6 })]),
    )
    expect(ergebnis.hint).toContain('Mehrdeutig')
  })

  it('schweigt, wenn der zweite Treffer nebenan liegt', () => {
    const ergebnis = checkMatch(
      lookup([treffer({ lat: 52.5, lng: 13.4 }), treffer({ lat: 52.51, lng: 13.41 })]),
    )
    expect(ergebnis.hint).toBeNull()
  })

  it('warnt bei einem Treffer außerhalb des deutschsprachigen Raums', () => {
    const ergebnis = checkMatch(lookup([treffer({ lat: 52.2, lng: 21.0 })]))
    expect(ergebnis.hint).toContain('außerhalb')
    // Verworfen wird er trotzdem nicht - der Nutzer entscheidet.
    expect(ergebnis.match).not.toBeNull()
  })
})

describe('needsReview', () => {
  it('hält eine Zeile ohne Ort und ohne Postleitzahl für prüfenswert', () => {
    expect(needsReview('Am Markt 2')).toBe(true)
  })

  it('lässt eine vollständige Adresse durch', () => {
    expect(needsReview('Am Markt 2, 29336 Nienhagen')).toBe(false)
  })
})

describe('locationName', () => {
  it('kürzt auf die im Schema erlaubten 160 Zeichen', () => {
    const name = locationName('x'.repeat(200))
    expect(name).toHaveLength(160)
    expect(name.endsWith('…')).toBe(true)
  })

  it('lässt kurze Namen unangetastet', () => {
    expect(locationName('  Bahnhofstr. 5, 29336 Nienhagen  ')).toBe('Bahnhofstr. 5, 29336 Nienhagen')
  })
})

describe('tourName', () => {
  it('nennt den Tag zweistellig', () => {
    expect(tourName(new Date(2026, 7, 3))).toBe('Tour vom 03.08.2026')
  })
})

describe('orderedUnique', () => {
  it('hält die Reihenfolge und wirft Wiederholungen weg', () => {
    expect(orderedUnique(['a', 'b', 'a', '', 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })
})
