import { describe, expect, it } from 'vitest'
import type { TimeWindow } from '@/types/domain'
import { isBetterSchedule, optimizeOrder, scheduleCostSeconds } from './optimize'
import type { PlanOptions, PlanStopInput } from './types'

/** Montag, 16. Maerz 2026, 08:00 Uhr. */
const MONDAY_8 = new Date(2026, 2, 16, 8, 0)

function makeStop(
  n: number,
  serviceMinutes = 0,
  timeWindows: TimeWindow[] = [],
): PlanStopInput {
  return {
    locationId: `loc-${n}`,
    point: { lat: 52.5 + n * 0.01, lng: 13.4 + n * 0.01 },
    serviceMinutes,
    timeWindows,
  }
}

function makeOptions(partial: Partial<PlanOptions> = {}): PlanOptions {
  return {
    departAt: null,
    fixedStartIndex: null,
    fixedEndIndex: null,
    roundtrip: false,
    ...partial,
  }
}

/** Stopps und Matrix aus Positionen auf einer Geraden. */
function lineCase(positions: number[], secondsPerUnit: number, serviceMinutes: number[] = []) {
  const stops = positions.map((_, i) => makeStop(i, serviceMinutes[i] ?? 0))
  const matrix = {
    durations: positions.map((a) => positions.map((b) => Math.abs(a - b) * secondsPerUnit)),
    distances: positions.map((a) => positions.map((b) => Math.abs(a - b) * 1000)),
  }
  return { stops, matrix }
}

function isPermutation(order: number[], count: number): boolean {
  return (
    order.length === count &&
    new Set(order).size === count &&
    order.every((index) => Number.isInteger(index) && index >= 0 && index < count)
  )
}

describe('optimizeOrder - reine Fahrzeit', () => {
  it('findet das Optimum einer kleinen Instanz', () => {
    // Positionen 0, 3, 1, 7 auf einer Geraden; die Eingangsreihenfolge kostet 11 Einheiten.
    const { stops, matrix } = lineCase([0, 3, 1, 7], 60)

    const result = optimizeOrder(stops, matrix, makeOptions())

    expect(isPermutation(result.order, 4)).toBe(true)
    expect(result.schedule.totalTravelSec).toBe(7 * 60)
    expect(result.improvedFrom.totalTravelSec).toBe(11 * 60)
    // Beide Laufrichtungen der Geraden sind gleich gut.
    expect([[0, 2, 1, 3].join(), [3, 1, 2, 0].join()]).toContain(result.order.join())
  })

  it('haelt einen fixierten Startpunkt ein', () => {
    const { stops, matrix } = lineCase([0, 3, 1, 7], 60)

    const result = optimizeOrder(stops, matrix, makeOptions({ fixedStartIndex: 0 }))

    expect(result.order).toEqual([0, 2, 1, 3])
    expect(result.schedule.totalTravelSec).toBe(7 * 60)
  })

  it('haelt fixierten Start und fixiertes Ende ein', () => {
    // Positionen: 0 -> x=0 (Start), 1 -> x=3, 2 -> x=1, 3 -> x=2, 4 -> x=10 (Ende).
    const { stops, matrix } = lineCase([0, 3, 1, 2, 10], 60)

    const result = optimizeOrder(
      stops,
      matrix,
      makeOptions({ fixedStartIndex: 0, fixedEndIndex: 4 }),
    )

    expect(result.order[0]).toBe(0)
    expect(result.order[result.order.length - 1]).toBe(4)
    expect(result.order).toEqual([0, 2, 3, 1, 4])
    expect(result.schedule.totalTravelSec).toBe(10 * 60)
  })

  it('nutzt die Richtungsabhaengigkeit der Matrix', () => {
    const stops = [makeStop(0), makeStop(1)]
    const matrix = { durations: [[0, 900], [300, 0]], distances: [[0, 9000], [3000, 0]] }

    const free = optimizeOrder(stops, matrix, makeOptions())
    expect(free.order).toEqual([1, 0])
    expect(free.schedule.totalTravelSec).toBe(300)

    const fixed = optimizeOrder(stops, matrix, makeOptions({ fixedStartIndex: 0 }))
    expect(fixed.order).toEqual([0, 1])
    expect(fixed.schedule.totalTravelSec).toBe(900)
  })

  it('bewaeltigt auch mehr als zwoelf Stopps', () => {
    const positions = [7, 0, 13, 3, 9, 1, 11, 5, 2, 12, 4, 10, 6, 8]
    const { stops, matrix } = lineCase(positions, 60)

    const result = optimizeOrder(stops, matrix, makeOptions())

    expect(isPermutation(result.order, positions.length)).toBe(true)
    expect(result.schedule.totalTravelSec).toBe(13 * 60)
  })
})

