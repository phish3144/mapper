-- ============================================================================
-- mapper — Zwischenspeicher fuer Sperrungen und Baustellen
-- ============================================================================
-- Die Autobahn-API des Bundes kennt keinen Sammelabruf: ein vollstaendiger
-- Stand kostet 216 Anfragen (108 Autobahnen mal zwei Meldungsarten). Das darf
-- kein Browser tun - weder dem Dienst noch der Anwenderin gegenueber.
--
-- Die Edge Function holt den Stand deshalb einmal und legt ihn hier ab. Alle
-- Nutzer teilen sich diesen einen Abruf. Zehn Minuten sind der Kompromiss:
-- kurz genug, dass eine frische Vollsperrung ankommt, lang genug, dass eine
-- Seite voller Nutzer nicht 216 Anfragen je Minute ausloest.
--
-- Wie geocode_cache gehoert die Tabelle der Funktion und NIEMANDEM sonst:
-- keine Policy, keine Rechte fuer anon und authenticated.

create table public.traffic_cache (
  key        text primary key,
  payload    jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.traffic_cache enable row level security;
revoke all on table public.traffic_cache from anon, authenticated;

comment on table public.traffic_cache is
  'Sperrungen und Baustellen der Autobahn-API, geteilt ueber alle Nutzer. Nur die Edge Function greift darauf zu.';
