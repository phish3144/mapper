-- ============================================================================
-- mapper — Arbeitsbereich anlegen
-- ============================================================================
-- Ein direktes INSERT .. RETURNING auf workspaces ist fuer den Client nicht
-- moeglich: RETURNING zieht zusaetzlich die SELECT-Policy heran, und die
-- verlangt eine Mitgliedschaft, die erst der AFTER-INSERT-Trigger anlegt.
-- Zum Pruefzeitpunkt existiert sie noch nicht -> 42501. Nachgewiesen durch
-- einen RLS-Test gegen die echte Datenbank. Deshalb laeuft das Anlegen ueber
-- diese Funktion, die Bereich und Eigentuemerschaft in einem Schritt herstellt
-- und die fertige Zeile zurueckgibt.
create or replace function public.create_workspace(p_name text, p_color text default '#2563eb')
returns public.workspaces
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  row public.workspaces;
begin
  if uid is null then
    raise exception 'Nicht angemeldet.' using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Der Name des Arbeitsbereichs darf nicht leer sein.' using errcode = 'check_violation';
  end if;
  if p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Ungueltiger Farbwert.' using errcode = 'check_violation';
  end if;

  insert into public.workspaces (name, color, created_by)
  values (btrim(p_name), p_color, uid)
  returning * into row;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (row.id, uid, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';

  return row;
end;
$$;

revoke execute on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
