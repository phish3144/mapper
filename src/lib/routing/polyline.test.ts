import { describe, expect, it } from 'vitest'
import type { LatLng } from '@/types/domain'
import { decodePolyline, encodePolyline } from './polyline'

/** Referenzbeispiel aus der Google-Dokumentation zum Polyline-Format. */
const REFERENCE_ENCODED = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
const REFERENCE_POINTS: LatLng[] = [
  { lat: 38.5, lng: -120.2 },
  { lat: 40.7, lng: -120.95 },
  { lat: 43.252, lng: -126.453 },
]

describe('decodePolyline', () => {
  it('dekodiert das Referenzbeispiel', () => {
    expect(decodePolyline(REFERENCE_ENCODED)).toEqual(REFERENCE_POINTS)
  })

  it('liefert fuer leere Eingaben eine leere Liste', () => {
    expect(decodePolyline('')).toEqual([])
  })

  it('bricht bei abgeschnittener Eingabe nach dem letzten vollstaendigen Paar ab', () => {
    const truncated = REFERENCE_ENCODED.slice(0, REFERENCE_ENCODED.length - 3)
    const points = decodePolyline(truncated)
    expect(points).toEqual(REFERENCE_POINTS.slice(0, 2))
  })

  it('dekodiert mit Praezision 6', () => {
    expect(decodePolyline('_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI', 6)).toEqual(REFERENCE_POINTS)
  })
})

describe('encodePolyline', () => {
  it('kodiert das Referenzbeispiel zeichengenau', () => {
    expect(encodePolyline(REFERENCE_POINTS)).toBe(REFERENCE_ENCODED)
  })

  it('kodiert mit Praezision 6', () => {
    expect(encodePolyline(REFERENCE_POINTS, 6)).toBe('_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI')
  })

  it('liefert fuer eine leere Liste eine leere Zeichenkette', () => {
    expect(encodePolyline([])).toBe('')
  })

  it('kodiert einen einzelnen Punkt', () => {
    const single: LatLng[] = [{ lat: 52.5163, lng: 13.3777 }]
    expect(decodePolyline(encodePolyline(single))).toEqual(single)
  })

  it('rundet halbe Einheiten von der Null weg (wie der Referenzalgorithmus)', () => {
    // -0.000005 liegt genau auf der Haelfte: Python-2-Rundung ergibt -1 Einheit.
    expect(encodePolyline([{ lat: -0.000005, lng: 0 }])).toBe('@?')
    expect(encodePolyline([{ lat: 0.000005, lng: 0 }])).toBe('A?')
  })
})

describe('Hin- und Rueckrichtung', () => {
  const cases: Array<{ name: string; points: LatLng[]; precision: number }> = [
    {
      name: 'Berlin, Praezision 5',
      points: [
        { lat: 52.52, lng: 13.405 },
        { lat: 52.5163, lng: 13.3777 },
        { lat: 52.5096, lng: 13.3765 },
      ],
      precision: 5,
    },
    {
      name: 'alle vier Quadranten, Praezision 5',
      points: [
        { lat: -33.8688, lng: 151.2093 },
        { lat: -34.6037, lng: -58.3816 },
        { lat: 64.1466, lng: -21.9426 },
        { lat: 0, lng: 0 },
        { lat: -0.1807, lng: -78.4678 },
      ],
      precision: 5,
    },
    {
      name: 'negative Werte, Praezision 6',
      points: [
        { lat: -12.046374, lng: -77.042793 },
        { lat: -12.046512, lng: -77.041234 },
        { lat: -12.045001, lng: -77.043999 },
      ],
      precision: 6,
    },
    {
      name: 'Extremwerte, Praezision 6',
      points: [
        { lat: -90, lng: -180 },
        { lat: 90, lng: 180 },
        { lat: 0, lng: 0 },
      ],
      precision: 6,
    },
  ]

  for (const testCase of cases) {
    it(`ueberlebt den Umlauf: ${testCase.name}`, () => {
      const encoded = encodePolyline(testCase.points, testCase.precision)
      expect(decodePolyline(encoded, testCase.precision)).toEqual(testCase.points)
    })
  }

  it('kodiert lange Strecken stabil (viele kleine Schritte)', () => {
    const points: LatLng[] = []
    for (let i = 0; i < 500; i++) {
      points.push({ lat: 48.1 + i * 0.00037, lng: 11.5 - i * 0.00041 })
    }
    const decoded = decodePolyline(encodePolyline(points), 5)
    expect(decoded).toHaveLength(points.length)
    for (let i = 0; i < points.length; i++) {
      expect(decoded[i].lat).toBeCloseTo(points[i].lat, 5)
      expect(decoded[i].lng).toBeCloseTo(points[i].lng, 5)
    }
  })
})
