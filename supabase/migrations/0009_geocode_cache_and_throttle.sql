-- ============================================================================
-- mapper — geteilter Zwischenspeicher und Bremse fuer die Adresssuche
-- ============================================================================
-- Beides gehoert der Edge Function und NIEMANDEM sonst: keine Policy, kein
-- Grant. Der service_role-Schluessel der Funktion umgeht RLS ohnehin; jeder
-- andere Zugriff soll ins Leere laufen.

create table public.geocode_cache (
  -- Anbieter + normalisierte Anfrage + Trefferzahl. Als Text statt Hash,
  -- damit sich ein Eintrag im Zweifel nachvollziehen laesst.
  key         text primary key,
  payload     jsonb not null,
  -- Getrennt gefuehrt, weil leere Antworten deutlich kuerzer gelten sollen:
  -- eine Adresse, die es heute noch nicht gibt, kann morgen erfasst sein.
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  hits        integer not null default 0
);
create index geocode_cache_expires_idx on public.geocode_cache (expires_at);

alter table public.geocode_cache enable row level security;

comment on table public.geocode_cache is
  'Antworten der Geocoding-Dienste, geteilt ueber alle Nutzer. Nur die Edge Function greift darauf zu.';

-- ---------------------------------------------------------------------------
-- Bremse
-- ---------------------------------------------------------------------------
-- Nominatim erlaubt eine Anfrage pro Sekunde JE ANWENDUNG. Sobald der Server
-- fragt, teilen sich alle Nutzer diese eine Kennung - ohne Absprache
-- ueberschritten schon drei gleichzeitige Suchen das Limit und brachten die
-- ganze Anwendung in die Sperre. Die Absprache laeuft ueber diese Zeile.
create table public.geocode_throttle (
  provider    text primary key,
  last_call_at timestamptz not null default to_timestamp(0)
);

insert into public.geocode_throttle (provider) values ('nominatim'), ('photon');

alter table public.geocode_throttle enable row level security;

-- Fragt an, ob jetzt gerufen werden darf, und vermerkt den Ruf in einem Zug.
-- Das UPDATE mit Bedingung ist der Kern: zwei gleichzeitige Aufrufe koennen
-- nicht beide true bekommen, weil der zweite die Zeile bereits geaendert
-- vorfindet. Eine Pruefung mit anschliessendem Schreiben haette genau diese
-- Luecke.
create or replace function public.geocode_may_call(p_provider text, p_min_ms integer)
returns boolean
language sql security definer set search_path = public, pg_temp as $$
  update public.geocode_throttle
     set last_call_at = now()
   where provider = p_provider
     and now() - last_call_at >= make_interval(secs => p_min_ms / 1000.0)
  returning true;
$$;

revoke execute on function public.geocode_may_call(text, integer) from public, anon, authenticated;

-- Raeumt abgelaufene Eintraege ab. Wird von der Funktion gelegentlich gerufen.
create or replace function public.geocode_cache_sweep()
returns integer
language sql security definer set search_path = public, pg_temp as $$
  with weg as (
    delete from public.geocode_cache where expires_at < now() returning 1
  )
  select coalesce(count(*), 0)::integer from weg;
$$;

revoke execute on function public.geocode_cache_sweep() from public, anon, authenticated;
