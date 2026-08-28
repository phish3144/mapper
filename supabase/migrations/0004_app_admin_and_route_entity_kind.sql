-- ============================================================================
-- mapper — App-Administrator und eigene Entitaetsart fuer Routen
-- ============================================================================
-- Ein neuer Enum-Wert kann in Postgres nicht in derselben Transaktion angelegt
-- UND verwendet werden. Deshalb steht er hier allein; benutzt wird er erst in
-- der naechsten Migration.
alter type public.entity_kind add value if not exists 'route';

alter table public.profiles
  add column if not exists is_app_admin boolean not null default false;

comment on column public.profiles.is_app_admin is
  'Darf Konten anlegen und verwalten. Wird nicht ueber die SPA gesetzt, sondern nur durch andere App-Administratoren oder beim Bootstrap des ersten Kontos.';
