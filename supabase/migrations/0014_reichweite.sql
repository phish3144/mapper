-- Reichweite eines Standorts: wie weit bzw. wie lange er anfaehrt.
--
-- Bei HWPs stand das bisher nur im Namen ("75 min. / 100km"). Als eigene
-- Spalten kann die Umgebungssuche pruefen, ob eine Adresse innerhalb liegt.
-- Beide Angaben sind freiwillig und unabhaengig: manche HWPs nennen nur
-- Kilometer, manche nur Minuten, manche beides.
--
-- Ganze Zahlen genuegen - niemand sagt "100,5 km". Die Grenzen nach oben
-- fangen Tippfehler ab (eine Null zu viel), nicht echte Angaben.
--
-- Nur Schema. Das Vorbefuellen aus den Namen ist ein Datenschritt und
-- laeuft getrennt, mit dem Parser aus src/lib/reichweite.ts.

alter table public.locations
  add column reach_km integer
    constraint locations_reach_km_check check (reach_km is null or reach_km between 1 and 2000),
  add column reach_minutes integer
    constraint locations_reach_minutes_check check (reach_minutes is null or reach_minutes between 1 and 1440);

comment on column public.locations.reach_km is
  'Hoechste Anfahrt auf der Strasse in Kilometern; null = keine Angabe.';
comment on column public.locations.reach_minutes is
  'Hoechste Anfahrtszeit in Minuten; null = keine Angabe.';
