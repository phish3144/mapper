import { describe, expect, it } from 'vitest'
import {
  bandsBackground,
  groupColorsOf,
  hexColor,
  locationColors,
  MAX_COLORS,
  NEUTRAL_COLOR,
  sanitizeColors,
} from './colors'
import type { Group } from '@/types/domain'

/** Die drei Gruppen des echten Arbeitsbereichs - alle mit sort_order 0. */
function group(id: string, name: string, color: string, sort_order = 0): Group {
  return {
    id,
    workspace_id: 'ws',
    name,
    color,
    description: null,
    sort_order,
    visibility: 'workspace',
    created_by: null,
    created_at: '',
    updated_at: '',
  }
}

const HWP = group('g1', 'HWP AC Heilung', '#2563eb')
const FOB = group('g2', 'Team FOB', '#059669')
const SESC = group('g3', 'Team SeSc', '#9333ea')
/** So, wie db.ts sie liefert: nach sort_order, dann Name. */
const GRUPPEN = [HWP, FOB, SESC]

function ort(id: string, category_id: string | null = null) {
  return { id, category_id }
}

function zuordnung(entries: Record<string, string[]>): Map<string, string[]> {
  return new Map(Object.entries(entries))
}

describe('groupColorsOf', () => {
  it('gibt die Farbe der einen Gruppe', () => {
    expect(groupColorsOf(ort('a'), GRUPPEN, zuordnung({ a: ['g2'] }))).toEqual(['#059669'])
  })

  it('gibt beide Farben, wenn ein Standort in zwei Gruppen ist', () => {
    expect(groupColorsOf(ort('a'), GRUPPEN, zuordnung({ a: ['g3', 'g1'] }))).toEqual([
      '#2563eb',
      '#9333ea',
    ])
  })

  it('folgt der Gruppenliste, nicht der Reihenfolge der Zuordnungen', () => {
    // Genau hier lag die Falle: die Zuordnungen kommen in Einfuegereihenfolge
    // aus der Datenbank. Wuerde man ihnen folgen, saehe derselbe Standort nach
    // einem Neuladen anders aus.
    const vorwaerts = groupColorsOf(ort('a'), GRUPPEN, zuordnung({ a: ['g1', 'g3'] }))
    const rueckwaerts = groupColorsOf(ort('a'), GRUPPEN, zuordnung({ a: ['g3', 'g1'] }))
    expect(vorwaerts).toEqual(rueckwaerts)
  })

  it('liefert nichts fuer einen Standort ohne Gruppe', () => {
    expect(groupColorsOf(ort('a'), GRUPPEN, zuordnung({}))).toEqual([])
    expect(groupColorsOf(ort('a'), GRUPPEN, zuordnung({ a: [] }))).toEqual([])
  })

  it('uebergeht Zuordnungen auf Gruppen, die es nicht mehr gibt', () => {
    // Kann auftreten, solange eine geloeschte Gruppe noch im Zustand haengt.
    expect(groupColorsOf(ort('a'), GRUPPEN, zuordnung({ a: ['weg', 'g2'] }))).toEqual(['#059669'])
  })

  it('deckelt NICHT - das ist Sache der Darstellung', () => {
    const viele = [...GRUPPEN, group('g4', 'Team Vier', '#dc2626')]
    const alle = groupColorsOf(ort('a'), viele, zuordnung({ a: ['g1', 'g2', 'g3', 'g4'] }))
    expect(alle).toEqual(['#2563eb', '#059669', '#9333ea', '#dc2626'])
  })

  it('verliert keine sichtbare Farbe, wenn zwei Gruppen dieselbe tragen', () => {
    // Der Grund fuer die Trennung: wuerde groupColorsOf schon bei drei ROHEN
    // Farben abbrechen, fiele hier Violett weg - obwohl nach dem Entdoppeln
    // nur zwei Baender uebrig blieben und Platz fuer ein drittes waere.
    const viele = [
      group('g1', 'A', '#2563eb'),
      group('g2', 'B', '#2563eb'),
      group('g3', 'C', '#059669'),
      group('g4', 'D', '#9333ea'),
    ]
    const roh = groupColorsOf(ort('a'), viele, zuordnung({ a: ['g1', 'g2', 'g3', 'g4'] }))
    expect(sanitizeColors(roh)).toEqual(['#2563eb', '#059669', '#9333ea'])
  })
})

describe('locationColors', () => {
  it('nimmt die Gruppen und nicht die Kategorie, wenn es beides gibt', () => {
    const farben = locationColors(ort('a', 'c1'), GRUPPEN, zuordnung({ a: ['g2'] }), {
      color: '#ff0000',
    })
    expect(farben).toEqual(['#059669'])
  })

  it('faellt ohne Gruppe auf die Kategorie zurueck', () => {
    expect(locationColors(ort('a', 'c1'), GRUPPEN, zuordnung({}), { color: '#ff0000' })).toEqual([
      '#ff0000',
    ])
  })

  it('wird neutral, wenn weder Gruppe noch Kategorie da ist', () => {
    // Der Zustand aller 35 Standorte vor dieser Aenderung.
    expect(locationColors(ort('a'), GRUPPEN, zuordnung({}), null)).toEqual([NEUTRAL_COLOR])
  })

  it('liefert immer mindestens eine Farbe', () => {
    for (const kategorie of [null, undefined, { color: '' }]) {
      expect(locationColors(ort('a'), GRUPPEN, zuordnung({}), kategorie).length).toBeGreaterThan(0)
    }
  })
})

