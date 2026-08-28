import { describe, expect, it } from 'vitest'
import type { Category, Group, MapLocation } from '@/types/domain'
import { CSV_BOM, CSV_HEADER, parseCsv, toCsv } from './csv'

function makeLocation(partial: Partial<MapLocation> = {}): MapLocation {
  return {
    id: 'loc-1',
    workspace_id: 'ws-1',
    category_id: null,
    name: 'Lager Nord',
    lat: 52.520008,
    lng: 13.404954,
    address: null,
    notes: null,
    service_minutes: 0,
    time_windows: [],
    tags: [],
    is_active: true,
    visibility: 'workspace',
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

function makeCategory(id: string, name: string): Category {
  return {
    id,
    workspace_id: 'ws-1',
    name,
    color: '#336699',
    icon: 'pin',
    description: null,
    sort_order: 0,
    visibility: 'workspace',
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function makeGroup(id: string, name: string): Group {
  return {
    id,
    workspace_id: 'ws-1',
    name,
    color: '#993366',
    description: null,
    sort_order: 0,
    visibility: 'workspace',
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

const NO_GROUPS = new Map<string, Group[]>()

describe('toCsv', () => {
  it('beginnt mit BOM und der vorgegebenen Kopfzeile', () => {
    const csv = toCsv([], [], NO_GROUPS)
    expect(csv.startsWith(CSV_BOM)).toBe(true)
    expect(csv.slice(CSV_BOM.length).split('\r\n')[0]).toBe(
      'Name;Kategorie;Gruppen;Breite;Laenge;Adresse;Notizen;Tags;Aufenthalt (min);Aktiv;Zeitfenster',
    )
    expect(CSV_HEADER).toHaveLength(11)
  })

  it('schreibt Koordinaten mit Komma und maskiert Sonderzeichen', () => {
    const csv = toCsv(
      [
        makeLocation({
          name: 'Lager "Nord"; Rampe 2',
          notes: 'Zeile 1\nZeile 2',
          service_minutes: 15,
          is_active: false,
          time_windows: [{ dow: 3, from: '08:00', to: '12:30' }],
        }),
      ],
      [],
      NO_GROUPS,
    )
    const body = csv.slice(CSV_BOM.length).split('\r\n')[1]
    expect(body).toContain('"Lager ""Nord""; Rampe 2"')
    expect(body).toContain(';52,520008;13,404954;')
    expect(body).toContain('"Zeile 1\nZeile 2"')
    expect(body).toContain(';nein;')
    expect(csv).toContain('Mi 08:00-12:30')
  })
})

describe('parseCsv', () => {
  it('liest den Export verlustfrei zurueck', () => {
    const locations = [
      makeLocation({
        id: 'loc-1',
        category_id: 'cat-1',
        name: 'Lager "Nord"; Rampe 2',
        address: 'Hauptstrasse 1; Hof',
        notes: 'Zeile 1\nZeile 2',
        tags: ['kunde', 'nord'],
        service_minutes: 20,
        time_windows: [
          { dow: 1, from: '08:00', to: '12:00' },
          { dow: 7, from: '10:00', to: '14:30' },
        ],
      }),
      makeLocation({
        id: 'loc-2',
        name: 'Depot Sued',
        lat: -33.8688,
        lng: 151.2093,
        is_active: false,
      }),
    ]
    const csv = toCsv(
      locations,
      [makeCategory('cat-1', 'Baustelle')],
      new Map([['loc-1', [makeGroup('grp-1', 'Team A'), makeGroup('grp-2', 'Team B')]]]),
    )
    const result = parseCsv(csv)
    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      {
        name: 'Lager "Nord"; Rampe 2',
        lat: 52.520008,
        lng: 13.404954,
        address: 'Hauptstrasse 1; Hof',
        notes: 'Zeile 1\nZeile 2',
        tags: ['kunde', 'nord'],
        serviceMinutes: 20,
        timeWindows: [
          { dow: 1, from: '08:00', to: '12:00' },
          { dow: 7, from: '10:00', to: '14:30' },
        ],
        categoryName: 'Baustelle',
        groupNames: ['Team A', 'Team B'],
        isActive: true,
      },
      {
        name: 'Depot Sued',
        lat: -33.8688,
        lng: 151.2093,
        tags: [],
        serviceMinutes: 0,
        timeWindows: [],
        groupNames: [],
        isActive: false,
      },
    ])
  })

  it('erkennt Komma und Tabulator als Trennzeichen', () => {
    const commaFile = 'Name,Latitude,Longitude\nHafen,52.5,13.4\n'
    const comma = parseCsv(commaFile)
    expect(comma.errors).toEqual([])
    expect(comma.rows[0]).toMatchObject({ name: 'Hafen', lat: 52.5, lng: 13.4 })

    const tabFile = 'Name\tBreite\tLänge\nHafen\t52,5\t13,4\n'
    const tab = parseCsv(tabFile)
    expect(tab.errors).toEqual([])
    expect(tab.rows[0]).toMatchObject({ name: 'Hafen', lat: 52.5, lng: 13.4 })
  })

  it('akzeptiert Komma und Punkt als Dezimaltrennzeichen sowie BOM und Umlaut-Kopfzeilen', () => {
    const text = `${CSV_BOM}Name;Breite;Länge;Aufenthalt (min)\nEins;52,520008;13,404954;10\nZwei;-33.8688;151.2093;7,5\n`
    const result = parseCsv(text)
    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      {
        name: 'Eins',
        lat: 52.520008,
        lng: 13.404954,
        tags: [],
        serviceMinutes: 10,
        timeWindows: [],
        groupNames: [],
        isActive: true,
      },
      {
        name: 'Zwei',
        lat: -33.8688,
        lng: 151.2093,
        tags: [],
        serviceMinutes: 7.5,
        timeWindows: [],
        groupNames: [],
        isActive: true,
      },
    ])
  })

  it('zaehlt Zeilen ueber eingebettete Zeilenumbrueche hinweg richtig', () => {
    const text = [
      'Name;Breite;Laenge;Notizen',
      'Erster;52,5;13,4;"Zeile 1',
      'Zeile 2"',
      ';52,5;13,4;',
      'Letzter;52,6;13,5;ok',
      '',
    ].join('\r\n')
    const result = parseCsv(text)
    expect(result.rows.map((row) => row.name)).toEqual(['Erster', 'Letzter'])
    expect(result.rows[0].notes).toBe('Zeile 1\nZeile 2')
    expect(result.errors).toEqual(['Zeile 4: Der Name fehlt.'])
  })

  it('sammelt kaputte Zeilen, statt zu werfen', () => {
    const text = [
      'Name;Breite;Laenge;Aufenthalt (min);Aktiv;Zeitfenster',
      'Gut;52,5;13,4;10;ja;Mo 08:00-12:00',
      'Ohne Koordinaten;;13,4;;;',
      'Falsche Breite;95,0;13,4;;;',
      'Keine Zahl;abc;13,4;;;',
      'Zu viele Felder;52,5;13,4;;;;',
      'Kaputte Dauer;52,5;13,4;zwanzig;;',
      'Kaputtes Aktiv;52,5;13,4;;vielleicht;',
      'Kaputte Zeit;52,5;13,4;;;Mo 25:00-99:00',
      'Auch gut;52,6;13,5;5;nein;Sa 09:00-13:00',
    ].join('\n')
    const result = parseCsv(text)
    expect(result.rows.map((row) => row.name)).toEqual(['Gut', 'Auch gut'])
    expect(result.rows[0].timeWindows).toEqual([{ dow: 1, from: '08:00', to: '12:00' }])
    expect(result.rows[1]).toMatchObject({
      isActive: false,
      serviceMinutes: 5,
      timeWindows: [{ dow: 6, from: '09:00', to: '13:00' }],
    })
    expect(result.errors).toEqual([
      'Zeile 3: Breite oder Laenge fehlt.',
      'Zeile 4: Ungueltige Koordinaten ("95,0" / "13,4").',
      'Zeile 5: Ungueltige Koordinaten ("abc" / "13,4").',
      'Zeile 6: 7 Felder gefunden, erwartet wurden 6.',
      'Zeile 7: Ungueltige Aufenthaltsdauer "zwanzig".',
      'Zeile 8: Unbekannter Wert fuer "Aktiv": "vielleicht".',
      'Zeile 9: Zeitfenster "Mo 25:00-99:00" konnten nicht gelesen werden.',
    ])
  })

  it('meldet leere Dateien und fehlende Pflichtspalten', () => {
    expect(parseCsv('').errors).toEqual(['Die Datei ist leer.'])
    expect(parseCsv(`${CSV_BOM}\r\n\r\n`).errors).toEqual(['Die Datei ist leer.'])
    expect(parseCsv('Bezeichnung;Ort\nEins;Berlin\n').errors).toEqual([
      'Die Kopfzeile enthaelt keine Spalte fuer "Breite", "Laenge".',
    ])
    expect(parseCsv('Name;Breite;Laenge\n').errors).toEqual([
      'Die Datei enthaelt ausser der Kopfzeile keine Daten.',
    ])
  })
})

describe('parseCsv, Randfaelle', () => {
  it('erkennt zerlegte Umlaute in der Kopfzeile (Dateien von macOS)', () => {
    const nfd = 'Name;Breite;L\u0061\u0308nge\nHafen;52,5;13,4\n'
    const result = parseCsv(nfd)
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ name: 'Hafen', lat: 52.5, lng: 13.4 })

    const decomposedHours = parseCsv(
      'Name;Breite;Laenge;O\u0308ffnungszeiten\nHafen;52,5;13,4;Mo 08:00-12:00\n',
    )
    expect(decomposedHours.errors).toEqual([])
    expect(decomposedHours.rows[0].timeWindows).toEqual([{ dow: 1, from: '08:00', to: '12:00' }])
  })

  it('laesst sich von einem einzelnen Zoll-Zeichen in der Kopfzeile nicht beirren', () => {
    const result = parseCsv('Na"me,Breite,Laenge\nHafen,52.5,13.4\n')
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ name: 'Hafen', lat: 52.5, lng: 13.4 })
  })

  it('nimmt 24:00 als Tagesende an, weist aber echte Unzeiten ab', () => {
    const ok = parseCsv('Name;Breite;Laenge;Zeitfenster\nA;52,5;13,4;Mo 08:00-24:00|Di 00:00-24:00\n')
    expect(ok.errors).toEqual([])
    expect(ok.rows[0].timeWindows).toEqual([
      { dow: 1, from: '08:00', to: '00:00' },
      { dow: 2, from: '00:00', to: '00:00' },
    ])
    expect(parseCsv('Name;Breite;Laenge;Zeitfenster\nA;52,5;13,4;Mo 08:00-24:30\n').rows).toEqual([])
  })

  it('liest Nullkoordinaten und die Dauer 0 als Werte, nicht als Luecke', () => {
    const result = parseCsv('Name;Breite;Laenge;Aufenthalt (min);Aktiv\nNullinsel;0;0;0;nein\n')
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ lat: 0, lng: 0, serviceMinutes: 0, isActive: false })
  })

  it('bricht bei einem unbeendeten Anfuehrungszeichen nicht ab', () => {
    const result = parseCsv('Name;Breite;Laenge\n"Hafen;52,5;13,4\n')
    expect(result.rows).toEqual([])
    expect(result.errors).toHaveLength(1)
  })

  it('haelt Zeilen mit fehlender Kategorie und leeren Listen zusammen', () => {
    const csv = toCsv([makeLocation({ tags: [], time_windows: [] })], [], NO_GROUPS)
    const result = parseCsv(csv)
    expect(result.errors).toEqual([])
    expect(result.rows[0].categoryName).toBeUndefined()
    expect(result.rows[0].tags).toEqual([])
    expect(result.rows[0].timeWindows).toEqual([])
  })
})
