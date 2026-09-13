-- Die Fehlermeldungen der Datenbank landen unveraendert vor den Augen der
-- Anwenderin: describeError reicht unbekannte Meldungen durch. Sie schrieben
-- Umlaute als ae/oe/ue, waehrend die Oberflaeche sie jetzt ausschreibt.
--
-- Nur die Texte aendern sich. Signatur, Rechte und Verhalten bleiben, wie sie
-- sind - 'create or replace' behaelt die vorhandenen Grants.

create or replace function public.guard_last_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ws uuid := coalesce(old.workspace_id, new.workspace_id);
  owners integer;
begin
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  select count(*) into owners
  from public.workspace_members
  where workspace_id = ws and role = 'owner';
  if owners <= 1 then
    raise exception 'Der letzte Eigentümer eines Arbeitsbereichs kann nicht entfernt oder herabgestuft werden.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.guard_app_admin_flag() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_app_admin is distinct from old.is_app_admin and not public.is_app_admin() then
    raise exception 'Der Administratorstatus kann nur von App-Administratoren geändert werden.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create or replace function public.set_app_admin(target uuid, value boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_app_admin() then
    raise exception 'Nur App-Administratoren dürfen den Administratorstatus ändern.'
      using errcode = 'insufficient_privilege';
  end if;
  if target = auth.uid() and value = false
     and (select count(*) from public.profiles where is_app_admin) <= 1 then
    raise exception 'Der letzte App-Administrator kann sich nicht selbst herabstufen.'
      using errcode = 'check_violation';
  end if;
  update public.profiles set is_app_admin = value where id = target;
end;
$$;

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
    raise exception 'Ungültiger Farbwert.' using errcode = 'check_violation';
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
