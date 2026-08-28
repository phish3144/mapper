/**
 * admin-users — Konten anlegen und verwalten, ausschliesslich fuer
 * App-Administratoren.
 *
 * Warum ueberhaupt eine Edge Function: Konten anlegen, Passwoerter setzen und
 * Konten loeschen geht nur mit dem service_role-Schluessel. Der hebelt Row
 * Level Security vollstaendig aus und darf deshalb niemals ins Browser-Buendel.
 * Hier lebt er in den Secrets der Funktion und verlaesst den Server nie.
 *
 * Aufruf: POST mit JSON { action, ... }.
 * Antwort: immer { data: ... } oder { error: "deutsche Meldung" }.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Der Typ wird importiert, nicht ueber ReturnType<typeof createClient>
 * abgeleitet: createClient ist generisch, und ReturnType setzt fuer die
 * Typvariablen deren Schranken statt der Vorgabewerte ein. Das ergibt einen
 * Client, dessen Tabellenzugriffe auf `never` typisiert sind — `deno check`
 * verwirft dann jedes update(), upsert() und rpc() in dieser Datei.
 */
type Client = SupabaseClient

// Die CORS-Header haengen an JEDER Antwort, auch an den Fehlern. Fehlen sie
// dort, verwirft der Browser die Antwort und die App sieht statt der
// eigentlichen Meldung nur einen undurchsichtigen CORS-Fehler.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  // Die Liste deckt alles ab, was supabase-js von sich aus mitschickt
  // (siehe cors.ts der Bibliothek): apikey und Authorization setzt der
  // fetch-Wrapper, x-client-info die Bibliothek selbst, x-region die
  // Funktionen-API, die Trace-Kopfzeilen die Ablaufverfolgung. Fehlt eine
  // davon, scheitert schon der Preflight — und zwar fuer jeden Aufruf.
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-region, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const MIN_PASSWORD_LENGTH = 8
const ROLES = ['viewer', 'editor', 'owner'] as const
type MemberRole = (typeof ROLES)[number]

// PostgREST deckelt jede Antwort auf die im Projekt eingestellte Zeilenzahl
// (Voreinstellung 1000). Ohne Blaettern zaehlte die Kontenliste ab dieser
// Grenze stillschweigend falsch, statt zu scheitern.
const PAGE_SIZE = 1000
// Harte Obergrenze, damit ein Server, der immer volle Seiten liefert, hier
// keine Endlosschleife ausloest.
const MAX_PAGES = 100

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

interface RequestBody {
  action?: unknown
  email?: unknown
  password?: unknown
  display_name?: unknown
  is_app_admin?: unknown
  workspace_id?: unknown
  role?: unknown
  user_id?: unknown
}

interface AccountRow {
  id: string
  email: string
  display_name: string | null
  is_app_admin: boolean
  created_at: string
}

/** Der gemeinsame Nenner von PostgREST-Fehlern, so viel wie hier gebraucht wird. */
interface PageError {
  code?: string
  message?: string
}

/** Fehlschlag einer Teiloperation: deutsche Meldung samt passendem Status. */
interface Failure {
  message: string
  status: number
}

/**
 * Liest eine Abfrage seitenweise vollstaendig aus. `page` baut die Abfrage fuer
 * einen Bereich; geblaettert wird, bis eine Seite nicht mehr voll ist.
 */
async function collectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: PageError | null }>,
): Promise<{ rows: T[]; error: PageError | null }> {
  const rows: T[] = []
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * PAGE_SIZE
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) return { rows, error }
    const batch = (data ?? []) as T[]
    for (const row of batch) rows.push(row)
    if (batch.length < PAGE_SIZE) break
  }
  return { rows, error: null }
}

// ---------------------------------------------------------------------------
// Antworten
// ---------------------------------------------------------------------------

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function ok(data: unknown): Response {
  return json({ data }, 200)
}

function fail(message: string, status: number): Response {
  return json({ error: message }, status)
}

// ---------------------------------------------------------------------------
// Eingaben
// ---------------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRole(value: string): value is MemberRole {
  return (ROLES as readonly string[]).includes(value)
}

/** Meldung eines unerwarteten Fehlers fuer das Log — niemals der Rumpf der Anfrage. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'unbekannter Fehler'
}

/**
 * Uebersetzt die englischen Meldungen von GoTrue in verstaendliche deutsche.
 * Unbekanntes faellt bewusst auf einen neutralen Text zurueck, damit keine
 * internen Details nach aussen dringen.
 */
