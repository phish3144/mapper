import { describe, expect, it } from 'vitest'
import { photonExtent, photonFeatures, photonLabel, photonSearchUrl, photonToHit } from './photon'

/** Aufbau einer echten Photon-Antwort. */
function feature(properties: Record<string, unknown>, coordinates: unknown = [10.0977607, 52.5619346]) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties }
}

describe('photonLabel', () => {
  it('setzt die Bestandteile in deutscher Schreibweise zusammen', () => {
    expect(
      photonLabel({
        housenumber: '14',
        street: 'Horstwiesen',
        postcode: '29336',
        city: 'Nienhagen',
        state: 'Niedersachsen',
        country: 'Deutschland',
      }),
    ).toBe('Horstwiesen 14, 29336 Nienhagen, Niedersachsen, Deutschland')
  })

  it('stellt einen Eigennamen voran, wiederholt aber die Strasse nicht', () => {
    expect(photonLabel({ name: 'Decathlon', street: 'Moenckebergstrasse', housenumber: '1', city: 'Hamburg' }))
      .toBe('Decathlon, Moenckebergstrasse 1, Hamburg')
    // Heisst der Treffer wie die Strasse, waere die Wiederholung nur Laerm.
    expect(photonLabel({ name: 'Horstwiesen', street: 'Horstwiesen', city: 'Nienhagen' }))
      .toBe('Horstwiesen, Nienhagen')
  })

  it('kommt mit fehlenden Angaben zurecht', () => {
    expect(photonLabel({ city: 'Nienhagen' })).toBe('Nienhagen')
    expect(photonLabel({})).toBe('Unbenannter Ort')
  })
})

describe('photonExtent', () => {
  it('liest die Reihenfolge [west, north, east, south]', () => {
    // Nachgemessen an einer echten Antwort fuer Nienhagen.
    expect(photonExtent([10.0539612, 52.5700095, 10.1386769, 52.5072821])).toEqual({
      west: 10.0539612,
      north: 52.5700095,
      east: 10.1386769,
      south: 52.5072821,
    })
  })

  it('weist Unbrauchbares ab, statt ein verdrehtes Rechteck zu liefern', () => {
    expect(photonExtent(undefined)).toBeNull()
    expect(photonExtent([1, 2, 3])).toBeNull()
    expect(photonExtent(['a', 2, 3, 1])).toBeNull()
    // Norden unterhalb von Sueden waere ein vertauschtes Rechteck.
    expect(photonExtent([10, 52.0, 11, 52.9])).toBeNull()
  })
})

describe('photonToHit', () => {
  it('wandelt ein Hausmerkmal samt Hausnummer und Strasse um', () => {
    const hit = photonToHit(
      feature({ housenumber: '14', street: 'Horstwiesen', postcode: '29336', city: 'Nienhagen', osm_value: 'house' }),
    )
    expect(hit).not.toBeNull()
    // GeoJSON fuehrt die Laenge zuerst - hier darf nichts vertauscht werden.
    expect(hit?.lat).toBeCloseTo(52.5619346, 6)
    expect(hit?.lng).toBeCloseTo(10.0977607, 6)
    expect(hit?.houseNumber).toBe('14')
    expect(hit?.road).toBe('Horstwiesen')
    expect(hit?.type).toBe('house')
  })

  it('laesst Hausnummer und Strasse null, wenn der Treffer keine hat', () => {
    const hit = photonToHit(feature({ name: 'Nienhagen', osm_value: 'village' }))
    expect(hit?.houseNumber).toBeNull()
    expect(hit?.road).toBeNull()
  })

  it('weist unbrauchbare Merkmale ab', () => {
    expect(photonToHit(null)).toBeNull()
    expect(photonToHit({})).toBeNull()
    expect(photonToHit(feature({}, [10]))).toBeNull()
    expect(photonToHit(feature({}, ['a', 'b']))).toBeNull()
    expect(photonToHit(feature({}, [999, 999]))).toBeNull()
  })

  it('nimmt die Nullinsel als gueltigen Punkt an', () => {
    expect(photonToHit(feature({ name: 'Nullinsel' }, [0, 0]))?.lat).toBe(0)
  })
})

describe('photonFeatures', () => {
  it('holt die Liste heraus und vertraegt Muell', () => {
    expect(photonFeatures({ features: [1, 2] })).toEqual([1, 2])
    expect(photonFeatures({ features: 'nein' })).toEqual([])
    expect(photonFeatures(null)).toEqual([])
    expect(photonFeatures([])).toEqual([])
  })
})

describe('photonSearchUrl', () => {
  it('kodiert die Anfrage und setzt die Sprache', () => {
    const url = new URL(photonSearchUrl('Horstwiesen 14, 29336 Nienhagen', 5))
    expect(url.pathname).toBe('/api')
    expect(url.searchParams.get('q')).toBe('Horstwiesen 14, 29336 Nienhagen')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('lang')).toBe('de')
  })
})
