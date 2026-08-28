import { describe, expect, it } from 'vitest'
import type { TimeWindow } from '@/types/domain'
import { checkTimeWindows, computeSchedule, isoDayOfWeek, parseClock } from './schedule'
import type { PlanOptions, PlanStopInput } from './types'

/** Montag, 16. Maerz 2026. */
const MONDAY = new Date(2026, 2, 16, 8, 0)
/** Sonntag, 22. Maerz 2026 - getDay() liefert hier 0. */
const SUNDAY_DATE = { year: 2026, month: 2, day: 22 }

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

/** Matrix aus Positionen auf einer Geraden: Fahrzeit je Einheit, Strecke 1000 m je Einheit. */
function lineMatrix(positions: number[], secondsPerUnit: number) {
  return {
    durations: positions.map((a) => positions.map((b) => Math.abs(a - b) * secondsPerUnit)),
    distances: positions.map((a) => positions.map((b) => Math.abs(a - b) * 1000)),
  }
}

const SINGLE = { durations: [[0]], distances: [[0]] }

describe('parseClock / isoDayOfWeek', () => {
  it('liest HH:MM und optionale Sekunden', () => {
    expect(parseClock('08:00')).toBe(480)
    expect(parseClock('8:05')).toBe(485)
    expect(parseClock('23:59:59')).toBe(1439)
    expect(parseClock('24:00')).toBeNull()
    expect(parseClock('08:60')).toBeNull()
    expect(parseClock('unsinn')).toBeNull()
  })

  it('bildet Sonntag auf ISO 7 ab', () => {
    expect(isoDayOfWeek(MONDAY)).toBe(1)
    expect(isoDayOfWeek(new Date(2026, 2, 20, 8, 0))).toBe(5)
    expect(isoDayOfWeek(new Date(SUNDAY_DATE.year, SUNDAY_DATE.month, SUNDAY_DATE.day, 8, 0))).toBe(7)
  })
})

describe('checkTimeWindows', () => {
  it('behandelt Standorte ohne Fenster als immer offen', () => {
    expect(checkTimeWindows(MONDAY, [])).toEqual({ waitMinutes: 0, violation: 'none' })
    expect(checkTimeWindows(MONDAY, null)).toEqual({ waitMinutes: 0, violation: 'none' })
  })

  it('wartet bis zum naechsten Fenster desselben Tages', () => {
    const windows: TimeWindow[] = [
      { dow: 1, from: '08:00', to: '10:00' },
      { dow: 1, from: '14:00', to: '16:00' },
    ]
    expect(checkTimeWindows(new Date(2026, 2, 16, 11, 0), windows)).toEqual({
      waitMinutes: 180,
      violation: 'none',
    })
    expect(checkTimeWindows(new Date(2026, 2, 16, 17, 0), windows)).toEqual({
      waitMinutes: 0,
      violation: 'late',
    })
    expect(checkTimeWindows(new Date(2026, 2, 16, 9, 0), windows)).toEqual({
      waitMinutes: 0,
      violation: 'none',
    })
  })
})

