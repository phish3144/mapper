import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (!url || !key) {
  throw new Error(
    'VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY fehlen. ' +
      'Lege eine .env nach dem Muster von .env.example an.',
  )
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

export const SUPABASE_URL = url

/**
 * Uebersetzt Postgres-/PostgREST-Fehler in Meldungen, die einer Anwenderin
 * etwas sagen. Die Rohtexte nennen Constraint-Namen und SQLSTATE-Codes.
 */
export function describeError(error: unknown): string {
  if (!error) return 'Unbekannter Fehler.'
  const e = error as { code?: string; message?: string; details?: string; hint?: string }
  const code = e.code ?? ''
  const msg = e.message ?? String(error)

  if (code === '42501' || /row-level security/i.test(msg)) {
    return 'Dafuer fehlen dir die Rechte. Moeglicherweise bist du in diesem Arbeitsbereich nur Leser.'
  }
  if (code === '23505') {
    if (/categories_name_unique/.test(msg)) return 'Eine Kategorie mit diesem Namen existiert bereits.'
    if (/groups_name_unique/.test(msg)) return 'Eine Gruppe mit diesem Namen existiert bereits.'
    if (/route_stops_route_id_location_id_key/.test(msg)) return 'Dieser Standort ist bereits Teil der Route.'
    if (/workspace_invites_unique/.test(msg)) return 'Fuer diese Adresse liegt bereits eine Einladung vor.'
    if (/profiles_email_key/.test(msg)) return 'Fuer diese E-Mail-Adresse gibt es bereits ein Konto.'
    return 'Dieser Eintrag existiert bereits.'
  }
  if (code === '23514') return msg.replace(/^.*violates check constraint.*$/i, 'Die Eingabe ist ungueltig.')
  if (code === '23503') return 'Der Eintrag wird noch an anderer Stelle verwendet.'
  if (/Invalid login credentials/i.test(msg)) return 'E-Mail-Adresse oder Passwort ist falsch.'
  if (/User already registered/i.test(msg)) return 'Fuer diese E-Mail-Adresse gibt es bereits ein Konto.'
  if (/Password should be at least/i.test(msg)) return 'Das Passwort ist zu kurz (mindestens 6 Zeichen).'
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Keine Verbindung zum Server.'
  return msg
}