describe('hexColor', () => {
  it('laesst echte Hex-Werte durch', () => {
    for (const wert of ['#fff', '#2563eb', '#2563ebff', '#ABC']) {
      expect(hexColor(wert)).toBe(wert)
    }
  })

  it('weist alles ab, was kein Hex ist', () => {
    // Der Grund fuer die Pruefung: der Wert landet in einem style-Attribut,
    // das als Zeichenkette zusammengebaut wird.
    for (const wert of ['red', 'var(--text-muted)', '', null, undefined, '#12345', '#ggg']) {
      expect(hexColor(wert)).toBeNull()
    }
    expect(hexColor('#fff;background:url(x)')).toBeNull()
    expect(hexColor('"><script>')).toBeNull()
  })
})

describe('sanitizeColors', () => {
  it('laesst eine ungueltige Farbe WEGFALLEN statt sie grau zu malen', () => {
    // Ein graues Band wuerde eine Gruppe behaupten, die es nicht gibt.
    expect(sanitizeColors(['#2563eb', 'kaputt'])).toEqual(['#2563eb'])
    expect(sanitizeColors(['kaputt', 'auch kaputt'])).toEqual([])
  })

  it('entdoppelt gleiche Farben', () => {
    // Zwei Gruppen duerfen dieselbe Farbe tragen. Ohne Entdopplung entstuende
    // eine unsichtbare Fuge in einer scheinbar einfarbigen Nadel.
    expect(sanitizeColors(['#2563eb', '#2563EB'])).toEqual(['#2563eb'])
  })

  it('deckelt bei MAX_COLORS', () => {
    expect(sanitizeColors(['#111111', '#222222', '#333333', '#444444'])).toHaveLength(MAX_COLORS)
  })
})

describe('bandsBackground', () => {
  const NADEL = { angle: 135, seam: '#fff' }

  it('gibt ohne Farbe den neutralen Ton', () => {
    expect(bandsBackground([], NADEL)).toBe(NEUTRAL_COLOR)
    expect(bandsBackground(['kaputt'], NADEL)).toBe(NEUTRAL_COLOR)
  })

  it('gibt bei einer Farbe genau diese - kein Verlauf', () => {
    // 18 der 35 Standorte haengen an genau einer Gruppe. Fuer sie soll sich
    // gegenueber heute nichts aendern ausser der Farbe selbst.
    expect(bandsBackground(['#2563eb'], NADEL)).toBe('#2563eb')
  })

  it('teilt zwei Farben exakt in der Mitte', () => {
    const hintergrund = bandsBackground(['#2563eb', '#059669'], NADEL)
    expect(hintergrund).toContain('linear-gradient(135deg')
    expect(hintergrund).toContain('calc(50.000% - 0.50px)')
    expect(hintergrund).toContain('calc(50.000% + 0.50px)')
    expect(hintergrund).toContain('#fff calc(50.000% - 0.50px) calc(50.000% + 0.50px)')
  })

  it('teilt drei Farben in Dritteln - in Prozent, nicht in Pixeln', () => {
    // Genau hier lag der Rechenfehler eines verworfenen Entwurfs: er setzte
    // die Spannweite mit 18px an. Die Verlaufsachse der um -45deg gedrehten
    // Nadel misst aber 18*sqrt(2) = 25,46px, das Mittelband waere zu schmal
    // geworden. Prozentwerte kennen die Achsenlaenge gar nicht.
    const hintergrund = bandsBackground(['#111111', '#222222', '#333333'], NADEL)
    expect(hintergrund).toContain('33.333%')
    expect(hintergrund).toContain('66.667%')
    // Die einzigen Pixelwerte im Ergebnis sind die beiden Fugenhaelften.
    // Taucht hier eine andere Pixelzahl auf, rechnet wieder jemand mit einer
    // angenommenen Achsenlaenge.
    const pixelwerte = hintergrund.match(/[\d.]+px/g) ?? []
    expect(new Set(pixelwerte)).toEqual(new Set(['0.50px']))
  })

  it('nimmt fuer den ungedrehten Listenpunkt einen anderen Winkel', () => {
    const punkt = bandsBackground(['#2563eb', '#059669'], { angle: 90, seam: 'var(--bg-panel)' })
    expect(punkt).toContain('linear-gradient(90deg')
    expect(punkt).toContain('var(--bg-panel) calc(50.000% - 0.50px)')
  })

  it('laesst nichts Ungeprueftes in den Hintergrundwert', () => {
    const boese = bandsBackground(['#2563eb', 'red;background:url(evil)'], NADEL)
    expect(boese).toBe('#2563eb')
    expect(boese).not.toContain('url')
  })
})
