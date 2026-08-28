-- ============================================================================
-- mapper — Kern: Profile, Arbeitsbereiche, Mitgliedschaften, Einladungen
-- ============================================================================
-- Die Reihenfolge der Enum-Werte ist bedeutungstragend: Postgres vergleicht
-- Enums in Deklarationsreihenfolge, dadurch gilt 'owner' > 'editor' > 'viewer'
-- und die Rollenpruefung wird zu einem simplen `role >= min_role`.
create type public.member_role as enum ('viewer', 'editor', 'owner');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 120),
  color      text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.member_role not null default 'viewer',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- Einladungen adressieren E-Mails, nicht Nutzer-IDs: so muss das Nutzer-
-- verzeichnis nicht offengelegt werden, um jemanden einladen zu koennen.
create table public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email        text not null check (position('@' in email) > 1),
  role         public.member_role not null default 'viewer',
  invited_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now()
);
create unique index workspace_invites_unique on public.workspace_invites (workspace_id, lower(email));

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER ist hier kein Komfort, sondern notwendig: wuerde die
-- RLS-Policy von workspaces direkt auf workspace_members lesen (und umgekehrt),
-- riefen sich beide Policies gegenseitig auf und Postgres bricht mit
-- "infinite recursion detected in policy" ab.
create or replace function public.has_workspace_access(
  ws uuid,
  min_role public.member_role default 'viewer'
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.role >= min_role
  );
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Wer einen Arbeitsbereich anlegt, wird unmittelbar dessen Eigentuemer.
create or replace function public.handle_new_workspace() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

-- Legt das Profil an und loest offene Einladungen ein, die auf die E-Mail
-- des neuen Kontos ausgestellt wurden.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
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

-- Fuer Einladungen an bereits registrierte Konten: die SPA ruft das nach dem
-- Login auf, weil fuer diese Nutzer kein auth.users-INSERT mehr stattfindet.
create or replace function public.accept_pending_invites() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  claimed integer;
  addr text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select lower(email) into addr from auth.users where id = auth.uid();
  if addr is null then
    return 0;
  end if;

  with moved as (
    insert into public.workspace_members (workspace_id, user_id, role)
    select i.workspace_id, auth.uid(), i.role
    from public.workspace_invites i
    where lower(i.email) = addr
    on conflict (workspace_id, user_id) do nothing
    returning workspace_id
  )
  select count(*) into claimed from moved;

  delete from public.workspace_invites where lower(email) = addr;
  return claimed;
end;
$$;

-- Ein Arbeitsbereich ohne Eigentuemer waere unrettbar verwaist.
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
    raise exception 'Der letzte Eigentuemer eines Arbeitsbereichs kann nicht entfernt oder herabgestuft werden.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger guard_last_owner_update
  before update on public.workspace_members
  for each row execute function public.guard_last_owner();

create trigger guard_last_owner_delete
  before delete on public.workspace_members
  for each row execute function public.guard_last_owner();

create trigger profiles_updated_at   before update on public.profiles   for each row execute function public.set_updated_at();
create trigger workspaces_updated_at before update on public.workspaces for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

-- Das eigene Profil ist immer sichtbar; fremde nur, soweit man einen
-- Arbeitsbereich teilt - sonst waere die Mitgliederliste nicht darstellbar.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.workspace_members mine
      join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy workspaces_select on public.workspaces for select to authenticated
  using (public.has_workspace_access(id));
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (created_by = auth.uid());
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.has_workspace_access(id, 'owner')) with check (public.has_workspace_access(id, 'owner'));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (public.has_workspace_access(id, 'owner'));

create policy members_select on public.workspace_members for select to authenticated
  using (public.has_workspace_access(workspace_id));
create policy members_write on public.workspace_members for insert to authenticated
  with check (public.has_workspace_access(workspace_id, 'owner'));
create policy members_update on public.workspace_members for update to authenticated
  using (public.has_workspace_access(workspace_id, 'owner')) with check (public.has_workspace_access(workspace_id, 'owner'));
-- Austreten darf jeder selbst; fremde Mitglieder entfernt nur der Eigentuemer.
create policy members_delete on public.workspace_members for delete to authenticated
  using (public.has_workspace_access(workspace_id, 'owner') or user_id = auth.uid());

create policy invites_select on public.workspace_invites for select to authenticated
  using (public.has_workspace_access(workspace_id, 'owner'));
create policy invites_insert on public.workspace_invites for insert to authenticated
  with check (public.has_workspace_access(workspace_id, 'owner') and invited_by = auth.uid());
create policy invites_delete on public.workspace_invites for delete to authenticated
  using (public.has_workspace_access(workspace_id, 'owner'));

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, delete on public.workspace_invites to authenticated;
grant execute on function public.has_workspace_access(uuid, public.member_role) to authenticated;
grant execute on function public.accept_pending_invites() to authenticated;
