import { describe, expect, it } from 'vitest'
import { looksLikeKml, parseCoordinates, parseKml, parseKmz, parseXml, stripHtml } from './kml'

/** Aufbau wie ihn Google My Maps ausgibt: Document > Folder (Ebene) > Placemark. */
const MY_MAPS = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Aussendienst 2026</name>
    <Folder>
      <name>Kunden Nord</name>
      <Placemark>
        <name>M&#252;ller &amp; S&#246;hne</name>
        <description><![CDATA[<b>Ansprechpartner</b><br>Frau Schmidt<br>Tel. 040 123]]></description>
        <ExtendedData>
          <Data name="Adresse"><value>Hauptstr. 1, 20095 Hamburg</value></Data>
          <Data name="Kategorie"><value>Filiale</value></Data>
          <Data name="Umsatz"><value>12000</value></Data>
        </ExtendedData>
        <Point><coordinates>9.9937,53.5511,0</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>Lager Altona</name>
        <Point><coordinates>9.9350,53.5500</coordinates></Point>
      </Placemark>
    </Folder>
    <Folder>
      <name>Routen</name>
      <Placemark>
        <name>Tour A</name>
        <LineString><coordinates>9.99,53.55 10.01,53.57</coordinates></LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>`

describe('parseKml', () => {
  it('liest Platzmarken samt Ebene, Adresse und Beschreibung', () => {
    const result = parseKml(MY_MAPS)
    expect(result.mapName).toBe('Aussendienst 2026')
    expect(result.rows).toHaveLength(2)

    const [erste] = result.rows
    expect(erste.name).toBe('Müller & Söhne')
    // KML fuehrt die Laenge zuerst - hier darf nichts vertauscht werden.
    expect(erste.lat).toBeCloseTo(53.5511, 4)
    expect(erste.lng).toBeCloseTo(9.9937, 4)
    expect(erste.groupNames).toEqual(['Kunden Nord'])
    expect(erste.address).toBe('Hauptstr. 1, 20095 Hamburg')
    expect(erste.categoryName).toBe('Filiale')
    expect(erste.notes).toContain('Ansprechpartner')
    expect(erste.notes).toContain('Frau Schmidt')
    // Unbekannte Zusatzspalten landen als Notizzeile, statt verloren zu gehen.
    expect(erste.notes).toContain('Umsatz: 12000')
    // HTML darf nicht durchschlagen.
    expect(erste.notes).not.toContain('<b>')
  })

  it('nimmt Koordinaten auch ohne Hoehenangabe an', () => {
    const result = parseKml(MY_MAPS)
    expect(result.rows[1]).toMatchObject({ name: 'Lager Altona' })
    expect(result.rows[1].lat).toBeCloseTo(53.55, 4)
  })

  it('sammelt die Ebenennamen und ueberspringt Linien mit Begruendung', () => {
    const result = parseKml(MY_MAPS)
    expect(result.layerNames).toEqual(['Kunden Nord', 'Routen'])
    expect(result.skippedShapes).toBe(1)
    expect(result.errors.join(' ')).toContain('Tour A')
    expect(result.errors.join(' ')).toContain('Linien und Flaechen')
  })

  it('versteht Namensraum-Praefixe', () => {
    const text = `<kml:kml xmlns:kml="http://www.opengis.net/kml/2.2"><kml:Document>
      <kml:Placemark><kml:name>Mit Praefix</kml:name>
      <kml:Point><kml:coordinates>13.405,52.52</kml:coordinates></kml:Point>
      </kml:Placemark></kml:Document></kml:kml>`
    const result = parseKml(text)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Mit Praefix')
    expect(result.rows[0].lng).toBeCloseTo(13.405, 3)
  })

  it('findet den Punkt auch in einer MultiGeometry', () => {
    const text = `<kml><Document><Placemark><name>Gemischt</name><MultiGeometry>
      <LineString><coordinates>1,1 2,2</coordinates></LineString>
      <Point><coordinates>7.5,51.5</coordinates></Point>
      </MultiGeometry></Placemark></Document></kml>`
    const result = parseKml(text)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].lat).toBeCloseTo(51.5, 3)
  })

  it('vergibt einen Ersatznamen und meldet unbrauchbare Koordinaten', () => {
    const text = `<kml><Document>
      <Placemark><Point><coordinates>8.0,50.0</coordinates></Point></Placemark>
      <Placemark><name>Kaputt</name><Point><coordinates>999,999</coordinates></Point></Placemark>
      </Document></kml>`
    const result = parseKml(text)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Platzmarke 1')
    expect(result.errors.join(' ')).toContain('Kaputt')
  })

  it('meldet leere, fremde und unlesbare Dateien, ohne zu werfen', () => {
    expect(parseKml('').errors[0]).toContain('leer')
    expect(parseKml('kein xml').errors[0]).toMatch(/XML|Wurzelelement/)
    expect(parseKml('<gpx><wpt/></gpx>').errors[0]).toContain('Wurzelelement')
    expect(parseKml('<kml><Document></Document></kml>').errors[0]).toContain('keine Platzmarken')
  })

  it('laesst sich von einem verirrten Endetag nicht aus dem Tritt bringen', () => {
    const text = `<kml><Document></fremd>
      <Placemark><name>Trotzdem da</name><Point><coordinates>6.9,50.9</coordinates></Point></Placemark>
      </Document></kml>`
    expect(parseKml(text).rows).toHaveLength(1)
  })
})

describe('Hilfsfunktionen', () => {
  it('parseCoordinates liest lng,lat und weist Unsinn ab', () => {
    expect(parseCoordinates('13.405,52.52,0')).toEqual({ lat: 52.52, lng: 13.405 })
    expect(parseCoordinates(' 13.405,52.52 ')).toEqual({ lat: 52.52, lng: 13.405 })
    expect(parseCoordinates('13.405')).toBeNull()
    expect(parseCoordinates('200,100')).toBeNull()
    expect(parseCoordinates('')).toBeNull()
    // 0,0 ist ein gueltiger Punkt und darf nicht als Luecke gelten.
    expect(parseCoordinates('0,0')).toEqual({ lat: 0, lng: 0 })
  })

  it('stripHtml macht aus einer My-Maps-Tabelle lesbare Zeilen', () => {
    const html = '<table><tr><td>Telefon</td><td>040 123</td></tr><tr><td>Ort</td><td>Hamburg</td></tr></table>'
    expect(stripHtml(html).split('\n')).toEqual(['Telefon: 040 123', 'Ort: Hamburg'])
    expect(stripHtml('')).toBe('')
  })

  it('parseXml behandelt CDATA woertlich und dekodiert sonst Entitaeten', () => {
    const node = parseXml('<a><b><![CDATA[roh &amp; ungefiltert]]></b><c>a &amp; b</c></a>')
    expect(node?.children[0].text).toBe('roh &amp; ungefiltert')
    expect(node?.children[1].text).toBe('a & b')
  })

  it('looksLikeKml erkennt KML und verwechselt es nicht mit GeoJSON', () => {
    expect(looksLikeKml(MY_MAPS)).toBe(true)
    expect(looksLikeKml('﻿<kml></kml>')).toBe(true)
    expect(looksLikeKml('{"type":"FeatureCollection"}')).toBe(false)
    expect(looksLikeKml('Name;Breite;Laenge')).toBe(false)
  })
})

// --- KMZ -------------------------------------------------------------------

/** Baut ein ZIP mit genau einem unkomprimierten Eintrag (Methode 0). */
function makeStoredZip(fileName: string, content: string): ArrayBuffer {
  const name = new TextEncoder().encode(fileName)
  const data = new TextEncoder().encode(content)
  const local = 30 + name.length + data.length
  const central = 46 + name.length
  const total = local + central + 22
  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 10, true)
  view.setUint16(8, 0, true) // Methode 0 = gespeichert
  view.setUint32(18, data.length, true)
  view.setUint32(22, data.length, true)
  view.setUint16(26, name.length, true)
  bytes.set(name, 30)
  bytes.set(data, 30 + name.length)

  const c = local
  view.setUint32(c, 0x02014b50, true)
  view.setUint16(c + 10, 0, true)
  view.setUint32(c + 20, data.length, true)
  view.setUint32(c + 24, data.length, true)
  view.setUint16(c + 28, name.length, true)
  view.setUint32(c + 42, 0, true)
  bytes.set(name, c + 46)

  const e = local + central
  view.setUint32(e, 0x06054b50, true)
  view.setUint16(e + 8, 1, true)
  view.setUint16(e + 10, 1, true)
  view.setUint32(e + 12, central, true)
  view.setUint32(e + 16, local, true)
  return buffer
}

describe('parseKmz', () => {
  it('packt ein Archiv aus und liest die enthaltene KML', async () => {
    const result = await parseKmz(makeStoredZip('doc.kml', MY_MAPS))
    expect(result.rows).toHaveLength(2)
    expect(result.mapName).toBe('Aussendienst 2026')
  })

  it('meldet ein Archiv ohne KML statt zu werfen', async () => {
    const result = await parseKmz(makeStoredZip('bild.png', 'nicht kml'))
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]).toContain('keine KML')
  })

  it('meldet eine beschaedigte Datei statt zu werfen', async () => {
    const result = await parseKmz(new TextEncoder().encode('gar kein zip').buffer as ArrayBuffer)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]).toMatch(/ZIP|beschaedigt/)
  })
})
