/**
 * Reihenfolgeoptimierung: Konstruktion per naechstem Nachbarn (mehrfach gestartet),
 * danach 2-opt und Or-opt im Wechsel. Bewertet wird lexikographisch - erst die
 * Zahl der Zeitfensterverletzungen, dann Fahrzeit plus Wartezeit. Vollstaendig
 * deterministisch, kein Zufall.
 */
import type { TravelMatrix } from '@/lib/routing/types'
import { computeSchedule, durationBetween } from './schedule'
import type { OptimizeResult, PlanOptions, PlanStopInput, Schedule } from './types'

/** Obergrenze fuer die Wechsel aus 2-opt und Or-opt; schliesst Endlosschleifen aus. */
const MAX_PASSES = 200

/** Ab dieser Stoppzahl werden nicht mehr alle Startknoten durchprobiert. */
const MULTISTART_THRESHOLD = 12
const MULTISTART_LIMIT = 8

/** Laengste Kette, die Or-opt am Stueck verschiebt. */
const MAX_SEGMENT = 3

const EPSILON = 1e-9

/** Zielgroesse der zweiten Stufe: Fahrzeit und Wartezeit in Sekunden. */
export function scheduleCostSeconds(schedule: Schedule): number {
  return schedule.totalTravelSec + schedule.totalWaitMinutes * 60
}

/** Lexikographischer Vergleich: weniger Verletzungen schlaegt immer die schnellere Loesung. */
export function isBetterSchedule(candidate: Schedule, reference: Schedule): boolean {
  if (candidate.violations !== reference.violations) {
    return candidate.violations < reference.violations
  }
  return scheduleCostSeconds(candidate) < scheduleCostSeconds(reference) - EPSILON
}

interface Solution {
  order: number[]
  schedule: Schedule
}

interface Context {
  stops: readonly PlanStopInput[]
  matrix: TravelMatrix
  options: PlanOptions
  /** Erste Position, die veraendert werden darf. */
  lo: number
  /** Letzte Position, die veraendert werden darf. */
  hi: number
}

function evaluate(order: number[], ctx: Context): Solution {
  return { order, schedule: computeSchedule(order, ctx.stops, ctx.matrix, ctx.options) }
}

function better(candidate: Solution, incumbent: Solution): boolean {
  return isBetterSchedule(candidate.schedule, incumbent.schedule)
}

/** Gueltiger Index in `stops` oder null. */
function normalizeIndex(value: number | null, count: number): number | null {
  if (value === null || !Number.isInteger(value)) return null
  if (value < 0 || value >= count) return null
  return value
}

/** Bringt eine beliebige Reihenfolge in Einklang mit fixem Start und Ende. */
function applyFixed(
  order: readonly number[],
  startIndex: number | null,
  endIndex: number | null,
): number[] {
  const middle = order.filter((i) => i !== startIndex && i !== endIndex)
  const result: number[] = []
  if (startIndex !== null) result.push(startIndex)
  for (const index of middle) result.push(index)
  if (endIndex !== null) result.push(endIndex)
  return result
}

/**
 * Reihenfolge der zu probierenden Startknoten. Knoten mit grosser Gesamtentfernung
 * zu allen anderen kommen zuerst: solche Randlagen bleiben beim naechsten Nachbarn
 * sonst bis zuletzt liegen und verteuern die Tour.
 */
function rankedStarts(pool: readonly number[], ctx: Context): number[] {
  const scored = pool.map((index) => {
    let sum = 0
    for (const other of pool) {
      if (other === index) continue
      sum += durationBetween(ctx.matrix, ctx.stops, index, other)
    }
    return { index, sum }
  })
  scored.sort((a, b) => (b.sum === a.sum ? a.index - b.index : b.sum - a.sum))
  return scored.map((entry) => entry.index)
}

