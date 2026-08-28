/**
 * Datenzugriff. Duenne, typisierte Huelle um supabase-js — jede Funktion
 * entspricht genau einer Absicht, damit die Oberflaeche keine Abfragen baut.
 *
 * Grundsatz: Zugriffsrechte werden NICHT hier geprueft, sondern von Row Level
 * Security in der Datenbank. Diese Schicht darf also getrost alles anbieten;
 * was der angemeldeten Person nicht zusteht, kommt schlicht nicht zurueck.
 */
import { supabase } from './supabase'
import type {
  Category,
  EntityKind,
  Group,
  LocationGroup,
  MapLocation,
  MemberRole,
  Profile,
  Route,
  RouteRule,
  RouteStop,
  VisibilityGrant,
  VisibilityLevel,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
} from '@/types/domain'
import { normalizeRule } from './rules'

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  if (res.data === null) throw new Error('Kein Ergebnis erhalten.')
  return res.data
}

/** Die Regel kommt als jsonb zurueck und ist zur Laufzeit nicht garantiert wohlgeformt. */
function hydrateRoute(row: Route): Route {
  return { ...row, rule: normalizeRule(row.rule) }
}

/** time_windows kommt ebenfalls als jsonb. */
function hydrateLocation(row: MapLocation): MapLocation {
  const windows = Array.isArray(row.time_windows) ? row.time_windows : []
  return {
    ...row,
    time_windows: windows.filter(
      (w) => w && typeof w.dow === 'number' && typeof w.from === 'string' && typeof w.to === 'string',
    ),
    tags: Array.isArray(row.tags) ? row.tags : [],
  }
}

// ---------------------------------------------------------------------------
// Profil und Konten
// ---------------------------------------------------------------------------

export async function fetchMyProfile(): Promise<Profile | null> {
  const { data: userRes } = await supabase.auth.getUser()
  const uid = userRes.user?.id
  if (!uid) return null
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
  if (error) throw error
  return data as Profile | null
}

export async function updateMyProfile(patch: { display_name?: string }): Promise<Profile> {
  const { data: userRes } = await supabase.auth.getUser()
  const uid = userRes.user?.id
  if (!uid) throw new Error('Nicht angemeldet.')
  return unwrap(
    await supabase.from('profiles').update(patch).eq('id', uid).select('*').single(),
  ) as Profile
}

/** Loest Einladungen ein, die auf die eigene Adresse ausgestellt wurden. */
export async function acceptPendingInvites(): Promise<number> {
  const { data, error } = await supabase.rpc('accept_pending_invites')
  if (error) throw error
  return (data as number) ?? 0
}

// ---------------------------------------------------------------------------
// Arbeitsbereiche
// ---------------------------------------------------------------------------

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await supabase.from('workspaces').select('*').order('name')
  if (error) throw error
  return (data ?? []) as Workspace[]
}

/**
 * Ueber RPC, nicht per INSERT: ein direktes INSERT .. RETURNING scheitert an der
 * SELECT-Policy, weil die Eigentuemer-Mitgliedschaft erst im AFTER-Trigger
 * entsteht und zum Pruefzeitpunkt noch nicht existiert.
 */
export async function createWorkspace(name: string, color = '#2563eb'): Promise<Workspace> {
  const { data, error } = await supabase.rpc('create_workspace', { p_name: name, p_color: color })
  if (error) throw error
  return data as Workspace
}

export async function updateWorkspace(id: string, patch: Partial<Pick<Workspace, 'name' | 'color'>>): Promise<Workspace> {
  return unwrap(await supabase.from('workspaces').update(patch).eq('id', id).select('*').single()) as Workspace
}

export async function deleteWorkspace(id: string): Promise<void> {
  const { error } = await supabase.from('workspaces').delete().eq('id', id)
  if (error) throw error
}

export async function fetchMyMemberships(): Promise<WorkspaceMember[]> {
  const { data: userRes } = await supabase.auth.getUser()
  const uid = userRes.user?.id
  if (!uid) return []
  const { data, error } = await supabase.from('workspace_members').select('*').eq('user_id', uid)
  if (error) throw error
  return (data ?? []) as WorkspaceMember[]
}

export interface MemberWithProfile extends WorkspaceMember {
  profile: Pick<Profile, 'id' | 'email' | 'display_name'> | null
}

export async function fetchMembers(workspaceId: string): Promise<MemberWithProfile[]> {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('*, profile:profiles(id, email, display_name)')
    .eq('workspace_id', workspaceId)
  if (error) throw error
  return (data ?? []) as MemberWithProfile[]
}

