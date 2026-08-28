/**
 * Fachliche Typen. Spiegeln 1:1 das Datenbankschema in supabase/migrations.
 * Enums sind als String-Unions modelliert, nicht als TS-Enum: das Projekt
 * uebersetzt mit `erasableSyntaxOnly`, echte Enums erzeugen Laufzeitcode.
 */

export type MemberRole = 'viewer' | 'editor' | 'owner'
export type VisibilityLevel = 'workspace' | 'restricted' | 'private'
export type EntityKind = 'category' | 'group' | 'location' | 'route'
export type RouteProfile = 'driving' | 'cycling' | 'walking'
export type RouteMode = 'manual' | 'rule'

/** Rangfolge der Rollen - entspricht der Deklarationsreihenfolge des Enums in Postgres. */
export const ROLE_RANK: Record<MemberRole, number> = { viewer: 0, editor: 1, owner: 2 }

export function roleAtLeast(role: MemberRole | null | undefined, min: MemberRole): boolean {
  if (!role) return false
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

export interface Profile {
  id: string
  email: string
  display_name: string | null
  is_app_admin: boolean
  created_at: string
  updated_at: string
}

export interface Workspace {
  id: string
  name: string
  color: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface WorkspaceMember {
  workspace_id: string
  user_id: string
  role: MemberRole
  created_at: string
}

export interface WorkspaceInvite {
  id: string
  workspace_id: string
  email: string
  role: MemberRole
  invited_by: string
  created_at: string
}

export interface Category {
  id: string
  workspace_id: string
  name: string
  color: string
  icon: string
  description: string | null
  sort_order: number
  visibility: VisibilityLevel
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Group {
  id: string
  workspace_id: string
  name: string
  color: string
  description: string | null
  sort_order: number
  visibility: VisibilityLevel
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Zeitfenster eines Standorts. `dow` folgt ISO-8601: 1 = Montag ... 7 = Sonntag.
 * `from`/`to` sind lokale Uhrzeiten "HH:MM". Ein Fenster mit to <= from wird
 * als ueber Mitternacht laufend interpretiert.
 */
export interface TimeWindow {
  dow: number
  from: string
  to: string
}

export interface MapLocation {
  id: string
  workspace_id: string
  category_id: string | null
  name: string
  /** Eigenes Kartensymbol; null bedeutet: Symbol der Kategorie verwenden. */
  icon: string | null
  lat: number
  lng: number
  address: string | null
  notes: string | null
  service_minutes: number
  time_windows: TimeWindow[]
  tags: string[]
  is_active: boolean
  visibility: VisibilityLevel
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface LocationGroup {
  location_id: string
  group_id: string
  created_at: string
}

export interface VisibilityGrant {
  id: string
  workspace_id: string
  entity_kind: EntityKind
  entity_id: string
  user_id: string
  created_at: string
}

/** Filter fuer regelbasierte Routen (routes.mode === 'rule'). */
export interface RouteRule {
  categoryIds?: string[]
  groupIds?: string[]
  tags?: string[]
  /** Verknuepfung mehrerer Tags: alle oder mindestens einer. */
  tagMatch?: 'any' | 'all'
  center?: { lat: number; lng: number } | null
  radiusKm?: number | null
  onlyActive?: boolean
  /** Obergrenze fuer die Zahl der Stopps, greift nach der Sortierung. */
  maxStops?: number | null
}

export interface Route {
  id: string
  workspace_id: string
  name: string
  description: string | null
  profile: RouteProfile
  mode: RouteMode
  rule: RouteRule
  start_location_id: string | null
  end_location_id: string | null
  roundtrip: boolean
  depart_at: string | null
  default_service_minutes: number
  visibility: VisibilityLevel
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface RouteStop {
  id: string
  route_id: string
  location_id: string
  position: number
  service_minutes_override: number | null
  note: string | null
  created_at: string
}

export interface LatLng {
  lat: number
  lng: number
}