/** Konstruktion per naechstem Nachbarn ab `first`, mit festem Endknoten am Schluss. */
function nearestNeighbour(
  first: number,
  pool: readonly number[],
  endIndex: number | null,
  ctx: Context,
): number[] {
  const remaining = new Set(pool)
  remaining.delete(first)
  const order = [first]
  let current = first

  while (remaining.size > 0) {
    let best = -1
    let bestCost = Number.POSITIVE_INFINITY
    for (const candidate of remaining) {
      const cost = durationBetween(ctx.matrix, ctx.stops, current, candidate)
      if (cost < bestCost - EPSILON) {
        bestCost = cost
        best = candidate
      }
    }
    if (best < 0) break
    order.push(best)
    remaining.delete(best)
    current = best
  }

  if (endIndex !== null) order.push(endIndex)
  return order
}

function reversedSegment(order: readonly number[], from: number, to: number): number[] {
  const next = order.slice()
  let i = from
  let j = to
  while (i < j) {
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
    i += 1
    j -= 1
  }
  return next
}

function movedSegment(
  order: readonly number[],
  from: number,
  length: number,
  target: number,
): number[] {
  const next = order.slice()
  const segment = next.splice(from, length)
  next.splice(target, 0, ...segment)
  return next
}

/** Ein Durchlauf 2-opt; Verbesserungen werden sofort uebernommen. */
function twoOptPass(current: Solution, ctx: Context): Solution {
  let best = current
  for (let i = ctx.lo; i < ctx.hi; i += 1) {
    for (let j = i + 1; j <= ctx.hi; j += 1) {
      const candidate = evaluate(reversedSegment(best.order, i, j), ctx)
      if (better(candidate, best)) best = candidate
    }
  }
  return best
}

/** Ein Durchlauf Or-opt: Segmente der Laenge 1..3 an andere Stellen verschieben. */
function orOptPass(current: Solution, ctx: Context): Solution {
  let best = current
  for (let length = 1; length <= MAX_SEGMENT; length += 1) {
    for (let from = ctx.lo; from + length - 1 <= ctx.hi; from += 1) {
      for (let target = ctx.lo; target + length - 1 <= ctx.hi; target += 1) {
        if (target === from) continue
        const candidate = evaluate(movedSegment(best.order, from, length, target), ctx)
        if (better(candidate, best)) best = candidate
      }
    }
  }
  return best
}

/**
 * Sucht eine gute Besuchsreihenfolge. `improvedFrom` ist stets der Plan der
 * uebergebenen Ausgangsreihenfolge, damit der Gewinn ausgewiesen werden kann.
 */
export function optimizeOrder(
  stops: readonly PlanStopInput[],
  matrix: TravelMatrix,
  options: PlanOptions,
): OptimizeResult {
  const count = stops.length
  const identity: number[] = []
  for (let i = 0; i < count; i += 1) identity.push(i)

  const improvedFrom = computeSchedule(identity, stops, matrix, options)

  if (count <= 1) {
    return {
      order: identity,
      schedule: computeSchedule(identity, stops, matrix, options),
      improvedFrom,
    }
  }

  const startIndex = normalizeIndex(options.fixedStartIndex, count)
  const rawEnd = normalizeIndex(options.fixedEndIndex, count)
  // Zeigen Start und Ende auf denselben Stopp, gewinnt der Start.
  const endIndex = rawEnd !== null && rawEnd === startIndex ? null : rawEnd

  const lo = startIndex !== null ? 1 : 0
  const hi = endIndex !== null ? count - 2 : count - 1
  const ctx: Context = { stops, matrix, options, lo, hi }

  // Alle Knoten, die als erster Stopp in Frage kommen bzw. frei einsortiert werden.
  const pool = identity.filter((index) => index !== endIndex)

  let starts: number[]
  if (startIndex !== null) {
    starts = [startIndex]
  } else if (count > MULTISTART_THRESHOLD) {
    starts = rankedStarts(pool, ctx).slice(0, MULTISTART_LIMIT)
  } else {
    starts = pool.slice()
  }

  let best = evaluate(applyFixed(identity, startIndex, endIndex), ctx)
  for (const first of starts) {
    const candidate = evaluate(nearestNeighbour(first, pool, endIndex, ctx), ctx)
    if (better(candidate, best)) best = candidate
  }

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const afterTwoOpt = twoOptPass(best, ctx)
    const afterOrOpt = orOptPass(afterTwoOpt, ctx)
    if (afterOrOpt === best) break
    best = afterOrOpt
  }

  return { order: best.order, schedule: best.schedule, improvedFrom }
}