describe('optimizeOrder - Zeitfenster', () => {
  it('bevorzugt die verletzungsaermere Reihenfolge, auch wenn sie langsamer ist', () => {
    // Positionen: 0 -> x=0 (Depot), 1 -> x=1, 2 -> x=2, 3 -> x=10 (enges Fenster).
    // Die beiden nahen Stopps kosten je 30 Minuten Aufenthalt; wer sie zuerst
    // abarbeitet, erreicht den weiten Stopp erst nach Fensterschluss.
    const positions = [0, 1, 2, 10]
    const { matrix } = lineCase(positions, 300)
    const stops = [
      makeStop(0),
      makeStop(1, 30),
      makeStop(2, 30),
      makeStop(3, 0, [{ dow: 1, from: '08:00', to: '09:00' }]),
    ]

    const result = optimizeOrder(
      stops,
      matrix,
      makeOptions({ departAt: MONDAY_8, fixedStartIndex: 0 }),
    )

    expect(result.improvedFrom.violations).toBe(1)
    expect(result.improvedFrom.totalTravelSec).toBe(3000)
    expect(result.schedule.violations).toBe(0)
    expect(result.order).toEqual([0, 3, 2, 1])
    expect(result.schedule.totalTravelSec).toBe(5700)
    // Der gewaehlte Plan ist ausdruecklich langsamer als der verletzende.
    expect(result.schedule.totalTravelSec).toBeGreaterThan(result.improvedFrom.totalTravelSec)
    expect(isBetterSchedule(result.schedule, result.improvedFrom)).toBe(true)
  })

  it('bezieht Wartezeit in die Bewertung ein', () => {
    const stops = [
      makeStop(0),
      makeStop(1, 0, [{ dow: 1, from: '11:00', to: '18:00' }]),
      makeStop(2),
    ]
    const matrix = {
      durations: [[0, 600, 600], [600, 0, 600], [600, 600, 0]],
      distances: [[0, 1000, 1000], [1000, 0, 1000], [1000, 1000, 0]],
    }

    const result = optimizeOrder(
      stops,
      matrix,
      makeOptions({ departAt: MONDAY_8, fixedStartIndex: 0 }),
    )

    // Der spaet oeffnende Stopp gehoert ans Ende, sonst wartet man vor dem letzten Stopp.
    expect(result.order).toEqual([0, 2, 1])
    expect(result.schedule.violations).toBe(0)
    expect(scheduleCostSeconds(result.schedule)).toBeLessThan(
      scheduleCostSeconds(result.improvedFrom),
    )
  })
})

describe('optimizeOrder - Determinismus und Randfaelle', () => {
  it('liefert bei gleicher Eingabe zweimal dasselbe Ergebnis', () => {
    const points: Array<[number, number]> = [
      [0, 0], [4, 1], [1, 5], [6, 6], [2, 2], [5, 3], [3, 7], [7, 2], [2, 4],
    ]
    const stops = points.map((_, i) => makeStop(i, i % 3 === 0 ? 15 : 0))
    const durations = points.map((a) =>
      points.map((b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 600)),
    )
    const matrix = { durations, distances: durations.map((row) => row.map((v) => v * 2)) }
    const options = makeOptions({ departAt: MONDAY_8, roundtrip: true })

    const first = optimizeOrder(stops, matrix, options)
    const second = optimizeOrder(stops, matrix, options)

    expect(second.order).toEqual(first.order)
    expect(second.schedule.totalTravelSec).toBe(first.schedule.totalTravelSec)
    expect(second.schedule.totalDistanceM).toBe(first.schedule.totalDistanceM)
    expect(isPermutation(first.order, points.length)).toBe(true)
    expect(scheduleCostSeconds(first.schedule)).toBeLessThanOrEqual(
      scheduleCostSeconds(first.improvedFrom),
    )
  })

  it('kommt mit null Stopps zurecht', () => {
    const result = optimizeOrder([], { durations: [], distances: [] }, makeOptions())

    expect(result.order).toEqual([])
    expect(result.schedule.stops).toEqual([])
    expect(result.schedule.totalTravelSec).toBe(0)
    expect(result.schedule.finishAt).toBeNull()
    expect(result.improvedFrom.violations).toBe(0)
  })

  it('kommt mit einem Stopp zurecht', () => {
    const stops = [makeStop(0, 20)]
    const matrix = { durations: [[0]], distances: [[0]] }

    const result = optimizeOrder(stops, matrix, makeOptions({
      departAt: MONDAY_8,
      roundtrip: true,
    }))

    expect(result.order).toEqual([0])
    expect(result.schedule.stops).toHaveLength(1)
    expect(result.schedule.totalTravelSec).toBe(0)
    expect(result.schedule.totalServiceMinutes).toBe(20)
    expect(result.schedule.finishAt).toEqual(new Date(2026, 2, 16, 8, 20))
  })

  it('kommt mit zwei Stopps zurecht', () => {
    const { stops, matrix } = lineCase([5, 0], 60)

    const result = optimizeOrder(stops, matrix, makeOptions({ roundtrip: true }))

    expect(isPermutation(result.order, 2)).toBe(true)
    expect(result.schedule.stops).toHaveLength(2)
    expect(result.schedule.totalTravelSec).toBe(2 * 5 * 60)
  })

  it('ignoriert unbrauchbare Fixierungen', () => {
    const { stops, matrix } = lineCase([0, 3, 1, 7], 60)

    const result = optimizeOrder(
      stops,
      matrix,
      makeOptions({ fixedStartIndex: 9, fixedEndIndex: -1 }),
    )

    expect(isPermutation(result.order, 4)).toBe(true)
    expect(result.schedule.totalTravelSec).toBe(7 * 60)
  })

  it('laesst den Start gewinnen, wenn Start und Ende auf denselben Stopp zeigen', () => {
    const { stops, matrix } = lineCase([0, 3, 1, 7], 60)

    const result = optimizeOrder(
      stops,
      matrix,
      makeOptions({ fixedStartIndex: 0, fixedEndIndex: 0 }),
    )

    expect(result.order[0]).toBe(0)
    expect(result.order).toEqual([0, 2, 1, 3])
  })
})
