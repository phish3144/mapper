import { describe, expect, it } from 'vitest'
import { buildSearchSteps, cleanQuery, parseGermanAddress, precisionNote } from './address'

describe('cleanQuery', () => {
  it('entfernt Schlusskommata, Leerglieder und ueberfluessige Leerzeichen', () => {
    expect(cleanQuery('Horstwiesen 14, 29336, Nienhagen, Niedersachsen,')).toBe(
      'Horstwiesen 14, 29336, Nienhagen, Niedersachsen',
    )
    expect(cleanQuery('  A  ,,  B  ,  ')).toBe('A, B')
    expect(cleanQuery('   ')).toBe('')
    expect(cleanQuery(',,,')).toBe('')
  })
})

describe('parseGermanAddress', () => {
  it('zerlegt die gemeldete Adresse samt Schlusskomma und Bundesland', () => {
    const parts = parseGermanAddress('Horstwiesen 14, 29336, Nienhagen, Niedersachsen,')
    expect(parts.street).toBe('Horstwiesen')
    expect(parts.houseNumber).toBe('14')
    expect(parts.postalCode).toBe('29336')
    expect(parts.city).toBe('Nienhagen')
    // Das Bundesland ist fuer die Suche wertlos und darf nicht als Ort gelten.
    expect(parts.rest).toContain('Niedersachsen')
  })

  it('trennt Postleitzahl und Ort auch im selben Glied', () => {
    const parts = parseGermanAddress('Horstwiesen 14, 29336 Nienhagen')
    expect(parts.postalCode).toBe('29336')
    expect(parts.city).toBe('Nienhagen')
    expect(parts.houseNumber).toBe('14')
  })

  it('erkennt Hausnummern mit Buchstabe, Bereich und Schraegstrich', () => {
    expect(parseGermanAddress('Hauptstrasse 14a, 12345 Musterstadt').houseNumber).toBe('14a')
    expect(parseGermanAddress('Hauptstrasse 14-16, 12345 Musterstadt').houseNumber).toBe('14-16')
    expect(parseGermanAddress('Hauptstrasse 14/2, 12345 Musterstadt').houseNumber).toBe('14/2')
  })

  it('kommt mit vorangestellter Hausnummer zurecht', () => {
    const parts = parseGermanAddress('14 Horstwiesen, Nienhagen')
    expect(parts.street).toBe('Horstwiesen')
    expect(parts.houseNumber).toBe('14')
  })

  it('haelt eine Abkuerzung im Strassennamen unangetastet', () => {
    // Nominatim loest "Str." selbst auf - eigenes Umschreiben waere schaedlich.
    const parts = parseGermanAddress('Mönckebergstr. 1, 20095 Hamburg')
    expect(parts.street).toBe('Mönckebergstr.')
    expect(parts.houseNumber).toBe('1')
    expect(parts.city).toBe('Hamburg')
  })

  it('erkennt das Land und behandelt einen einzelnen Namen als Ort', () => {
    expect(parseGermanAddress('Hauptstrasse 1, 12345 Musterstadt, Deutschland').country).toBe('de')
    const nurOrt = parseGermanAddress('Nienhagen')
    expect(nurOrt.city).toBe('Nienhagen')
    expect(nurOrt.street).toBeNull()
  })

  it('liefert bei leerer Eingabe lauter Nullwerte statt zu werfen', () => {
    const parts = parseGermanAddress('   ,, ')
    expect(parts).toMatchObject({ street: null, houseNumber: null, postalCode: null, city: null })
  })
})

describe('buildSearchSteps', () => {
  it('geht vom Genauen zum Groben', () => {
    const steps = buildSearchSteps('Horstwiesen 14, 29336, Nienhagen, Niedersachsen,')
    expect(steps[0]).toMatchObject({ kind: 'free', precision: 'exact' })
    expect(steps[0].query).toBe('Horstwiesen 14, 29336, Nienhagen, Niedersachsen')

    const genauigkeiten = steps.map((s) => s.precision)
    // Nie grob vor genau.
    expect(genauigkeiten.indexOf('exact')).toBeLessThan(genauigkeiten.indexOf('street'))
    expect(genauigkeiten.indexOf('street')).toBeLessThan(genauigkeiten.indexOf('place'))
  })

  it('baut die strukturierte Anfrage ohne Bundesland', () => {
    const steps = buildSearchSteps('Horstwiesen 14, 29336, Nienhagen, Niedersachsen')
    const strukturiert = steps.find((s) => s.kind === 'structured' && s.precision === 'exact')
    expect(strukturiert?.params).toEqual({
      street: 'Horstwiesen 14',
      postalcode: '29336',
      city: 'Nienhagen',
    })
  })

  it('laesst die Hausnummer im Rueckfallschritt weg', () => {
    const steps = buildSearchSteps('Horstwiesen 14, 29336 Nienhagen')
    const strasse = steps.find((s) => s.precision === 'street' && s.kind === 'structured')
    expect(strasse?.params?.street).toBe('Horstwiesen')
  })

  it('erzeugt ohne Hausnummer keinen Strassenrueckfall', () => {
    const steps = buildSearchSteps('Horstwiesen, 29336 Nienhagen')
    expect(steps.some((s) => s.precision === 'street')).toBe(false)
    expect(steps.some((s) => s.precision === 'place')).toBe(true)
  })

  it('kommt bei einem blossen Ort ohne Lockerungsschritt aus', () => {
    // Wer nur einen Ort eingibt, bekommt einen Ort - das ist kein ungenauer
    // Treffer. Der 'place'-Schritt waere hier wortgleich mit dem strukturierten
    // 'exact'-Schritt und wird deshalb als Dopplung verworfen.
    const steps = buildSearchSteps('Nienhagen')
    expect(steps.map((s) => s.precision)).toEqual(['exact', 'exact'])
    expect(steps[1].params).toEqual({ city: 'Nienhagen' })
  })

  it('gibt bei leerer Eingabe keinen Schritt zurueck', () => {
    expect(buildSearchSteps('')).toEqual([])
    expect(buildSearchSteps('  ,  ')).toEqual([])
  })

  it('nimmt keinen Schritt doppelt auf', () => {
    const steps = buildSearchSteps('Horstwiesen 14, 29336 Nienhagen')
    const keys = steps.map((s) => (s.kind === 'free' ? `f:${s.query}` : `s:${JSON.stringify(s.params)}`))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('precisionNote', () => {
  it('benennt nur die ungenauen Faelle', () => {
    expect(precisionNote('exact')).toBeNull()
    expect(precisionNote('street')).toContain('Hausnummer')
    expect(precisionNote('place')).toContain('Ort')
  })
})
