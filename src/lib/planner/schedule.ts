/**
 * Berechnet aus einer Reihenfolge den konkreten Fahrplan: Ankunft, Wartezeit,
 * Abfahrt und Zeitfensterverletzungen. Rechnet ausschliesslich in lokaler Zeit.
 */
import type { TimeWindow } from '@/types/domain'
import type { TravelMatrix } from '@/lib/routing/types'
import { haversineKm, isValidLatLng } from '@/lib/geo'
import type {
  PlanOptions,
  PlanStopInput,
  Schedule,
  ScheduledStop,
  StopViolation,
} from './types'

const MS_PER_MINUTE = 60_000

/** Luftliniengeschwindigkeit, falls die Matrix eine Kante nicht kennt. */
const FALLBACK_SPEED_KMH = 50

const HHMM = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/

/** Minuten seit Mitternacht aus "HH:MM" (Sekunden werden ignoriert), sonst null. */
export function parseClock(value: string): number | null {
  if (typeof value !== 'string') return null
  const match = HHMM.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** ISO-Wochentag: getDay() liefert 0 fuer Sonntag, ISO erwartet dort 7. */
export function isoDayOfWeek(date: Date): number {
  const day = date.getDay()
  return day === 0 ? 7 : day
}

/** Lokaler Zeitpunkt am Tag von `base` (plus Tagesversatz) zur angegebenen Tagesminute. */
function atLocalMinute(base: Date, minuteOfDay: number, dayOffset: number): Date {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
    0,
    0,
  )
}

interface ConcreteWindow {
  start: Date
  end: Date
}

export interface WindowCheck {
  waitMinutes: number
  violation: StopViolation
}

const OPEN: WindowCheck = { waitMinutes: 0, violation: 'none' }

/**
 * Prueft die Ankunft gegen die Zeitfenster des Standorts.
 * Ohne (gueltige) Fenster gilt ein Standort als immer offen. Betrachtet werden
 * nur die Fenster des Wochentags der Ankunft; ein Fenster mit to <= from endet
 * am Folgetag.
 */
export function checkTimeWindows(
  arrival: Date,
  windows: readonly TimeWindow[] | null | undefined,
): WindowCheck {
  if (!windows || windows.length === 0) return OPEN

  const dow = isoDayOfWeek(arrival)
  const today: ConcreteWindow[] = []
  let anyValid = false

  for (const window of windows) {
    if (!window) continue
    const from = parseClock(window.from)
    const to = parseClock(window.to)
    if (from === null || to === null) continue
    if (!Number.isInteger(window.dow) || window.dow < 1 || window.dow > 7) continue
    anyValid = true
    if (window.dow !== dow) continue
    // to <= from laeuft ueber Mitternacht und endet am Folgetag.
    const spansMidnight = to <= from
    today.push({
      start: atLocalMinute(arrival, from, 0),
      end: spansMidnight
        ? atLocalMinute(arrival, to, 1)
        : atLocalMinute(arrival, to, 0),
    })
  }

  if (!anyValid) return OPEN
  if (today.length === 0) return { waitMinutes: 0, violation: 'closed-day' }

  today.sort((a, b) => a.start.getTime() - b.start.getTime())
  const at = arrival.getTime()

  for (const window of today) {
    if (at >= window.start.getTime() && at < window.end.getTime()) return OPEN
  }

  for (const window of today) {
    const start = window.start.getTime()
    if (start > at) return { waitMinutes: (start - at) / MS_PER_MINUTE, violation: 'none' }
  }

  return { waitMinutes: 0, violation: 'late' }
}

/** Liest einen Wert aus der Matrix; null, wenn die Kante fehlt oder unbrauchbar ist. */
function matrixValue(
  table: readonly (readonly number[])[] | null | undefined,
  from: number,
  to: number,
): number | null {
  if (!table) return null
  const row = table[from]
  if (!row) return null
  const value = row[to]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value
}

