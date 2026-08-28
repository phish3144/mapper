/**
 * Typen der Routenplanung. Reine Datenstrukturen - keine Abhaengigkeit zu
 * React, Supabase oder dem Routing-Backend.
 */
import type { LatLng, TimeWindow } from '@/types/domain'

/** Ein zu verplanender Stopp. `point` dient nur als Notnagel, wenn die Matrix eine Kante nicht kennt. */
export interface PlanStopInput {
  locationId: string
  point: LatLng
  serviceMinutes: number
  timeWindows: TimeWindow[]
}

export interface PlanOptions {
  /** Geplante Abfahrt. Ist sie null, wird ohne Uhrzeiten allein die Fahrzeit optimiert. */
  departAt: Date | null
  /** Index in `stops`, der zwingend zuerst besucht wird. */
  fixedStartIndex: number | null
  /** Index in `stops`, der zwingend zuletzt besucht wird. */
  fixedEndIndex: number | null
  /** Rueckfahrt zum ersten Stopp. Setzt `fixedEndIndex` nicht ausser Kraft. */
  roundtrip: boolean
}

/** 'late' = nach Ende aller Fenster des Tages, 'closed-day' = an diesem Wochentag geschlossen. */
export type StopViolation = 'none' | 'late' | 'closed-day'

export interface ScheduledStop {
  locationId: string
  /** Index des Stopps in der uebergebenen `stops`-Liste. */
  index: number
  arrival: Date | null
  departure: Date | null
  /** Wartezeit in Minuten, bis das Zeitfenster oeffnet. */
  waitMinutes: number
  travelSecFromPrev: number
  travelMetersFromPrev: number
  violation: StopViolation
}

export interface Schedule {
  stops: ScheduledStop[]
  totalTravelSec: number
  totalDistanceM: number
  totalWaitMinutes: number
  totalServiceMinutes: number
  /** Ende der Tour inklusive Rueckfahrt; null ohne geplante Abfahrt. */
  finishAt: Date | null
  violations: number
}

export interface OptimizeResult {
  order: number[]
  schedule: Schedule
  /** Plan der urspruenglichen Reihenfolge, damit die Oberflaeche den Gewinn ausweisen kann. */
  improvedFrom: Schedule
}