function translateAuthError(error: { message?: string } | null, fallback: string): string {
  const raw = error?.message ?? ''
  if (/already been registered|already registered|already exists|duplicate key/i.test(raw)) {
    return 'Fuer diese E-Mail-Adresse gibt es bereits ein Konto.'
  }
  if (/user not found|user_not_found/i.test(raw)) return 'Dieses Konto existiert nicht (mehr).'
  if (/password/i.test(raw) && /(weak|short|at least|characters)/i.test(raw)) {
    return `Das Passwort ist zu schwach. Es braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`
  }
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(raw)) {
    return 'Die E-Mail-Adresse ist ungueltig.'
  }
  if (/database error/i.test(raw)) {
    return `${fallback} Die Datenbank hat das Anlegen des Profils abgelehnt — moeglicherweise ist die E-Mail-Adresse bereits vergeben.`
  }
  return fallback
}

/** Uebernimmt den HTTP-Status von GoTrue, wenn er brauchbar ist. */
function authErrorStatus(error: { status?: number } | null, fallback: number): number {
  const status = error?.status
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : fallback
}

/**
 * Die Datenbank wirft an mehreren Stellen selbst deutsche Meldungen
 * (`raise exception ... using errcode = ...`). Die sind praeziser als jeder
 * Ersatztext und enthalten keine Geheimnisse, deshalb werden genau diese
 * Fehlerklassen durchgereicht.
 */
