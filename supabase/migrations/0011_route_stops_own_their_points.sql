-- ============================================================================
-- mapper — eine Tour haelt ihre Stopps selbst
-- ============================================================================
-- Bisher war ein Stopp nur ein Verweis auf einen Standort, mit
-- "on delete cascade". Damit war ein Standort zu loeschen gleichbedeutend
-- damit, ihn aus jeder Tour zu entfernen - lautlos, nicht umkehrbar und
-- Wochen spaeter nicht mehr nachvollziehbar. Genau so sind hier mehrfach
-- fertig geplante Touren leer geworden.
--
-- Ein Stopp traegt jetzt seine eigene Koordinate und seine eigene
-- Beschriftung. Der Verweis auf den Standort bleibt, aber nur noch als
-- Verknuepfung: faellt der Standort weg, bleibt der Stopp stehen und die Tour
-- ist weiter fahrbar.

alter table public.route_stops
  add column lat   double precision,
  add column lng   double precision,
  -- Beschriftung zum Zeitpunkt des Hinzufuegens. Bewusst eine Kopie und kein
  -- Verweis: wird der Standort umbenannt oder geloescht, soll in der Tour
  -- weiterhin stehen, wohin gefahren werden sollte.
  add column label text;

-- Bestand uebernehmen, solange die Standorte noch da sind.
update public.route_stops s
   set lat = l.lat, lng = l.lng, label = l.name
  from public.locations l
 where l.id = s.location_id;

-- Ohne Koordinate ist ein Stopp kein Stopp.
alter table public.route_stops
  alter column lat set not null,
  alter column lng set not null;

alter table public.route_stops
  add constraint route_stops_lat_check check (lat between -90 and 90),
  add constraint route_stops_lng_check check (lng between -180 and 180);

-- Der Verweis wird zur Verknuepfung: nullable, und beim Loeschen des
-- Standorts wird er geleert statt den Stopp mitzureissen.
alter table public.route_stops
  drop constraint route_stops_location_id_fkey,
  alter column location_id drop not null,
  add constraint route_stops_location_id_fkey
    foreign key (location_id) references public.locations (id) on delete set null;

comment on column public.route_stops.lat is
  'Eigene Koordinate des Stopps. Ueberlebt das Loeschen des verknuepften Standorts.';
comment on column public.route_stops.label is
  'Beschriftung beim Hinzufuegen. Kopie, kein Verweis - die Tour soll lesbar bleiben.';

-- ---------------------------------------------------------------------------
-- Sichtbarkeit
-- ---------------------------------------------------------------------------
-- Bisher verlangte die SELECT-Regel can_see_location(location_id). Ein Stopp
-- ohne Standort waere damit fuer NIEMANDEN mehr sichtbar - die Tour haette
-- eine Luecke, die keiner erklaeren koennte. Ein Stopp ohne Verweis gehoert
-- schlicht der Tour, deren Sichtbarkeit also entscheidet.
drop policy if exists route_stops_select on public.route_stops;
create policy route_stops_select on public.route_stops for select
  using (
    can_see_route(route_id)
    and (location_id is null or can_see_location(location_id))
  );

drop policy if exists route_stops_insert on public.route_stops;
create policy route_stops_insert on public.route_stops for insert
  with check (
    can_edit_route(route_id)
    and (location_id is null or can_see_location(location_id))
  );
