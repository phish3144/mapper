-- ============================================================================
-- mapper — eigenes Kartensymbol je Standort
-- ============================================================================
-- NULL heisst: Symbol der Kategorie verwenden. Bewusst nullable statt mit
-- Vorgabewert - sonst waere nicht unterscheidbar, ob jemand ausdruecklich die
-- Nadel gewaehlt hat oder schlicht nichts gesetzt ist.
alter table public.locations
  add column if not exists icon text
  check (icon is null or length(btrim(icon)) between 1 and 40);

comment on column public.locations.icon is
  'Kennung des Kartensymbols (siehe src/lib/symbols.ts). NULL = Symbol der Kategorie.';