describe('computeSchedule', () => {
  it('wartet, bis das Zeitfenster oeffnet', () => {
    const stops = [makeStop(0), makeStop(1, 15, [{ dow: 1, from: '10:00', to: '12:00' }])]
    const matrix = { durations: [[0, 3600], [3600, 0]], distances: [[0, 12000], [12000, 0]] }

    const schedule = computeSchedule([0, 1], stops, matrix, makeOptions({ departAt: MONDAY }))

    expect(schedule.stops[0].arrival).toEqual(new Date(2026, 2, 16, 8, 0))
    expect(schedule.stops[0].departure).toEqual(new Date(2026, 2, 16, 8, 0))
    expect(schedule.stops[0].travelSecFromPrev).toBe(0)
    expect(schedule.stops[1].arrival).toEqual(new Date(2026, 2, 16, 9, 0))
    expect(schedule.stops[1].waitMinutes).toBe(60)
    expect(schedule.stops[1].violation).toBe('none')
    expect(schedule.stops[1].departure).toEqual(new Date(2026, 2, 16, 10, 15))
    expect(schedule.totalTravelSec).toBe(3600)
    expect(schedule.totalDistanceM).toBe(12000)
    expect(schedule.totalWaitMinutes).toBe(60)
    expect(schedule.totalServiceMinutes).toBe(15)
    expect(schedule.violations).toBe(0)
    expect(schedule.finishAt).toEqual(new Date(2026, 2, 16, 10, 15))
  })

  it('meldet eine zu spaete Ankunft als "late"', () => {
    const stops = [makeStop(0, 15, [{ dow: 1, from: '10:00', to: '12:00' }])]

    const schedule = computeSchedule([0], stops, SINGLE, makeOptions({
      departAt: new Date(2026, 2, 16, 13, 0),
    }))

    expect(schedule.stops[0].violation).toBe('late')
    expect(schedule.stops[0].waitMinutes).toBe(0)
    expect(schedule.stops[0].departure).toEqual(new Date(2026, 2, 16, 13, 15))
    expect(schedule.violations).toBe(1)
  })

  it('meldet einen geschlossenen Wochentag als "closed-day"', () => {
    const stops = [makeStop(0, 10, [{ dow: 2, from: '08:00', to: '18:00' }])]

    const schedule = computeSchedule([0], stops, SINGLE, makeOptions({ departAt: MONDAY }))

    expect(schedule.stops[0].violation).toBe('closed-day')
    expect(schedule.stops[0].waitMinutes).toBe(0)
    expect(schedule.stops[0].departure).toEqual(new Date(2026, 2, 16, 8, 10))
    expect(schedule.violations).toBe(1)
  })

  it('behandelt ein ueber Mitternacht laufendes Fenster', () => {
    const nightly: TimeWindow[] = [{ dow: 1, from: '22:00', to: '02:00' }]
    const stops = [makeStop(0, 0, nightly)]

    const inside = computeSchedule([0], stops, SINGLE, makeOptions({
      departAt: new Date(2026, 2, 16, 23, 30),
    }))
    expect(inside.stops[0].violation).toBe('none')
    expect(inside.stops[0].waitMinutes).toBe(0)

    const early = computeSchedule([0], stops, SINGLE, makeOptions({
      departAt: new Date(2026, 2, 16, 21, 0),
    }))
    expect(early.stops[0].violation).toBe('none')
    expect(early.stops[0].waitMinutes).toBe(60)
    expect(early.stops[0].departure).toEqual(new Date(2026, 2, 16, 22, 0))

    // Massgeblich ist der Wochentag der Ankunft: am Dienstag um 00:30 gibt es kein Fenster.
    const nextDay = computeSchedule([0], stops, SINGLE, makeOptions({
      departAt: new Date(2026, 2, 17, 0, 30),
    }))
    expect(nextDay.stops[0].violation).toBe('closed-day')
  })

  it('behandelt Sonntag als ISO-Wochentag 7', () => {
    const sunday = new Date(SUNDAY_DATE.year, SUNDAY_DATE.month, SUNDAY_DATE.day, 9, 30)
    const open = computeSchedule(
      [0],
      [makeStop(0, 0, [{ dow: 7, from: '09:00', to: '17:00' }])],
      SINGLE,
      makeOptions({ departAt: sunday }),
    )
    expect(open.stops[0].violation).toBe('none')

    const closed = computeSchedule(
      [0],
      [makeStop(0, 0, [{ dow: 1, from: '09:00', to: '17:00' }])],
      SINGLE,
      makeOptions({ departAt: sunday }),
    )
    expect(closed.stops[0].violation).toBe('closed-day')
  })

  it('zaehlt die Rueckfahrt der Rundtour ohne zusaetzlichen Eintrag', () => {
    const stops = [makeStop(0), makeStop(1), makeStop(2)]
    const matrix = lineMatrix([0, 1, 3], 600)
    const options = makeOptions({ departAt: MONDAY, roundtrip: true })

    const schedule = computeSchedule([0, 1, 2], stops, matrix, options)

    expect(schedule.stops).toHaveLength(3)
    expect(schedule.totalTravelSec).toBe(600 + 1200 + 1800)
    expect(schedule.totalDistanceM).toBe(1000 + 2000 + 3000)
    expect(schedule.stops[2].departure).toEqual(new Date(2026, 2, 16, 8, 30))
    expect(schedule.finishAt).toEqual(new Date(2026, 2, 16, 9, 0))

    const oneWay = computeSchedule([0, 1, 2], stops, matrix, makeOptions({ departAt: MONDAY }))
    expect(oneWay.totalTravelSec).toBe(1800)
    expect(oneWay.totalDistanceM).toBe(3000)
    expect(oneWay.finishAt).toEqual(new Date(2026, 2, 16, 8, 30))
  })

  it('summiert ohne departAt weiter, laesst aber alle Uhrzeiten leer', () => {
    const stops = [makeStop(0, 10), makeStop(1, 10), makeStop(2, 10)]
    const matrix = lineMatrix([0, 1, 3], 600)

    const schedule = computeSchedule([0, 1, 2], stops, matrix, makeOptions({ roundtrip: true }))

    for (const entry of schedule.stops) {
      expect(entry.arrival).toBeNull()
      expect(entry.departure).toBeNull()
      expect(entry.waitMinutes).toBe(0)
      expect(entry.violation).toBe('none')
    }
    expect(schedule.finishAt).toBeNull()
    expect(schedule.totalTravelSec).toBe(3600)
    expect(schedule.totalDistanceM).toBe(6000)
    expect(schedule.totalServiceMinutes).toBe(30)
    expect(schedule.totalWaitMinutes).toBe(0)
    expect(schedule.violations).toBe(0)
  })

  it('liest die Matrix richtungsabhaengig [von][nach]', () => {
    const stops = [makeStop(0), makeStop(1), makeStop(2)]
    const matrix = {
      durations: [[0, 100, 200], [300, 0, 400], [500, 600, 0]],
      distances: [[0, 10, 20], [30, 0, 40], [50, 60, 0]],
    }

    const forward = computeSchedule([2, 0], stops, matrix, makeOptions())
    expect(forward.stops[1].travelSecFromPrev).toBe(500)
    expect(forward.stops[1].travelMetersFromPrev).toBe(50)

    const backward = computeSchedule([0, 2], stops, matrix, makeOptions())
    expect(backward.stops[1].travelSecFromPrev).toBe(200)
    expect(backward.totalDistanceM).toBe(20)
  })

  it('liefert fuer eine leere Reihenfolge einen leeren Plan', () => {
    const schedule = computeSchedule([], [], { durations: [], distances: [] }, makeOptions())
    expect(schedule.stops).toEqual([])
    expect(schedule.totalTravelSec).toBe(0)
    expect(schedule.totalDistanceM).toBe(0)
    expect(schedule.violations).toBe(0)
    expect(schedule.finishAt).toBeNull()
  })

  it('schaetzt fehlende Matrixeintraege aus der Luftlinie', () => {
    const stops = [makeStop(0), makeStop(1)]
    const schedule = computeSchedule([0, 1], stops, { durations: [], distances: [] }, makeOptions())

    expect(schedule.totalTravelSec).toBeGreaterThan(0)
    expect(schedule.totalDistanceM).toBeGreaterThan(0)
  })
})
