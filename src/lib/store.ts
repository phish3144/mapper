/**
 * Zentraler Zustand. Ein einziger Speicher statt verstreuter Kontexte, weil
 * fast jede Ansicht dieselben Stammdaten braucht (Kategorien, Gruppen,
 * Standorte) und diese pro Arbeitsbereich genau einmal geladen werden sollen.
 *
 * Die Schreibaktionen aktualisieren den Zustand optimistisch NICHT — sie warten
 * auf die Datenbank und uebernehmen deren Antwort. Bei aktiver Row Level
 * Security ist das der ehrlichere Weg: was die Datenbank ablehnt, darf auch in
 * der Oberflaeche nicht kurz erscheinen.
 */
import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import * as db from './db'
import { supabase, describeError, appRedirectUrl } from './supabase'
import { resetProxyState } from './geocode'
import type {
  Category,
  Group,
  LocationGroup,
  MapLocation,
  MemberRole,
  Profile,
  Route,
  RouteStop,
  VisibilityGrant,
  Workspace,
} from '@/types/domain'
import { roleAtLeast } from '@/types/domain'

export interface Notice {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

interface State {
  session: Session | null
  profile: Profile | null
  authReady: boolean

  workspaces: Workspace[]
  myRoles: Record<string, MemberRole>
  currentWorkspaceId: string | null

  categories: Category[]
  groups: Group[]
  locations: MapLocation[]
  locationGroups: LocationGroup[]
  routes: Route[]
  stopsByRoute: Record<string, RouteStop[]>
  grants: VisibilityGrant[]

  loadingWorkspace: boolean
  notices: Notice[]
}

interface Actions {
  init: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signOut: () => Promise<void>

  notify: (kind: Notice['kind'], text: string) => void
  dismissNotice: (id: number) => void
  reportError: (error: unknown) => void

  loadWorkspaces: () => Promise<void>
  selectWorkspace: (id: string | null) => Promise<void>
  reloadWorkspaceData: () => Promise<void>
  addWorkspace: (name: string, color?: string) => Promise<Workspace | null>

