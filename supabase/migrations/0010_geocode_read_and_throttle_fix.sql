-- ============================================================================
-- mapper — Nachschliff an Zwischenspeicher und Bremse der Adresssuche
-- ============================================================================

-- 1. Die Bremse gab NULL zurueck, wenn sie bremste: das UPDATE traf keine
--    Zeile, und "returning true" lieferte folglich gar nichts. Die Edge
--    Function fing das mit "data === true" ab, doch eine Funktion, die
--    boolean verspricht, sollte auch boolean liefern - sonst haengt die
--    Sperre an einem Vergleich, den man beim Umbauen leicht uebersieht.
create or replace function public.geocode_may_call(p_provider text, p_min_ms integer)
returns boolean
language sql security definer set search_path = public, pg_temp as $$
  with erlaubt as (
    update public.geocode_throttle
       set last_call_at = now()
     where provider = p_provider
       and now() - last_call_at >= make_interval(secs => p_min_ms / 1000.0)
    returning true as ja
  )
  select coalesce((select ja from erlaubt), false);
$$;

revoke execute on function public.geocode_may_call(text, integer) from public, anon, authenticated;

-- 2. Lesen und Zaehlen in einem Zug. Vorher las die Funktion die Zeile und
--    pruefte den Ablauf selbst; die Spalte "hits" blieb dabei auf null
--    stehen. Jetzt erledigt Postgres beides: eine Abfrage statt zwei, der
--    Ablauf wird an der Quelle geprueft, und man sieht hinterher, welche
--    Adressen die Anwendung wirklich beschaeftigen.
create or replace function public.geocode_cache_read(p_key text)
returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  update public.geocode_cache
     set hits = hits + 1
   where key = p_key
     and expires_at > now()
  returning payload;
$$;

revoke execute on function public.geocode_cache_read(text) from public, anon, authenticated;

-- 3. 0009 versprach "keine Policy, kein Grant". Die Policy fehlte auch, doch
--    das Recht auf die Tabellen war noch da: Supabase verteilt es beim
--    Anlegen automatisch an anon und authenticated. Wirksam war es nicht -
--    RLS ohne Policy laesst niemanden durch -, aber es widersprach dem
--    Vorsatz. Jetzt stimmt beides ueberein, und wer spaeter versehentlich
--    eine Policy ergaenzt, oeffnet damit noch nichts.
revoke all on table public.geocode_cache from anon, authenticated;
revoke all on table public.geocode_throttle from anon, authenticated;
