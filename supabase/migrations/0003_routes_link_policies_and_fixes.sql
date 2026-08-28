-- ============================================================================
-- mapper — Routen, Verknuepfungs-Policies und Korrekturen
-- ============================================================================

-- Korrektur: ON DELETE SET DEFAULT haette beim Loeschen eines Kontos versucht,
-- den Spaltendefault auth.uid() zu setzen - im Loeschkontext NULL, was gegen
-- NOT NULL verstossen und das Loeschen blockiert haette.
alter table public.categories drop constraint categories_created_by_fkey;
alter table public.groups     drop constraint groups_created_by_fkey;
alter table public.locations  drop constraint locations_created_by_fkey;

alter table public.categories alter column created_by drop not null;
alter table public.groups     alter column created_by drop not null;
alter table public.locations  alter column created_by drop not null;

alter table public.categories add constraint categories_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;
alter table public.groups add constraint groups_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;
alter table public.locations add constraint locations_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Sichtbarkeits-Helfer fuer Tabellen ohne eigene workspace_id
-- ---------------------------------------------------------------------------
create or replace function public.can_see_location(loc uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.locations l
    where l.id = loc
      and public.has_workspace_access(l.workspace_id)
      and public.is_visible('location', l.id, l.visibility, l.created_by, l.workspace_id)
  );
$$;

create or replace function public.can_edit_location(loc uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.locations l
    where l.id = loc
      and public.has_workspace_access(l.workspace_id, 'editor')
      and public.is_visible('location', l.id, l.visibility, l.created_by, l.workspace_id)
  );
$$;

create or replace function public.can_see_group(grp uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.groups g
    where g.id = grp
      and public.has_workspace_access(g.workspace_id)
      and public.is_visible('group', g.id, g.visibility, g.created_by, g.workspace_id)
  );
$$;

create or replace function public.can_edit_group(grp uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.groups g
    where g.id = grp
      and public.has_workspace_access(g.workspace_id, 'editor')
      and public.is_visible('group', g.id, g.visibility, g.created_by, g.workspace_id)
  );
$$;

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
  end case;
  return creator is not null and creator = auth.uid();
end;
$$;

create policy location_groups_select on public.location_groups for select to authenticated
  using (public.can_see_location(location_id) and public.can_see_group(group_id));
create policy location_groups_insert on public.location_groups for insert to authenticated
  with check (public.can_edit_location(location_id) and public.can_edit_group(group_id));
create policy location_groups_delete on public.location_groups for delete to authenticated
  using (public.can_edit_location(location_id) and public.can_edit_group(group_id));

create policy visibility_grants_select on public.visibility_grants for select to authenticated
  using (public.has_workspace_access(workspace_id));
create policy visibility_grants_insert on public.visibility_grants for insert to authenticated
  with check (public.can_manage_entity_visibility(entity_kind, entity_id, workspace_id)
              and public.has_workspace_access(workspace_id));
create policy visibility_grants_delete on public.visibility_grants for delete to authenticated
  using (public.can_manage_entity_visibility(entity_kind, entity_id, workspace_id));

-- ---------------------------------------------------------------------------
-- Routen
-- ---------------------------------------------------------------------------
create type public.route_profile as enum ('driving', 'cycling', 'walking');
-- 'manual' = feste Stoppliste, 'rule' = Stopps ergeben sich aus einem Filter
-- und aendern sich mit dem Datenbestand.
create type public.route_mode as enum ('manual', 'rule');