  refreshCategories: () => Promise<void>
  refreshGroups: () => Promise<void>
  refreshLocations: () => Promise<void>
  refreshRoutes: () => Promise<void>
  loadStops: (routeId: string) => Promise<void>
  setStops: (routeId: string, stops: RouteStop[]) => void
}

let noticeId = 0

const EMPTY_WORKSPACE_DATA = {
  categories: [] as Category[],
  groups: [] as Group[],
  locations: [] as MapLocation[],
  locationGroups: [] as LocationGroup[],
  routes: [] as Route[],
  stopsByRoute: {} as Record<string, RouteStop[]>,
  grants: [] as VisibilityGrant[],
}

const LAST_WORKSPACE_KEY = 'mapper.lastWorkspace'

export const useStore = create<State & Actions>()((set, get) => ({
  session: null,
  profile: null,
  authReady: false,
  workspaces: [],
  myRoles: {},
  currentWorkspaceId: null,
  ...EMPTY_WORKSPACE_DATA,
  loadingWorkspace: false,
  notices: [],

  notify: (kind, text) =>
    set((s) => ({ notices: [...s.notices, { id: ++noticeId, kind, text }] })),

  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

  reportError: (error) => {
    console.error(error)
    get().notify('error', describeError(error))
  },

  init: async () => {
    const { data } = await supabase.auth.getSession()
    set({ session: data.session, authReady: true })

    supabase.auth.onAuthStateChange((_event, session) => {
      const had = get().session?.user.id
      set({ session })
      // Der Bote fuer die Adresssuche verlangt ein angemeldetes Konto. Wer
      // vor der Anmeldung suchte, hat ihn abgeschaltet - mit der Anmeldung
      // bekommt er seine Chance zurueck.
      resetProxyState()
      if (!session) {
        set({ profile: null, workspaces: [], myRoles: {}, currentWorkspaceId: null, ...EMPTY_WORKSPACE_DATA })
      } else if (session.user.id !== had) {
        void get().loadWorkspaces()
      }
    })

    if (data.session) await get().loadWorkspaces()
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw error
    await get().loadWorkspaces()
  },

  signUp: async (email, password, displayName) => {
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: displayName.trim() },
        emailRedirectTo: appRedirectUrl(),
      },
    })
    if (error) throw error
    // Ohne E-Mail-Bestaetigung liefert signUp bereits eine Sitzung. Ist die
    // Bestaetigung im Projekt aktiv, gibt es keine — dann meldet die Oberflaeche
    // das gesondert.
    const { data } = await supabase.auth.getSession()
    if (data.session) await get().loadWorkspaces()
  },

  signOut: async () => {
    await supabase.auth.signOut()
    localStorage.removeItem(LAST_WORKSPACE_KEY)
    set({ profile: null, workspaces: [], myRoles: {}, currentWorkspaceId: null, ...EMPTY_WORKSPACE_DATA })
  },

  loadWorkspaces: async () => {
    try {
      // Zuerst offene Einladungen einloesen: wer eingeladen wurde, nachdem er
      // sich bereits registriert hatte, wuerde den Bereich sonst nie sehen.
      try {
        const claimed = await db.acceptPendingInvites()
        if (claimed > 0) {
          get().notify('success', `${claimed} Einladung${claimed === 1 ? '' : 'en'} angenommen.`)
        }
      } catch {
        // Nicht kritisch — der Rest funktioniert auch ohne.
      }

      const [profile, workspaces, memberships] = await Promise.all([
        db.fetchMyProfile(),
        db.fetchWorkspaces(),
        db.fetchMyMemberships(),
      ])
      const myRoles: Record<string, MemberRole> = {}
      for (const m of memberships) myRoles[m.workspace_id] = m.role

      set({ profile, workspaces, myRoles })

      const stored = localStorage.getItem(LAST_WORKSPACE_KEY)
      const current = get().currentWorkspaceId
      const wanted =
        (current && workspaces.some((w) => w.id === current) && current) ||
        (stored && workspaces.some((w) => w.id === stored) && stored) ||
        workspaces[0]?.id ||
        null
      if (wanted !== current || wanted === null) {
        await get().selectWorkspace(wanted)
      }
    } catch (error) {
      get().reportError(error)
    }
  },

  selectWorkspace: async (id) => {
    set({ currentWorkspaceId: id, ...EMPTY_WORKSPACE_DATA })
    if (id) localStorage.setItem(LAST_WORKSPACE_KEY, id)
    else localStorage.removeItem(LAST_WORKSPACE_KEY)
    if (id) await get().reloadWorkspaceData()
  },

  reloadWorkspaceData: async () => {
    const id = get().currentWorkspaceId
    if (!id) return
    set({ loadingWorkspace: true })
    try {
      const [categories, groups, locations, locationGroups, routes, grants] = await Promise.all([
        db.fetchCategories(id),
        db.fetchGroups(id),
        db.fetchLocations(id),
        db.fetchLocationGroups(id),
        db.fetchRoutes(id),
        db.fetchVisibilityGrants(id),
      ])
      // Zwischenzeitlicher Bereichswechsel darf nicht ueberschrieben werden.
      if (get().currentWorkspaceId !== id) return
      set({ categories, groups, locations, locationGroups, routes, grants })
    } catch (error) {
      get().reportError(error)
    } finally {
      set({ loadingWorkspace: false })
    }
  },

  addWorkspace: async (name, color) => {
    try {
      const ws = await db.createWorkspace(name, color)
      set((s) => ({
        workspaces: [...s.workspaces, ws].sort((a, b) => a.name.localeCompare(b.name, 'de')),
        myRoles: { ...s.myRoles, [ws.id]: 'owner' },
      }))
      await get().selectWorkspace(ws.id)
      return ws
    } catch (error) {
      get().reportError(error)
      return null
    }
  },

  refreshCategories: async () => {
    const id = get().currentWorkspaceId
    if (!id) return
    try {
      set({ categories: await db.fetchCategories(id) })
    } catch (error) {
      get().reportError(error)
    }
  },

  refreshGroups: async () => {
    const id = get().currentWorkspaceId
    if (!id) return
    try {
      const [groups, locationGroups] = await Promise.all([db.fetchGroups(id), db.fetchLocationGroups(id)])
      set({ groups, locationGroups })
    } catch (error) {
      get().reportError(error)
    }
  },

  refreshLocations: async () => {
    const id = get().currentWorkspaceId
    if (!id) return
    try {
      const [locations, locationGroups] = await Promise.all([
        db.fetchLocations(id),
        db.fetchLocationGroups(id),
      ])
      set({ locations, locationGroups })
    } catch (error) {
      get().reportError(error)
    }
  },

  refreshRoutes: async () => {
    const id = get().currentWorkspaceId
    if (!id) return
    try {
      set({ routes: await db.fetchRoutes(id) })
    } catch (error) {
      get().reportError(error)
    }
  },

  loadStops: async (routeId) => {
    try {
      const stops = await db.fetchRouteStops(routeId)
      set((s) => ({ stopsByRoute: { ...s.stopsByRoute, [routeId]: stops } }))
    } catch (error) {
      get().reportError(error)
    }
  },

  setStops: (routeId, stops) =>
    set((s) => ({ stopsByRoute: { ...s.stopsByRoute, [routeId]: stops } })),
}))

// ---------------------------------------------------------------------------
// Ableitungen
// ---------------------------------------------------------------------------

/** Rolle im aktuell gewaehlten Arbeitsbereich. */
export function useMyRole(): MemberRole | null {
  return useStore((s) => (s.currentWorkspaceId ? s.myRoles[s.currentWorkspaceId] ?? null : null))
}

/** Darf die angemeldete Person im aktuellen Bereich schreiben? */
export function useCanEdit(): boolean {
  const role = useMyRole()
  return roleAtLeast(role, 'editor')
}

export function useIsOwner(): boolean {
  const role = useMyRole()
  return roleAtLeast(role, 'owner')
}

export function useCurrentWorkspace(): Workspace | null {
  return useStore((s) => s.workspaces.find((w) => w.id === s.currentWorkspaceId) ?? null)
}

/** locationId -> group-ids, wie von der Regel-Engine erwartet. */
export function buildMembershipMap(locationGroups: LocationGroup[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const lg of locationGroups) {
    const list = map.get(lg.location_id)
    if (list) list.push(lg.group_id)
    else map.set(lg.location_id, [lg.group_id])
  }
  return map
}

export function categoryById(categories: Category[]): Map<string, Category> {
  return new Map(categories.map((c) => [c.id, c]))
}

export function locationById(locations: MapLocation[]): Map<string, MapLocation> {
  return new Map(locations.map((l) => [l.id, l]))
}
