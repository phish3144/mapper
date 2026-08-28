/**
 * Zustand der Oberflaeche — bewusst getrennt vom Datenspeicher in store.ts.
 * Was hier liegt, ueberlebt kein Neuladen und gehoert niemandem sonst:
 * Auswahl, Filter, Kartenausschnitt.
 *
 * Filter stehen hier und nicht in den einzelnen Ansichten, weil Karte und
 * Liste zwingend dasselbe zeigen muessen. Zwei Filterzustaende waeren die
 * sichere Quelle fuer "die Karte zeigt etwas anderes als die Liste".
 */
import { create } from 'zustand'
import type { LatLng, MapLocation } from '@/types/domain'
import { withinRadius } from './geo'

export type PanelTab = 'locations' | 'catalog' | 'routes'

export interface LocationFilter {
  search: string
  categoryIds: string[]
  groupIds: string[]
  tags: string[]
  onlyActive: boolean
  /** Umkreisfilter, gesetzt ueber das Kartenwerkzeug. */
  center: LatLng | null
  radiusKm: number | null
}

export const EMPTY_FILTER: LocationFilter = {
  search: '',
  categoryIds: [],
  groupIds: [],
  tags: [],
  onlyActive: false,
  center: null,
  radiusKm: null,
}

/** Auftrag an die Karte, einen Ausschnitt anzuspringen. */
export interface MapFocus {
  /** Zaehler, damit derselbe Punkt zweimal hintereinander erneut angesprungen wird. */
  nonce: number
  point?: LatLng
  zoom?: number
  points?: LatLng[]
}

interface UiState {
  tab: PanelTab
  selectedLocationId: string | null
  /** Mehrfachauswahl fuer Massenaktionen (Gruppe zuweisen, loeschen, in Route). */
  checkedLocationIds: string[]
  activeRouteId: string | null
  editingLocationId: string | null
  /** Beim Anlegen per Kartenklick: der vorgemerkte Punkt. */
  draftPoint: LatLng | null
  pickingPoint: boolean
  filter: LocationFilter
  focus: MapFocus | null
  sidebarOpen: boolean
  theme: 'light' | 'dark' | 'system'

  setTab: (tab: PanelTab) => void
  selectLocation: (id: string | null) => void
  toggleChecked: (id: string) => void
  setChecked: (ids: string[]) => void
  clearChecked: () => void
  setActiveRoute: (id: string | null) => void
  setEditingLocation: (id: string | null) => void
  setDraftPoint: (p: LatLng | null) => void
  setPickingPoint: (on: boolean) => void
  patchFilter: (patch: Partial<LocationFilter>) => void
  resetFilter: () => void
  focusPoint: (point: LatLng, zoom?: number) => void
  focusBounds: (points: LatLng[]) => void
  setSidebarOpen: (open: boolean) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
}

const THEME_KEY = 'mapper.theme'

function readTheme(): 'light' | 'dark' | 'system' {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

let focusNonce = 0

export const useUi = create<UiState>()((set) => ({
  tab: 'locations',
  selectedLocationId: null,
  checkedLocationIds: [],
  activeRouteId: null,
  editingLocationId: null,
  draftPoint: null,
  pickingPoint: false,
  filter: EMPTY_FILTER,
  focus: null,
  sidebarOpen: true,
  theme: readTheme(),

  setTab: (tab) => set({ tab }),
  selectLocation: (id) => set({ selectedLocationId: id }),
  toggleChecked: (id) =>
    set((s) => ({
      checkedLocationIds: s.checkedLocationIds.includes(id)
        ? s.checkedLocationIds.filter((x) => x !== id)
        : [...s.checkedLocationIds, id],
    })),
  setChecked: (ids) => set({ checkedLocationIds: ids }),
  clearChecked: () => set({ checkedLocationIds: [] }),
  setActiveRoute: (id) => set({ activeRouteId: id }),
  setEditingLocation: (id) => set({ editingLocationId: id }),
  setDraftPoint: (p) => set({ draftPoint: p }),
  setPickingPoint: (on) => set({ pickingPoint: on }),
  patchFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  resetFilter: () => set({ filter: EMPTY_FILTER }),
  focusPoint: (point, zoom) => set({ focus: { nonce: ++focusNonce, point, zoom } }),
  focusBounds: (points) => set({ focus: { nonce: ++focusNonce, points } }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    applyTheme(theme)
    set({ theme })
  },
}))

/**
 * Wendet den Oberflaechenfilter an. Reine Funktion, damit Karte und Liste
 * garantiert dieselbe Menge zeigen.
 */
export function filterLocations(
  locations: MapLocation[],
  filter: LocationFilter,
  membership: Map<string, string[]>,
): MapLocation[] {
  const needle = filter.search.trim().toLowerCase()
  const cats = filter.categoryIds.length > 0 ? new Set(filter.categoryIds) : null
  const grps = filter.groupIds.length > 0 ? new Set(filter.groupIds) : null
  const tags = filter.tags.length > 0 ? filter.tags.map((t) => t.toLowerCase()) : null

  return locations.filter((l) => {
    if (filter.onlyActive && !l.is_active) return false
    if (cats && (!l.category_id || !cats.has(l.category_id))) return false
    if (grps) {
      const mine = membership.get(l.id)
      if (!mine || !mine.some((g) => grps.has(g))) return false
    }
    if (tags) {
      const own = l.tags.map((t) => t.toLowerCase())
      if (!tags.some((t) => own.includes(t))) return false
    }
    if (filter.center && filter.radiusKm && filter.radiusKm > 0) {
      if (!withinRadius(filter.center, { lat: l.lat, lng: l.lng }, filter.radiusKm)) return false
    }
    if (needle) {
      const hay = `${l.name} ${l.address ?? ''} ${l.notes ?? ''} ${l.tags.join(' ')}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })
}

export function isFilterActive(f: LocationFilter): boolean {
  return (
    f.search.trim() !== '' ||
    f.categoryIds.length > 0 ||
    f.groupIds.length > 0 ||
    f.tags.length > 0 ||
    f.onlyActive ||
    (f.center !== null && f.radiusKm !== null && f.radiusKm > 0)
  )
}