create table public.routes (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  name                    text not null check (length(btrim(name)) between 1 and 160),
  description             text,
  profile                 public.route_profile not null default 'driving',
  mode                    public.route_mode not null default 'manual',
  -- Regelwerk fuer mode='rule': Kategorien, Gruppen, Tags, Umkreis.
  rule                    jsonb not null default '{}'::jsonb check (jsonb_typeof(rule) = 'object'),
  start_location_id       uuid references public.locations (id) on delete set null,
  end_location_id         uuid references public.locations (id) on delete set null,
  roundtrip               boolean not null default false,
  depart_at               timestamptz,
  default_service_minutes integer not null default 0 check (default_service_minutes between 0 and 1440),
  visibility              public.visibility_level not null default 'workspace',
  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index routes_ws_idx on public.routes (workspace_id);

create table public.route_stops (
  id                       uuid primary key default gen_random_uuid(),
  route_id                 uuid not null references public.routes (id) on delete cascade,
  location_id              uuid not null references public.locations (id) on delete cascade,
  position                 integer not null check (position >= 0),
  service_minutes_override integer check (service_minutes_override between 0 and 1440),
  note                     text,
  created_at               timestamptz not null default now(),
  unique (route_id, location_id)
);
-- Deferrable, weil Umsortieren zwangslaeufig durch Zwischenzustaende mit
-- doppelten Positionen laeuft; geprueft wird erst am Transaktionsende.
alter table public.route_stops
  add constraint route_stops_position_unique unique (route_id, position) deferrable initially deferred;
create index route_stops_route_idx on public.route_stops (route_id, position);
create index route_stops_location_idx on public.route_stops (location_id);

create trigger routes_updated_at before update on public.routes for each row execute function public.set_updated_at();

create or replace function public.route_workspace(rt uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select workspace_id from public.routes where id = rt;
$$;

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
                         where g.entity_kind = 'location' and g.entity_id = r.id and g.user_id = auth.uid())
          end
  );
$$;

create or replace function public.can_edit_route(rt uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_see_route(rt)
     and public.has_workspace_access(public.route_workspace(rt), 'editor');
$$;

alter table public.routes      enable row level security;
alter table public.route_stops enable row level security;

create policy routes_select on public.routes for select to authenticated
  using (public.has_workspace_access(workspace_id)
         and (visibility = 'workspace'
              or created_by = auth.uid()
              or public.has_workspace_access(workspace_id, 'owner')
              or exists (select 1 from public.visibility_grants g
                         where g.entity_id = routes.id and g.user_id = auth.uid())));
create policy routes_insert on public.routes for insert to authenticated
  with check (public.has_workspace_access(workspace_id, 'editor') and created_by = auth.uid());
create policy routes_update on public.routes for update to authenticated
  using (public.can_edit_route(id)) with check (public.has_workspace_access(workspace_id, 'editor'));
create policy routes_delete on public.routes for delete to authenticated
  using (public.can_edit_route(id));

create policy route_stops_select on public.route_stops for select to authenticated
  using (public.can_see_route(route_id) and public.can_see_location(location_id));
create policy route_stops_insert on public.route_stops for insert to authenticated
  with check (public.can_edit_route(route_id) and public.can_see_location(location_id));
create policy route_stops_update on public.route_stops for update to authenticated
  using (public.can_edit_route(route_id)) with check (public.can_edit_route(route_id));
create policy route_stops_delete on public.route_stops for delete to authenticated
  using (public.can_edit_route(route_id));

-- Umsortieren in einem einzigen Statement: supabase-js kann keine
-- mehrteiligen Transaktionen fahren, einzelne UPDATEs wuerden an der
-- Positions-Eindeutigkeit scheitern.
create or replace function public.reorder_route_stops(p_route_id uuid, p_stop_ids uuid[])
returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update public.route_stops s
     set position = t.ord
    from (
      select u.id, (u.ord - 1)::integer as ord
      from unnest(p_stop_ids) with ordinality as u(id, ord)
    ) t
   where s.id = t.id and s.route_id = p_route_id;
end;
$$;

grant select, insert, update, delete on public.routes      to authenticated;
grant select, insert, update, delete on public.route_stops to authenticated;
grant execute on function public.reorder_route_stops(uuid, uuid[]) to authenticated;
grant execute on function public.can_see_location(uuid)  to authenticated;
grant execute on function public.can_edit_location(uuid) to authenticated;
grant execute on function public.can_see_group(uuid)     to authenticated;
grant execute on function public.can_edit_group(uuid)    to authenticated;
grant execute on function public.can_see_route(uuid)     to authenticated;
grant execute on function public.can_edit_route(uuid)    to authenticated;
grant execute on function public.route_workspace(uuid)   to authenticated;
grant execute on function public.can_manage_entity_visibility(public.entity_kind, uuid, uuid) to authenticated;
