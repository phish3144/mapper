-- ============================================================================
-- mapper — Bootstrap des ersten Administrators, Routen-Sichtbarkeit
-- ============================================================================

-- Der allererste Registrierende wird App-Administrator. Ohne diesen Bootstrap
-- gaebe es niemanden, der jemals einen weiteren Administrator ernennen koennte.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  first_account boolean;
begin
  select not exists (select 1 from public.profiles) into first_account;

  insert into public.profiles (id, email, display_name, is_app_admin)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    first_account
  )
  on conflict (id) do update set email = excluded.email;

  insert into public.workspace_members (workspace_id, user_id, role)
  select i.workspace_id, new.id, i.role
  from public.workspace_invites i
  where lower(i.email) = lower(new.email)
  on conflict (workspace_id, user_id) do nothing;

  delete from public.workspace_invites where lower(email) = lower(new.email);
  return new;
end;
$$;

create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.is_app_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- App-Administratoren duerfen die Kontenliste sehen, um Konten verwalten zu
-- koennen - das ist bewusst nur das Profil, keine Arbeitsbereichsdaten.
create policy profiles_select_admin on public.profiles for select to authenticated
  using (public.is_app_admin());

-- Der Administratorstatus darf niemals per direktem UPDATE aus der SPA
-- gesetzt werden; die bestehende profiles_update-Policy laesst das Feld sonst
-- durch, weil sie nur die Zeilenzugehoerigkeit prueft.
create or replace function public.guard_app_admin_flag() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_app_admin is distinct from old.is_app_admin and not public.is_app_admin() then
    raise exception 'Der Administratorstatus kann nur von App-Administratoren geaendert werden.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_admin_flag
  before update on public.profiles
  for each row execute function public.guard_app_admin_flag();

create or replace function public.set_app_admin(target uuid, value boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_app_admin() then
    raise exception 'Nur App-Administratoren duerfen den Administratorstatus aendern.'
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

-- Routen bekommen ihre eigene Entitaetsart; zuvor teilten sie sich
-- behelfsweise 'location', wodurch eine Standortfreigabe faelschlich auch
-- eine gleichnamige Route sichtbar gemacht haette.
create or replace function public.can_see_route(rt uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.routes r
    where r.id = rt
      and public.has_workspace_access(r.workspace_id)
      and case r.visibility
            when 'workspace' then true
            when 'private' then r.created_by = auth.uid() or public.has_workspace_access(r.workspace_id, 'owner')
            when 'restricted' then
              r.created_by = auth.uid()
              or public.has_workspace_access(r.workspace_id, 'owner')
              or exists (select 1 from public.visibility_grants g
                         where g.entity_kind = 'route' and g.entity_id = r.id and g.user_id = auth.uid())
          end
  );
$$;

drop policy routes_select on public.routes;
create policy routes_select on public.routes for select to authenticated
  using (public.has_workspace_access(workspace_id)
         and (visibility = 'workspace'
              or created_by = auth.uid()
              or public.has_workspace_access(workspace_id, 'owner')
              or exists (select 1 from public.visibility_grants g
                         where g.entity_kind = 'route' and g.entity_id = routes.id and g.user_id = auth.uid())));

create or replace function public.can_manage_entity_visibility(
  kind public.entity_kind, eid uuid, ws uuid
) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  creator uuid;
begin
  if public.has_workspace_access(ws, 'owner') then
    return true;
  end if;
  if not public.has_workspace_access(ws, 'editor') then
    return false;
  end if;
  case kind
    when 'category' then select created_by into creator from public.categories where id = eid;
    when 'group'    then select created_by into creator from public.groups     where id = eid;
    when 'location' then select created_by into creator from public.locations  where id = eid;
    when 'route'    then select created_by into creator from public.routes     where id = eid;
  end case;
  return creator is not null and creator = auth.uid();
end;
$$;

create trigger routes_cleanup_grants after delete on public.routes
  for each row execute function public.cleanup_visibility_grants('route');

grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.set_app_admin(uuid, boolean) to authenticated;