function describeDbError(error: PageError | null, fallback: string): string {
  const code = error?.code ?? ''
  const message = error?.message ?? ''
  // Nicht jede dieser Fehlerklassen stammt aus einem `raise exception` des
  // Projekts: 42501 wirft auch PostgREST selbst ("permission denied for
  // function ..."), 23514 auch eine verletzte CHECK-Bedingung. Solche
  // englischen Interna gehoeren nicht in die Oberflaeche.
  const internal = /violates .* constraint|permission denied|does not exist|schema cache/i.test(message)
  if ((code === '23514' || code === '42501' || code === 'P0001') && message !== '' && !internal) {
    return message
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Administratorstatus
// ---------------------------------------------------------------------------

/**
 * Setzt profiles.is_app_admin.
 *
 * Warum ueber die RPC im Namen des Aufrufers statt per service_role-UPDATE:
 * auf public.profiles liegt der Trigger `profiles_guard_admin_flag`. Er laesst
 * eine Aenderung des Feldes nur zu, wenn public.is_app_admin() true liefert —
 * und das haengt an auth.uid(). Der service_role-Token traegt keinen
 * sub-Claim, auth.uid() ist damit NULL und ein direktes UPDATE liefe in genau
 * diesen Trigger. public.set_app_admin() ist der dafuer vorgesehene Weg; der
 * Aufrufer ist an dieser Stelle bereits als App-Administrator geprueft, die
 * Funktion prueft es zusaetzlich selbst. Nur falls sie in einem aelteren
 * Projektstand fehlt, greift der direkte UPDATE als Rueckfallebene.
 */
async function applyAdminFlag(
  caller: Client,
  service: Client,
  targetId: string,
  value: boolean,
): Promise<Failure | null> {
  const { error } = await caller.rpc('set_app_admin', { target: targetId, value })
  if (!error) return null

  const missing = error.code === 'PGRST202' || /could not find the function|does not exist/i.test(error.message ?? '')
  if (!missing) {
    console.error(`admin-users: set_app_admin fehlgeschlagen (${error.code ?? 'ohne Code'})`)
    return {
      message: describeDbError(error, 'Der Administratorstatus konnte nicht geaendert werden.'),
      status: error.code === '42501' ? 403 : error.code === '23514' ? 409 : 500,
    }
  }

  const { error: updateError } = await service.from('profiles').update({ is_app_admin: value }).eq('id', targetId)
  if (updateError) {
    console.error(`admin-users: profiles.is_app_admin fehlgeschlagen (${updateError.code ?? 'ohne Code'})`)
    return {
      message: describeDbError(updateError, 'Der Administratorstatus konnte nicht geaendert werden.'),
      status: updateError.code === '42501' ? 403 : updateError.code === '23514' ? 409 : 500,
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

/** Alle Profile samt Zahl der Arbeitsbereiche je Konto. */
async function listAccounts(service: Client): Promise<Response> {
  // Die zweite Sortierspalte ist nicht Kosmetik: bei gleichem created_at waere
  // die Reihenfolge sonst unbestimmt und einzelne Zeilen fielen beim Blaettern
  // doppelt oder gar nicht an.
  const { rows: profiles, error } = await collectAll<AccountRow>((from, to) =>
    service
      .from('profiles')
      .select('id, email, display_name, is_app_admin, created_at')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
  if (error) {
    console.error(`admin-users: Kontenliste fehlgeschlagen (${error.code ?? 'ohne Code'})`)
    return fail('Die Kontenliste konnte nicht geladen werden.', 500)
  }

  // Ein Zaehlen je Konto waere eine Anfrage pro Zeile; die Mitgliedschaften
  // sind schmal genug, um sie einmal zu holen und hier zu buendeln.
  const { rows: memberships, error: memberError } = await collectAll<{ user_id: string }>((from, to) =>
    service
      .from('workspace_members')
      .select('user_id')
      .order('user_id', { ascending: true })
      .order('workspace_id', { ascending: true })
      .range(from, to),
  )
  if (memberError) {
    console.error(`admin-users: Mitgliedschaften fehlgeschlagen (${memberError.code ?? 'ohne Code'})`)
    return fail('Die Arbeitsbereiche der Konten konnten nicht gezaehlt werden.', 500)
  }

  const counts = new Map<string, number>()
  for (const row of memberships) {
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1)
  }

  const accounts = profiles.map((profile) => ({
    ...profile,
    workspace_count: counts.get(profile.id) ?? 0,
  }))
  return ok(accounts)
}

async function loadAccount(service: Client, userId: string): Promise<AccountRow | null> {
  const { data, error } = await service
    .from('profiles')
    .select('id, email, display_name, is_app_admin, created_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error(`admin-users: Profil ${userId} nicht lesbar (${error.code ?? 'ohne Code'})`)
    return null
  }
  return (data as AccountRow | null) ?? null
}

async function countWorkspaces(service: Client, userId: string): Promise<number> {
  const { count, error } = await service
    .from('workspace_members')
    .select('workspace_id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) return 0
  return count ?? 0
}

/**
 * Nimmt ein halb eingerichtetes Konto wieder zurueck. Ein Konto, das zwar
 * existiert, aber weder im Arbeitsbereich noch mit den gewuenschten Rechten
 * ankommt, ist schlimmer als gar keines: der naechste Versuch scheitert dann
 * an der bereits vergebenen E-Mail-Adresse.
 */
async function abortCreate(service: Client, userId: string, reason: string): Promise<Response> {
  const { error } = await service.auth.admin.deleteUser(userId)
  if (error) {
    console.error(`admin-users: Ruecknahme des Kontos fehlgeschlagen (${error.message})`)
    return fail(`${reason} Das Konto besteht bereits, ist aber unvollstaendig eingerichtet.`, 500)
  }
  return fail(`${reason} Das Konto wurde deshalb nicht angelegt.`, 400)
}

async function createAccount(
  service: Client,
  caller: Client,
  body: RequestBody,
): Promise<Response> {
  const email = text(body.email).toLowerCase()
  if (!EMAIL_PATTERN.test(email)) {
    return fail('Bitte eine gueltige E-Mail-Adresse angeben.', 400)
  }
  // Passwoerter werden nicht beschnitten: Leerzeichen am Rand gehoeren zum
  // Passwort und muessten beim Anmelden sonst wieder erraten werden.
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`, 400)
  }

  const displayName = text(body.display_name).slice(0, 120)

  // Fehlt das Feld, wird kein Arbeitsbereich zugeordnet. Steht dort aber etwas
  // anderes als eine Kennung (etwa eine Zahl), ist das ein Fehler und darf
  // nicht stillschweigend zu einem Konto ohne Arbeitsbereich fuehren.
  let workspaceId = ''
  if (body.workspace_id !== undefined && body.workspace_id !== null) {
    if (typeof body.workspace_id !== 'string') {
      return fail('Die Kennung des Arbeitsbereichs ist ungueltig.', 400)
    }
    workspaceId = body.workspace_id.trim()
    if (workspaceId !== '' && !UUID_PATTERN.test(workspaceId)) {
      return fail('Die Kennung des Arbeitsbereichs ist ungueltig.', 400)
    }
  }

  let role: MemberRole = 'viewer'
  if (body.role !== undefined && body.role !== null) {
    if (typeof body.role !== 'string') {
      return fail('Ungueltige Rolle. Erlaubt sind "viewer", "editor" und "owner".', 400)
    }
    const candidate = body.role.trim()
    if (candidate !== '') {
      if (!isRole(candidate)) {
        return fail('Ungueltige Rolle. Erlaubt sind "viewer", "editor" und "owner".', 400)
      }
      role = candidate
    }
  }

  let wantsAdmin: boolean | null = null
  if (body.is_app_admin !== undefined && body.is_app_admin !== null) {
    if (typeof body.is_app_admin !== 'boolean') {
      return fail('Der Administratorstatus muss true oder false sein.', 400)
    }
    wantsAdmin = body.is_app_admin
  }

  // Den Arbeitsbereich vor dem Anlegen pruefen: sonst entstuende ein Konto,
  // das gleich darauf wieder zurueckgenommen werden muesste.
  if (workspaceId) {
    const { data: workspace, error } = await service
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (error) {
      console.error(`admin-users: Arbeitsbereich nicht pruefbar (${error.code ?? 'ohne Code'})`)
      return fail('Der Arbeitsbereich konnte nicht geprueft werden.', 500)
    }
    if (!workspace) return fail('Der gewaehlte Arbeitsbereich existiert nicht.', 404)
  }

  // email_confirm: true — das Konto ist sofort nutzbar. Ein Bestaetigungsmail
  // waere ohnehin sinnlos, weil der Administrator das Passwort selbst vergibt.
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName } : {},
  })
  if (createError || !created?.user) {
    console.error(`admin-users: createUser fehlgeschlagen (${createError?.message ?? 'keine Nutzerdaten'})`)
    return fail(
      translateAuthError(createError, 'Das Konto konnte nicht angelegt werden.'),
      authErrorStatus(createError, 400),
    )
  }

  const userId = created.user.id

  if (workspaceId) {
    // upsert statt insert: der Trigger handle_new_user loest offene
    // Einladungen auf dieselbe Adresse ein und koennte die Mitgliedschaft
    // bereits mit der Rolle aus der Einladung angelegt haben.
    const { error } = await service
      .from('workspace_members')
      .upsert({ workspace_id: workspaceId, user_id: userId, role }, { onConflict: 'workspace_id,user_id' })
    if (error) {
      console.error(`admin-users: Mitgliedschaft fehlgeschlagen (${error.code ?? 'ohne Code'})`)
      return await abortCreate(service, userId, 'Das Konto konnte dem Arbeitsbereich nicht hinzugefuegt werden.')
    }
  }

  const profile = await loadAccount(service, userId)

  if (wantsAdmin !== null && (profile?.is_app_admin ?? false) !== wantsAdmin) {
    const failure = await applyAdminFlag(caller, service, userId, wantsAdmin)
    if (failure) {
      return await abortCreate(service, userId, failure.message)
    }
    if (profile) profile.is_app_admin = wantsAdmin
  }

  const account: AccountRow = profile ?? {
    id: userId,
    email: created.user.email ?? email,
    display_name: displayName || null,
    is_app_admin: wantsAdmin === true,
    created_at: created.user.created_at ?? new Date().toISOString(),
  }
  return ok({ ...account, workspace_count: await countWorkspaces(service, userId) })
}

async function resetPassword(service: Client, body: RequestBody): Promise<Response> {
  const userId = text(body.user_id)
  if (!UUID_PATTERN.test(userId)) {
    return fail('Die Kennung des Kontos ist ungueltig.', 400)
  }
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`, 400)
  }

  const { error } = await service.auth.admin.updateUserById(userId, { password })
  if (error) {
    console.error(`admin-users: updateUserById fehlgeschlagen (${error.message})`)
    return fail(
      translateAuthError(error, 'Das Passwort konnte nicht gesetzt werden.'),
      authErrorStatus(error, 400),
    )
  }
  return ok({ ok: true })
}

async function setAdmin(
  service: Client,
  caller: Client,
  body: RequestBody,
): Promise<Response> {
  const userId = text(body.user_id)
  if (!UUID_PATTERN.test(userId)) {
    return fail('Die Kennung des Kontos ist ungueltig.', 400)
  }
  if (typeof body.is_app_admin !== 'boolean') {
    return fail('Der Administratorstatus muss true oder false sein.', 400)
  }
  const value = body.is_app_admin

  const { data: target, error } = await service
    .from('profiles')
    .select('id, is_app_admin')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error(`admin-users: Zielprofil nicht lesbar (${error.code ?? 'ohne Code'})`)
    return fail('Das Konto konnte nicht geprueft werden.', 500)
  }
  if (!target) return fail('Dieses Konto existiert nicht (mehr).', 404)

  const current = (target as { is_app_admin: boolean }).is_app_admin
  if (current === value) return ok({ ok: true })

  if (!value) {
    const { count, error: countError } = await service
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_app_admin', true)
    if (countError) {
      console.error(`admin-users: Administratoren nicht zaehlbar (${countError.code ?? 'ohne Code'})`)
      return fail('Die Zahl der App-Administratoren konnte nicht geprueft werden.', 500)
    }
    // Ohne App-Administrator liesse sich nie wieder einer ernennen.
    if ((count ?? 0) <= 1) {
      return fail('Der letzte App-Administrator kann die Rechte nicht abgeben.', 409)
    }
  }

  const failure = await applyAdminFlag(caller, service, userId, value)
  if (failure) return fail(failure.message, failure.status)
  return ok({ ok: true })
}

/** Namen fuer eine Meldung aufbereiten, lange Listen abschneiden. */
function nameList(names: string[]): string {
  const shown = names.slice(0, 5).map((name) => `"${name}"`).join(', ')
  return names.length > 5 ? `${shown} und ${names.length - 5} weitere` : shown
}

/**
 * Arbeitsbereiche, die das Konto angelegt hat. `null` steht fuer einen Fehler
 * bei der Pruefung.
 */
async function createdWorkspaces(service: Client, userId: string): Promise<string[] | null> {
  const { data, error } = await service.from('workspaces').select('name').eq('created_by', userId)
  if (error) return null
  return ((data ?? []) as { name: string }[]).map((row) => row.name)
}

/**
 * Namen der Arbeitsbereiche, in denen das Konto der einzige Eigentuemer ist.
 * `null` steht fuer einen Fehler bei der Pruefung.
 */
async function soleOwnerWorkspaces(service: Client, userId: string): Promise<string[] | null> {
  const { data: owned, error } = await service
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
  if (error) return null

  const ids = ((owned ?? []) as { workspace_id: string }[]).map((row) => row.workspace_id)
  if (ids.length === 0) return []

  const { data: owners, error: ownersError } = await service
    .from('workspace_members')
    .select('workspace_id, user_id')
    .eq('role', 'owner')
    .in('workspace_id', ids)
  if (ownersError) return null

  const counts = new Map<string, number>()
  for (const row of (owners ?? []) as { workspace_id: string }[]) {
    counts.set(row.workspace_id, (counts.get(row.workspace_id) ?? 0) + 1)
  }
  const alone = ids.filter((id) => (counts.get(id) ?? 0) <= 1)
  if (alone.length === 0) return []

  const { data: workspaces, error: workspaceError } = await service
    .from('workspaces')
    .select('id, name')
    .in('id', alone)
  if (workspaceError) return null
  return ((workspaces ?? []) as { name: string }[]).map((row) => row.name)
}

async function deleteAccount(
  service: Client,
  body: RequestBody,
  callerId: string,
): Promise<Response> {
  const userId = text(body.user_id)
  if (!UUID_PATTERN.test(userId)) {
    return fail('Die Kennung des Kontos ist ungueltig.', 400)
  }
  if (userId === callerId) {
    return fail('Das eigene Konto kann hier nicht geloescht werden.', 400)
  }

  // Zwei Faelle, in denen die Datenbank das Loeschen ohnehin abweisen wuerde —
  // hier vorweggenommen, weil der rohe Datenbankfehler niemandem weiterhilft:
  //
  // 1. workspaces.created_by haengt mit ON DELETE CASCADE am Konto. Ein
  //    geloeschtes Konto risse also jeden von ihm angelegten Arbeitsbereich
  //    mitsamt Kategorien, Standorten und Routen mit sich. Der Trigger
  //    guard_last_owner bricht diese Kaskade ab, sobald sie den letzten
  //    Eigentuemer eines dieser Arbeitsbereiche entfernt.
  // 2. Auch ohne eigenen Arbeitsbereich greift derselbe Trigger, wenn das
  //    Konto irgendwo alleiniger Eigentuemer ist.
  const created = await createdWorkspaces(service, userId)
  if (created === null) {
    return fail('Die Arbeitsbereiche des Kontos konnten nicht geprueft werden.', 500)
  }
  if (created.length > 0) {
    return fail(
      `Das Konto hat ${nameList(created)} angelegt. Solche Arbeitsbereiche wuerden mitsamt Inhalt verschwinden, deshalb laesst sich das Konto nicht loeschen. Bitte die Arbeitsbereiche zuerst loeschen.`,
      409,
    )
  }

  const orphaned = await soleOwnerWorkspaces(service, userId)
  if (orphaned === null) {
    return fail('Die Arbeitsbereiche des Kontos konnten nicht geprueft werden.', 500)
  }
  if (orphaned.length > 0) {
    return fail(
      `Das Konto ist alleiniger Eigentuemer von ${nameList(orphaned)}. Bitte dort zuerst eine andere Person zum Eigentuemer machen.`,
      409,
    )
  }

  const { error } = await service.auth.admin.deleteUser(userId)
  if (error) {
    console.error(`admin-users: deleteUser fehlgeschlagen (${error.message})`)
    return fail(
      translateAuthError(error, 'Das Konto konnte nicht geloescht werden.'),
      authErrorStatus(error, 400),
    )
  }
  return ok({ ok: true })
}

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Der Preflight kommt ohne Authorization-Header und muss vor jeder Pruefung
  // beantwortet werden.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return fail('Diese Funktion nimmt ausschliesslich POST-Anfragen entgegen.', 405)
  }

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!url || !serviceKey) {
      console.error('admin-users: SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY ist nicht gesetzt.')
      return fail('Die Kontenverwaltung ist auf dem Server nicht vollstaendig eingerichtet.', 500)
    }

    // 1. Token des Aufrufers.
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      return fail('Nicht angemeldet: Die Anfrage traegt kein Zugangstoken.', 401)
    }

    // 2. Token pruefen — mit dem oeffentlichen Schluessel und dem
    // Authorization-Header des Aufrufers. Der Token wird zusaetzlich
    // ausdruecklich an getUser() uebergeben, weil die Funktion keine
    // gespeicherte Sitzung hat, aus der er sonst gelesen wuerde.
    // Ohne SUPABASE_ANON_KEY dient der service_role-Schluessel nur als apikey
    // fuer das Gateway; die Rolle der Anfrage bestimmt allein der
    // Authorization-Header, also der Token des Aufrufers.
    const publicKey =
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? serviceKey
    const caller = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    const { data: userData, error: userError } = await caller.auth.getUser(token)
    const callerId = userData?.user?.id ?? ''
    if (userError || !callerId) {
      return fail('Nicht angemeldet oder die Sitzung ist abgelaufen.', 401)
    }

    // 3. Rolle NIEMALS aus dem Token oder dem Rumpf uebernehmen, sondern mit
    // dem service_role-Client aus der Datenbank lesen.
    const { data: callerProfile, error: profileError } = await service
      .from('profiles')
      .select('is_app_admin')
      .eq('id', callerId)
      .maybeSingle()
    if (profileError) {
      console.error(`admin-users: Berechtigung nicht pruefbar (${profileError.code ?? 'ohne Code'})`)
      return fail('Die Berechtigung konnte nicht geprueft werden.', 500)
    }
    if (!(callerProfile as { is_app_admin: boolean } | null)?.is_app_admin) {
      return fail('Nur App-Administratoren duerfen Konten verwalten.', 403)
    }

    // 4. Ab hier sind privilegierte Operationen erlaubt.
    // Keine dieser Meldungen enthaelt das Wort "JSON": callAdmin in
    // src/lib/db.ts verwirft beim Auspacken der Antwort genau solche Texte
    // (es haelt sie fuer den Fehler des eigenen JSON.parse) und zeigte
    // stattdessen den generischen Transportfehler an.
    let body: RequestBody
    try {
      body = (await req.json()) as RequestBody
    } catch {
      return fail('Der Anfragerumpf ist unlesbar.', 400)
    }
    if (!body || typeof body !== 'object') {
      return fail('Der Anfragerumpf muss ein Objekt sein.', 400)
    }

    const action = text(body.action)
    switch (action) {
      case 'list':
        return await listAccounts(service)
      case 'create':
        return await createAccount(service, caller, body)
      case 'reset-password':
        return await resetPassword(service, body)
      case 'set-admin':
        return await setAdmin(service, caller, body)
      case 'delete':
        return await deleteAccount(service, body, callerId)
      case '':
        return fail('Es wurde keine Aktion angegeben.', 400)
      default:
        return fail(`Unbekannte Aktion "${action.slice(0, 40)}".`, 400)
    }
  } catch (error) {
    console.error(`admin-users: unerwarteter Fehler (${errorText(error)})`)
    return fail('In der Kontenverwaltung ist ein unerwarteter Fehler aufgetreten.', 500)
  }
})
