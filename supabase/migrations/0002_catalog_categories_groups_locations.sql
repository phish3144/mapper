-- ============================================================================
-- mapper — Katalog: Kategorien, Gruppen, Standorte samt Sichtbarkeiten
-- ============================================================================
create type public.visibility_level as enum ('workspace', 'restricted', 'private');
create type public.entity_kind as enum ('category', 'group', 'location');

-- Gezielte Einzelfreigaben fuer Objekte mit visibility = 'restricted'.
-- Bewusst polymorph gehalten: drei parallele ACL-Tabellen wuerden dieselbe
-- Logik dreimal duplizieren, ohne zusaetzliche Sicherheit zu bringen.
create table public.visibility_grants (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_kind  public.entity_kind not null,
  entity_id    uuid not null,
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (entity_kind, entity_id, user_id)
);
create index visibility_grants_lookup on public.visibility_grants (entity_kind, entity_id, user_id);
create index visibility_grants_ws on public.visibility_grants (workspace_id);

-- Auch diese Funktion muss SECURITY DEFINER sein: sie wird aus den
-- SELECT-Policies der Katalogtabellen heraus aufgerufen und darf dabei nicht
-- erneut in deren RLS laufen.
create or replace function public.is_visible(
  kind    public.entity_kind,
  eid     uuid,
  vis     public.visibility_level,
  creator uuid,
  ws      uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case vis
    when 'workspace' then true
    when 'private' then creator = auth.uid() or public.has_workspace_access(ws, 'owner')
    when 'restricted' then
      creator = auth.uid()
      or public.has_workspace_access(ws, 'owner')
      or exists (
        select 1 from public.visibility_grants g
        where g.entity_kind = kind and g.entity_id = eid and g.user_id = auth.uid()
      )
  end;
$$;

-- Raeumt Freigaben ab, wenn das zugehoerige Objekt verschwindet. Ein
-- Fremdschluessel ist bei polymorpher Referenz nicht moeglich, deshalb Trigger.
create or replace function public.cleanup_visibility_grants() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.visibility_grants
  where entity_kind = tg_argv[0]::public.entity_kind and entity_id = old.id;
  return old;
end;
$$;

create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  color        text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon         text not null default 'pin' check (length(icon) between 1 and 40),
  description  text,
  sort_order   integer not null default 0,
  visibility   public.visibility_level not null default 'workspace',
  created_by   uuid not null default auth.uid() references auth.users (id) on delete set default,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index categories_name_unique on public.categories (workspace_id, lower(btrim(name)));

create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  color        text not null default '#7c3aed' check (color ~ '^#[0-9a-fA-F]{6}$'),
  description  text,
  sort_order   integer not null default 0,
  visibility   public.visibility_level not null default 'workspace',
  created_by   uuid not null default auth.uid() references auth.users (id) on delete set default,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index groups_name_unique on public.groups (workspace_id, lower(btrim(name)));

create table public.locations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  category_id     uuid references public.categories (id) on delete set null,
  name            text not null check (length(btrim(name)) between 1 and 160),
  lat             double precision not null check (lat between -90 and 90),
  lng             double precision not null check (lng between -180 and 180),
  address         text,
  notes           text,
  -- Aufenthalts-/Servicedauer in Minuten, geht in die Ankunftszeitrechnung ein.
  service_minutes integer not null default 0 check (service_minutes between 0 and 1440),
  -- Zeitfenster: [{"dow":1..7,"from":"08:00","to":"17:00"}], dow nach ISO (1=Mo).
  time_windows    jsonb not null default '[]'::jsonb check (jsonb_typeof(time_windows) = 'array'),
  tags            text[] not null default '{}',
  is_active       boolean not null default true,
  visibility      public.visibility_level not null default 'workspace',
  created_by      uuid not null default auth.uid() references auth.users (id) on delete set default,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index locations_ws_idx on public.locations (workspace_id);
create index locations_ws_cat_idx on public.locations (workspace_id, category_id);
create index locations_bbox_idx on public.locations (workspace_id, lat, lng);
create index locations_tags_idx on public.locations using gin (tags);

-- Ein Standort kann in mehreren Gruppen liegen - Gruppen sind Sichten, keine
-- Ordner, deshalb n:m statt einer Spalte auf locations.
create table public.location_groups (
  location_id uuid not null references public.locations (id) on delete cascade,
  group_id    uuid not null references public.groups (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (location_id, group_id)
);
create index location_groups_group_idx on public.location_groups (group_id);

create trigger categories_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger groups_updated_at     before update on public.groups     for each row execute function public.set_updated_at();
create trigger locations_updated_at  before update on public.locations  for each row execute function public.set_updated_at();

create trigger categories_cleanup_grants after delete on public.categories for each row execute function public.cleanup_visibility_grants('category');
create trigger groups_cleanup_grants     after delete on public.groups     for each row execute function public.cleanup_visibility_grants('group');
create trigger locations_cleanup_grants  after delete on public.locations  for each row execute function public.cleanup_visibility_grants('location');

alter table public.categories        enable row level security;
alter table public.groups            enable row level security;
alter table public.locations         enable row level security;
alter table public.location_groups   enable row level security;
alter table public.visibility_grants enable row level security;

create policy categories_select on public.categories for select to authenticated
  using (public.has_workspace_access(workspace_id)
         and public.is_visible('category', id, visibility, created_by, workspace_id));
create policy categories_insert on public.categories for insert to authenticated
  with check (public.has_workspace_access(workspace_id, 'editor') and created_by = auth.uid());
create policy categories_update on public.categories for update to authenticated
  using (public.has_workspace_access(workspace_id, 'editor')
         and public.is_visible('category', id, visibility, created_by, workspace_id))
  with check (public.has_workspace_access(workspace_id, 'editor'));
create policy categories_delete on public.categories for delete to authenticated
  using (public.has_workspace_access(workspace_id, 'editor')
         and public.is_visible('category', id, visibility, created_by, workspace_id));

create policy groups_select on public.groups for select to authenticated
  using (public.has_workspace_access(workspace_id)
         and public.is_visible('group', id, visibility, created_by, workspace_id));
create policy groups_insert on public.groups for insert to authenticated
  with check (public.has_workspace_access(workspace_id, 'editor') and created_by = auth.uid());
create policy groups_update on public.groups for update to authenticated
  using (public.has_workspace_access(workspace_id, 'editor')
         and public.is_visible('group', id, visibility, created_by, workspace_id))
  with check (public.has_workspace_access(workspace_id, 'editor'));
create policy groups_delete on public.groups for delete to authenticated
  using (public.has_workspace_access(workspace_id, 'editor')
         and public.is_visible('group', id, visibility, created_by, workspace_id));

create policy locations_select on public.locations for select to authenticated
  using (public.has_workspace_access(workspace_id)
         and public.is_visible('location', id, visibility, created_by, workspace_id));
create policy locations_insert on public.locations for insert to authenticated
  with check (public.has_workspace_access(workspace_id, 'editor') and created_by = auth.uid());
create policy locations_update on public.locations for update to authenticated
  using (public.has_workspace_access(workspace_id, 'editor')
         and public.is_visible('location', id, visibility, created_by, workspace_id))
  with check (public.has_workspace_access(workspace_id, 'editor'));
create policy locations_delete on public.locations for delete to authenticated
  using (public.has_workspace_access(workspace_id, 'editor')
         and public.is_visible('location', id, visibility, created_by, workspace_id));

grant select, insert, update, delete on public.categories      to authenticated;
grant select, insert, update, delete on public.groups          to authenticated;
grant select, insert, update, delete on public.locations       to authenticated;
grant select, insert, delete         on public.location_groups to authenticated;
grant select, insert, delete         on public.visibility_grants to authenticated;
grant execute on function public.is_visible(public.entity_kind, uuid, public.visibility_level, uuid, uuid) to authenticated;