export async function setMemberRole(workspaceId: string, userId: string, role: MemberRole): Promise<void> {
  const { error } = await supabase
    .from('workspace_members')
    .update({ role })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function fetchInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
  const { data, error } = await supabase
    .from('workspace_invites')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as WorkspaceInvite[]
}

export async function inviteToWorkspace(workspaceId: string, email: string, role: MemberRole): Promise<WorkspaceInvite> {
  const { data: userRes } = await supabase.auth.getUser()
  const uid = userRes.user?.id
  if (!uid) throw new Error('Nicht angemeldet.')
  return unwrap(
    await supabase
      .from('workspace_invites')
      .insert({ workspace_id: workspaceId, email: email.trim().toLowerCase(), role, invited_by: uid })
      .select('*')
      .single(),
  ) as WorkspaceInvite
}

export async function revokeInvite(id: string): Promise<void> {
  const { error } = await supabase.from('workspace_invites').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Kategorien und Gruppen
// ---------------------------------------------------------------------------

export type CategoryInput = Pick<Category, 'name' | 'color' | 'icon'> &
  Partial<Pick<Category, 'description' | 'sort_order' | 'visibility'>>

export async function fetchCategories(workspaceId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('sort_order')
    .order('name')
  if (error) throw error
  return (data ?? []) as Category[]
}

export async function createCategory(workspaceId: string, input: CategoryInput): Promise<Category> {
  const { data: userRes } = await supabase.auth.getUser()
  return unwrap(
    await supabase
      .from('categories')
      .insert({ ...input, workspace_id: workspaceId, created_by: userRes.user?.id })
      .select('*')
      .single(),
  ) as Category
}

export async function updateCategory(id: string, patch: Partial<CategoryInput>): Promise<Category> {
  return unwrap(await supabase.from('categories').update(patch).eq('id', id).select('*').single()) as Category
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

export type GroupInput = Pick<Group, 'name' | 'color'> &
  Partial<Pick<Group, 'description' | 'sort_order' | 'visibility'>>

export async function fetchGroups(workspaceId: string): Promise<Group[]> {
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('sort_order')
    .order('name')
  if (error) throw error
  return (data ?? []) as Group[]
}

export async function createGroup(workspaceId: string, input: GroupInput): Promise<Group> {
  const { data: userRes } = await supabase.auth.getUser()
  return unwrap(
    await supabase
      .from('groups')
      .insert({ ...input, workspace_id: workspaceId, created_by: userRes.user?.id })
      .select('*')
      .single(),
  ) as Group
}

export async function updateGroup(id: string, patch: Partial<GroupInput>): Promise<Group> {
  return unwrap(await supabase.from('groups').update(patch).eq('id', id).select('*').single()) as Group
}

export async function deleteGroup(id: string): Promise<void> {
  const { error } = await supabase.from('groups').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Standorte
// ---------------------------------------------------------------------------

export type LocationInput = Pick<MapLocation, 'name' | 'lat' | 'lng'> &
  Partial<
    Pick<
      MapLocation,
      | 'category_id'
      | 'address'
      | 'notes'
      | 'service_minutes'
      | 'time_windows'
      | 'tags'
      | 'is_active'
      | 'visibility'
    >
  >

export async function fetchLocations(workspaceId: string): Promise<MapLocation[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name')
  if (error) throw error
  return ((data ?? []) as MapLocation[]).map(hydrateLocation)
}

export async function createLocation(workspaceId: string, input: LocationInput): Promise<MapLocation> {
  const { data: userRes } = await supabase.auth.getUser()
  const row = unwrap(
    await supabase
      .from('locations')
      .insert({ ...input, workspace_id: workspaceId, created_by: userRes.user?.id })
      .select('*')
      .single(),
  ) as MapLocation
  return hydrateLocation(row)
}

export async function updateLocation(id: string, patch: Partial<LocationInput>): Promise<MapLocation> {
  const row = unwrap(
    await supabase.from('locations').update(patch).eq('id', id).select('*').single(),
  ) as MapLocation
  return hydrateLocation(row)
}

export async function deleteLocation(id: string): Promise<void> {
  const { error } = await supabase.from('locations').delete().eq('id', id)
  if (error) throw error
}

/** Mehrere Standorte auf einmal — fuer den Import. */
export async function createLocations(workspaceId: string, inputs: LocationInput[]): Promise<MapLocation[]> {
  if (inputs.length === 0) return []
  const { data: userRes } = await supabase.auth.getUser()
  const uid = userRes.user?.id
  const rows = inputs.map((i) => ({ ...i, workspace_id: workspaceId, created_by: uid }))
  const { data, error } = await supabase.from('locations').insert(rows).select('*')
  if (error) throw error
  return ((data ?? []) as MapLocation[]).map(hydrateLocation)
}

// ---------------------------------------------------------------------------
// Zuordnung Standort <-> Gruppe
// ---------------------------------------------------------------------------

export async function fetchLocationGroups(workspaceId: string): Promise<LocationGroup[]> {
  // Ueber die Gruppen des Bereichs filtern; location_groups traegt selbst keine
  // workspace_id, RLS liefert aber ohnehin nur Sichtbares.
  const { data: groups, error: gErr } = await supabase.from('groups').select('id').eq('workspace_id', workspaceId)
  if (gErr) throw gErr
  const ids = (groups ?? []).map((g) => (g as { id: string }).id)
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('location_groups').select('*').in('group_id', ids)
  if (error) throw error
  return (data ?? []) as LocationGroup[]
}

export async function setLocationGroups(locationId: string, groupIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from('location_groups').delete().eq('location_id', locationId)
  if (delErr) throw delErr
  if (groupIds.length === 0) return
  const { error } = await supabase
    .from('location_groups')
    .insert(groupIds.map((group_id) => ({ location_id: locationId, group_id })))
  if (error) throw error
}

export async function addLocationsToGroup(locationIds: string[], groupId: string): Promise<void> {
  if (locationIds.length === 0) return
  const { error } = await supabase
    .from('location_groups')
    .upsert(
      locationIds.map((location_id) => ({ location_id, group_id: groupId })),
      { onConflict: 'location_id,group_id', ignoreDuplicates: true },
    )
  if (error) throw error
}

export async function removeLocationsFromGroup(locationIds: string[], groupId: string): Promise<void> {
  if (locationIds.length === 0) return
  const { error } = await supabase
    .from('location_groups')
    .delete()
    .eq('group_id', groupId)
    .in('location_id', locationIds)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------

export type RouteInput = Pick<Route, 'name'> &
  Partial<
    Pick<
      Route,
      | 'description'
      | 'profile'
      | 'mode'
      | 'start_location_id'
      | 'end_location_id'
      | 'roundtrip'
      | 'depart_at'
      | 'default_service_minutes'
      | 'visibility'
    >
  > & { rule?: RouteRule }

export async function fetchRoutes(workspaceId: string): Promise<Route[]> {
  const { data, error } = await supabase
    .from('routes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name')
  if (error) throw error
  return ((data ?? []) as Route[]).map(hydrateRoute)
}

export async function createRoute(workspaceId: string, input: RouteInput): Promise<Route> {
  const { data: userRes } = await supabase.auth.getUser()
  const row = unwrap(
    await supabase
      .from('routes')
      .insert({ ...input, workspace_id: workspaceId, created_by: userRes.user?.id })
      .select('*')
      .single(),
  ) as Route
  return hydrateRoute(row)
}

export async function updateRoute(id: string, patch: Partial<RouteInput>): Promise<Route> {
  const row = unwrap(await supabase.from('routes').update(patch).eq('id', id).select('*').single()) as Route
  return hydrateRoute(row)
}

export async function deleteRoute(id: string): Promise<void> {
  const { error } = await supabase.from('routes').delete().eq('id', id)
  if (error) throw error
}

export async function fetchRouteStops(routeId: string): Promise<RouteStop[]> {
  const { data, error } = await supabase
    .from('route_stops')
    .select('*')
    .eq('route_id', routeId)
    .order('position')
  if (error) throw error
  return (data ?? []) as RouteStop[]
}

export async function addRouteStop(
  routeId: string,
  locationId: string,
  position: number,
): Promise<RouteStop> {
  return unwrap(
    await supabase
      .from('route_stops')
      .insert({ route_id: routeId, location_id: locationId, position })
      .select('*')
      .single(),
  ) as RouteStop
}

export async function addRouteStops(routeId: string, locationIds: string[], startPosition = 0): Promise<RouteStop[]> {
  if (locationIds.length === 0) return []
  const rows = locationIds.map((location_id, i) => ({
    route_id: routeId,
    location_id,
    position: startPosition + i,
  }))
  const { data, error } = await supabase.from('route_stops').insert(rows).select('*')
  if (error) throw error
  return (data ?? []) as RouteStop[]
}

export async function updateRouteStop(
  id: string,
  patch: Partial<Pick<RouteStop, 'service_minutes_override' | 'note'>>,
): Promise<RouteStop> {
  return unwrap(await supabase.from('route_stops').update(patch).eq('id', id).select('*').single()) as RouteStop
}

export async function removeRouteStop(id: string): Promise<void> {
  const { error } = await supabase.from('route_stops').delete().eq('id', id)
  if (error) throw error
}

export async function clearRouteStops(routeId: string): Promise<void> {
  const { error } = await supabase.from('route_stops').delete().eq('route_id', routeId)
  if (error) throw error
}

/**
 * Neu ordnen in EINEM Aufruf. Einzelne UPDATEs wuerden an der
 * Positions-Eindeutigkeit scheitern, sobald zwei Stopps kurzzeitig dieselbe
 * Position traegen; supabase-js kann keine mehrteilige Transaktion fahren.
 */
export async function reorderRouteStops(routeId: string, orderedStopIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_route_stops', {
    p_route_id: routeId,
    p_stop_ids: orderedStopIds,
  })
  if (error) throw error
}

/** Ersetzt die Stoppliste vollstaendig — fuer regelbasierte Routen. */
export async function replaceRouteStops(routeId: string, locationIds: string[]): Promise<RouteStop[]> {
  await clearRouteStops(routeId)
  return addRouteStops(routeId, locationIds, 0)
}

// ---------------------------------------------------------------------------
// Sichtbarkeiten
// ---------------------------------------------------------------------------

export async function fetchVisibilityGrants(workspaceId: string): Promise<VisibilityGrant[]> {
  const { data, error } = await supabase
    .from('visibility_grants')
    .select('*')
    .eq('workspace_id', workspaceId)
  if (error) throw error
  return (data ?? []) as VisibilityGrant[]
}

export async function setVisibility(
  table: 'categories' | 'groups' | 'locations' | 'routes',
  id: string,
  visibility: VisibilityLevel,
): Promise<void> {
  const { error } = await supabase.from(table).update({ visibility }).eq('id', id)
  if (error) throw error
}

export async function grantVisibility(
  workspaceId: string,
  kind: EntityKind,
  entityId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('visibility_grants')
    .upsert(
      { workspace_id: workspaceId, entity_kind: kind, entity_id: entityId, user_id: userId },
      { onConflict: 'entity_kind,entity_id,user_id', ignoreDuplicates: true },
    )
  if (error) throw error
}

export async function revokeVisibility(kind: EntityKind, entityId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('visibility_grants')
    .delete()
    .eq('entity_kind', kind)
    .eq('entity_id', entityId)
    .eq('user_id', userId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Kontenverwaltung (Edge Function, weil dafuer der service_role-Schluessel
// noetig ist — der niemals ins Browser-Bundle gehoert)
// ---------------------------------------------------------------------------

export interface AdminAccount {
  id: string
  email: string
  display_name: string | null
  is_app_admin: boolean
  created_at: string
  workspace_count?: number
}

async function callAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    // Die Edge Function liefert ihre eigene Meldung im Rumpf; supabase-js
    // verpackt sie in einen generischen FunctionsHttpError.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = (await ctx.json()) as { error?: string }
        if (payload?.error) throw new Error(payload.error)
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message && !/JSON/i.test(parseError.message)) {
          throw parseError
        }
      }
    }
    throw error
  }
  const payload = data as { data?: T; error?: string }
  if (payload?.error) throw new Error(payload.error)
  return payload?.data as T
}

export const admin = {
  listAccounts: () => callAdmin<AdminAccount[]>({ action: 'list' }),
  createAccount: (input: {
    email: string
    password: string
    display_name?: string
    is_app_admin?: boolean
    workspace_id?: string
    role?: MemberRole
  }) => callAdmin<AdminAccount>({ action: 'create', ...input }),
  resetPassword: (user_id: string, password: string) =>
    callAdmin<{ ok: true }>({ action: 'reset-password', user_id, password }),
  setAdmin: (user_id: string, is_app_admin: boolean) =>
    callAdmin<{ ok: true }>({ action: 'set-admin', user_id, is_app_admin }),
  deleteAccount: (user_id: string) => callAdmin<{ ok: true }>({ action: 'delete', user_id }),
}
