-- ============================================================================
-- mapper — Angriffsflaeche der Funktionen verkleinern
-- ============================================================================
-- Befund des Supabase-Linters: PostgREST veroeffentlicht JEDE Funktion im
-- Schema public, auf der PUBLIC das EXECUTE-Recht haelt - auch reine
-- Triggerfunktionen, die dort nichts zu suchen haben.

-- Ohne festen search_path koennte ein Aufrufer mit eigenem Schema im Pfad
-- steuern, welche Objekte die Funktion aufloest.
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at()            from public, anon, authenticated;
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.handle_new_workspace()      from public, anon, authenticated;
revoke execute on function public.guard_last_owner()          from public, anon, authenticated;
revoke execute on function public.guard_app_admin_flag()      from public, anon, authenticated;
revoke execute on function public.cleanup_visibility_grants() from public, anon, authenticated;

-- Die Praedikatsfunktionen werden aus RLS-Policies heraus benoetigt, aber
-- niemals von einer nicht angemeldeten Sitzung.
revoke execute on function public.has_workspace_access(uuid, public.member_role) from public, anon;
revoke execute on function public.is_visible(public.entity_kind, uuid, public.visibility_level, uuid, uuid) from public, anon;
revoke execute on function public.can_see_location(uuid)  from public, anon;
revoke execute on function public.can_edit_location(uuid) from public, anon;
revoke execute on function public.can_see_group(uuid)     from public, anon;
revoke execute on function public.can_edit_group(uuid)    from public, anon;
revoke execute on function public.can_see_route(uuid)     from public, anon;
revoke execute on function public.can_edit_route(uuid)    from public, anon;
revoke execute on function public.route_workspace(uuid)   from public, anon;
revoke execute on function public.can_manage_entity_visibility(public.entity_kind, uuid, uuid) from public, anon;
revoke execute on function public.accept_pending_invites() from public, anon;
revoke execute on function public.is_app_admin()           from public, anon;
revoke execute on function public.set_app_admin(uuid, boolean) from public, anon;
revoke execute on function public.reorder_route_stops(uuid, uuid[]) from public, anon;

-- Nach dem REVOKE FROM PUBLIC die tatsaechlich benoetigten Rechte gezielt
-- wieder erteilen.
grant execute on function public.has_workspace_access(uuid, public.member_role) to authenticated;
grant execute on function public.is_visible(public.entity_kind, uuid, public.visibility_level, uuid, uuid) to authenticated;
grant execute on function public.can_see_location(uuid)  to authenticated;
grant execute on function public.can_edit_location(uuid) to authenticated;
grant execute on function public.can_see_group(uuid)     to authenticated;
grant execute on function public.can_edit_group(uuid)    to authenticated;
grant execute on function public.can_see_route(uuid)     to authenticated;
grant execute on function public.can_edit_route(uuid)    to authenticated;
grant execute on function public.route_workspace(uuid)   to authenticated;
grant execute on function public.can_manage_entity_visibility(public.entity_kind, uuid, uuid) to authenticated;
grant execute on function public.accept_pending_invites() to authenticated;
grant execute on function public.is_app_admin()           to authenticated;
grant execute on function public.set_app_admin(uuid, boolean) to authenticated;
grant execute on function public.reorder_route_stops(uuid, uuid[]) to authenticated;