/** Luftlinie zwischen zwei Stopps in Kilometern; 0, wenn die Koordinaten fehlen. */
function fallbackKm(stops: readonly PlanStopInput[], from: number, to: number): number {
  const a: PlanStopInput | undefined = stops[from]
  const b: PlanStopInput | undefined = stops[to]
  if (!a || !b || !isValidLatLng(a.point) || !isValidLatLng(b.point)) return 0
  return haversineKm(a.point, b.point)
}

/** Fahrzeit in Sekunden. Fehlt die Kante, wird aus der Luftlinie geschaetzt. */
export function durationBetween(
  matrix: TravelMatrix,
  stops: readonly PlanStopInput[],
  from: number,
  to: number,
): number {
  const value = matrixValue(matrix?.durations, from, to)
  if (value !== null) return value
  return (fallbackKm(stops, from, to) / FALLBACK_SPEED_KMH) * 3600
}

/** Fahrstrecke in Metern. Fehlt die Kante, wird die Luftlinie benutzt. */
export function distanceBetween(
  matrix: TravelMatrix,
  stops: readonly PlanStopInput[],
  from: number,
  to: number,
): number {
  const value = matrixValue(matrix?.distances, from, to)
  if (value !== null) return value
  return fallbackKm(stops, from, to) * 1000
}

function normalizeMinutes(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return value
}

/**
 * Baut den Fahrplan fuer die gegebene Reihenfolge. Indizes ausserhalb von
 * `stops` werden uebergangen, damit ein unvollstaendiger Plan nicht abstuerzt.
 */
export function computeSchedule(
  order: readonly number[],
  stops: readonly PlanStopInput[],
  matrix: TravelMatrix,
  options: PlanOptions,
): Schedule {
  const departAt =
    options.departAt !== null && !Number.isNaN(options.departAt.getTime())
      ? options.departAt
      : null

  const scheduled: ScheduledStop[] = []
  let totalTravelSec = 0
  let totalDistanceM = 0
  let totalWaitMinutes = 0
  let totalServiceMinutes = 0
  let violations = 0

  let cursor: Date | null = departAt === null ? null : new Date(departAt.getTime())
  let previous = -1

  for (const index of order) {
    const stop: PlanStopInput | undefined = stops[index]
    if (!stop) continue

    const travelSec = previous < 0 ? 0 : durationBetween(matrix, stops, previous, index)
    const travelMeters = previous < 0 ? 0 : distanceBetween(matrix, stops, previous, index)
    totalTravelSec += travelSec
    totalDistanceM += travelMeters

    const service = normalizeMinutes(stop.serviceMinutes)
    totalServiceMinutes += service

    let arrival: Date | null = null
    let departure: Date | null = null
    let waitMinutes = 0
    let violation: StopViolation = 'none'

    if (cursor !== null) {
      arrival = new Date(cursor.getTime() + Math.round(travelSec * 1000))
      const check = checkTimeWindows(arrival, stop.timeWindows)
      waitMinutes = check.waitMinutes
      violation = check.violation
      departure = new Date(arrival.getTime() + Math.round((waitMinutes + service) * MS_PER_MINUTE))
      cursor = departure
    }

    totalWaitMinutes += waitMinutes
    if (violation !== 'none') violations += 1

    scheduled.push({
      locationId: stop.locationId,
      index,
      arrival,
      departure,
      waitMinutes,
      travelSecFromPrev: travelSec,
      travelMetersFromPrev: travelMeters,
      violation,
    })
    previous = index
  }

  // Die Rueckfahrt zaehlt in den Summen und bestimmt das Ende, bleibt aber ohne eigenen Eintrag.
  const first = scheduled.length > 0 ? scheduled[0].index : -1
  if (options.roundtrip && scheduled.length >= 2 && previous >= 0 && first >= 0) {
    const backSec = durationBetween(matrix, stops, previous, first)
    totalTravelSec += backSec
    totalDistanceM += distanceBetween(matrix, stops, previous, first)
    if (cursor !== null) cursor = new Date(cursor.getTime() + Math.round(backSec * 1000))
  }

  return {
    stops: scheduled,
    totalTravelSec,
    totalDistanceM,
    totalWaitMinutes,
    totalServiceMinutes,
    finishAt: cursor,
    violations,
  }
}
