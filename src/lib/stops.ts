/**
 * Der Ort eines Routenstopps.
 *
 * Ein Stopp verweist auf einen Standort, muss aber ohne ihn auskommen: seit
 * die Verknuepfung beim Loeschen nur noch geleert wird, gibt es Stopps ohne
 * Standort. Sie sind kein Fehlerfall, sondern der Normalfall einer Tour, die
 * ihr Aufraeumen ueberlebt hat.
 *
 * Damit nicht jede Ansicht diesen Fall einzeln behandeln muss, liefert
 * stopPlace() immer etwas Standortfoermiges - entweder den echten Standort
 * oder einen Platzhalter aus dem, was der Stopp selbst weiss.
 */
import type { MapLocation, RouteStop } from '@/types/domain'

/** Wie ein Stopp heisst, dessen Standort geloescht wurde und der keine Beschriftung hat. */
export const ORPHAN_FALLBACK_NAME = 'Gelöschter Standort'

/**
 * Der Standort eines Stopps, notfalls als Platzhalter.
 *
 * Die leere Kennung ist die Unterscheidung: `place.id === ''` heisst "diesen
 * Standort gibt es nicht mehr". Alles, was auf Kennungen zugreift
 * (Gruppenfarben, Auswahl, Kategorien), laeuft damit ins Leere statt auf einen
 * erfundenen Datensatz - genau richtig, denn ein geloeschter Standort hat
 * weder Gruppe noch Kategorie.
 */
export function stopPlace(stop: RouteStop, location: MapLocation | undefined): MapLocation {
  if (location) return location
  return {
    id: '',
    workspace_id: '',
    category_id: null,
    name: stop.label?.trim() || ORPHAN_FALLBACK_NAME,
    icon: null,
    lat: stop.lat,
    lng: stop.lng,
    address: null,
    notes: null,
    service_minutes: 0,
    time_windows: [],
    tags: [],
    is_active: true,
    visibility: 'workspace',
    created_by: null,
    created_at: stop.created_at,
    updated_at: stop.created_at,
  }
}
