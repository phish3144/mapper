/**
 * Kontenverwaltung fuer App-Administratoren.
 *
 * Alles hier laeuft ueber die Edge Function `admin-users`, weil das Anlegen
 * und Loeschen von Konten den service_role-Schluessel braucht. Ist sie noch
 * nicht ausgerollt, antwortet sie gar nicht — dann ist der Befehl zum
 * Ausrollen die einzig hilfreiche Meldung.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { admin } from '@/lib/db'
import type { AdminAccount } from '@/lib/db'
import { formatDateShort, pluralize } from '@/lib/format'
import { describeError } from '@/lib/supabase'
import { useCurrentWorkspace, useStore } from '@/lib/store'
import type { MemberRole } from '@/types/domain'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Modal,
  SelectField,
  Spinner,
  TextField,
} from '@/components/ui'

const DEPLOY_COMMAND = 'supabase functions deploy admin-users --project-ref iisiaoexusvoecytznwg'
const MIN_PASSWORD = 8

const ROLE_LABEL: Record<MemberRole, string> = {
  viewer: 'Leser',
  editor: 'Bearbeiter',
  owner: 'Eigentuemer',
}
const ROLE_ORDER: MemberRole[] = ['viewer', 'editor', 'owner']
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Erkennt den Fall "Funktion nicht erreichbar". supabase-js verpackt das je
 * nach Ursache unterschiedlich: als Netzwerkfehler ohne Status oder als
 * HTTP-Fehler mit 404.
 */
function looksUndeployed(error: unknown): boolean {
  const e = error as { name?: string; message?: string; status?: number; context?: { status?: number } }
  const status = typeof e?.status === 'number' ? e.status : e?.context?.status
  if (status === 404) return true
  // Nur Netzwerk- und Transportfehler, keine Textsuche nach "nicht gefunden":
  // die Funktion antwortet mit genau solchen Saetzen, wenn ein Konto fehlt -
  // das ist eine echte Ablehnung und kein fehlender Ausrollstand.
  const text = `${e?.name ?? ''} ${e?.message ?? ''}`.trim() || String(error)
  return /Failed to send a request|Failed to fetch|NetworkError|FunctionsFetchError/i.test(text)
}

export default function AdminDialog({ onClose }: { onClose: () => void }) {
  const myUserId = useStore((s) => s.session?.user.id ?? null)
  const notify = useStore((s) => s.notify)
  const loadWorkspaces = useStore((s) => s.loadWorkspaces)
  const workspace = useCurrentWorkspace()

  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [undeployed, setUndeployed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [makeAdmin, setMakeAdmin] = useState(false)
  const [joinWorkspace, setJoinWorkspace] = useState(false)
  const [joinRole, setJoinRole] = useState<MemberRole>('editor')
  const [formError, setFormError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [resetting, setResetting] = useState<AdminAccount | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<AdminAccount | null>(null)
  const [deleting, setDeleting] = useState(false)

  const formId = useId()
  const resetFormId = useId()

  // Solange ein Unterdialog offen ist, darf der aeussere nicht schliessen -
  // sonst raeumt eine Escape-Taste beide zugleich ab.
  const nestedRef = useRef(false)
  useEffect(() => {
    nestedRef.current = resetting !== null || pendingDelete !== null
  }, [resetting, pendingDelete])
  const closeMain = useCallback(() => {
    if (!nestedRef.current) onClose()
  }, [onClose])
  // Ebenfalls stabil: Modal haengt seinen Fokus-Effekt an onClose. Ein bei jedem
  // Rendern neu gebautes Schliessen zoege den Fokus nach jedem Tastendruck aus
  // dem Passwortfeld zurueck in die Kopfzeile des Dialogs.
  const closeReset = useCallback(() => setResetting(null), [])
  const cancelDelete = useCallback(() => setPendingDelete(null), [])

  // `initial` steuert nur die Ladeanzeige: nach einer Aktion soll die Liste
  // nicht kurz gegen einen Kreisel getauscht werden.
  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true)
    try {
      const list = await admin.listAccounts()
      setAccounts(list ?? [])
      setUndeployed(false)
      setError(null)
    } catch (e) {
      if (initial) setAccounts([])
      if (looksUndeployed(e)) setUndeployed(true)
      else setError(describeError(e))
    } finally {
      if (initial) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(true)
  }, [load])

  /** Fehler einer Einzelaktion einordnen: fehlende Funktion oder echte Ablehnung. */
  function handleActionError(e: unknown, setLocal: (text: string) => void) {
    if (looksUndeployed(e)) {
      setUndeployed(true)
      setLocal('Die Kontenverwaltung ist derzeit nicht erreichbar.')
      return
    }
    setLocal(describeError(e))
  }

  async function submitCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(address)) {
      setFormError('Bitte gib eine gueltige E-Mail-Adresse an.')
      return
    }
    if (password.length < MIN_PASSWORD) {
      setFormError(`Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`)
      return
    }
    setFormError(null)
    setCreating(true)
    try {
      const input: Parameters<typeof admin.createAccount>[0] = {
        email: address,
        password,
        is_app_admin: makeAdmin,
      }
      const shownName = displayName.trim()
      if (shownName) input.display_name = shownName
      if (joinWorkspace && workspace) {
        input.workspace_id = workspace.id
        input.role = joinRole
      }
      await admin.createAccount(input)
      notify('success', `Konto ${address} wurde angelegt.`)
      setDisplayName('')
      setEmail('')
      setPassword('')
      setMakeAdmin(false)
      setJoinWorkspace(false)
      await load()
    } catch (err) {
      handleActionError(err, setFormError)
    } finally {
      setCreating(false)
    }
  }

  async function toggleAdmin(account: AdminAccount) {
    setBusyId(account.id)
    setError(null)
    const isSelf = account.id === myUserId
    const givingUpOwnRights = isSelf && account.is_app_admin
    try {
      await admin.setAdmin(account.id, !account.is_app_admin)
      notify(
        'success',
        account.is_app_admin
          ? `${account.email} ist kein App-Administrator mehr.`
          : `${account.email} ist jetzt App-Administrator.`,
      )
      // Das eigene Profil liegt im Speicher. Ohne Auffrischen zeigte das Menue
      // weiter die Kontenverwaltung an, die die Funktion ab jetzt verweigert.
      if (isSelf) await loadWorkspaces()
      if (givingUpOwnRights) {
        onClose()
        return
      }
      await load()
    } catch (e) {
      handleActionError(e, setError)
    } finally {
      setBusyId(null)
    }
  }

  async function submitReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!resetting) return
    if (newPassword.length < MIN_PASSWORD) {
      setResetError(`Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`)
      return
    }
    setResetError(null)
    setResetBusy(true)
    try {
      await admin.resetPassword(resetting.id, newPassword)
      notify('success', `Passwort fuer ${resetting.email} wurde gesetzt.`)
      setResetting(null)
      setNewPassword('')
    } catch (err) {
      handleActionError(err, setResetError)
    } finally {
      setResetBusy(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await admin.deleteAccount(pendingDelete.id)
      notify('success', `Konto ${pendingDelete.email} wurde geloescht.`)
      setPendingDelete(null)
      await load()
    } catch (e) {
      setPendingDelete(null)
      handleActionError(e, setError)
    } finally {
      setDeleting(false)
    }
  }

  const deployHint = (
    <div className="notice notice-info" style={{ marginBottom: 12, flexDirection: 'column', alignItems: 'stretch' }}>
      <span className="notice-text">
        Die Kontenverwaltung laeuft ueber die Edge Function <span className="mono">admin-users</span>.
        Sie antwortet nicht — sehr wahrscheinlich ist sie in diesem Projekt noch nicht ausgerollt.
        Einmalig im Projektordner ausfuehren:
      </span>
      <div className="panel" style={{ marginTop: 10, padding: '8px 10px' }}>
        <code className="mono" style={{ overflowWrap: 'anywhere' }}>
          {DEPLOY_COMMAND}
        </code>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <Button size="sm" onClick={() => void load()}>
          Erneut versuchen
        </Button>
      </div>
    </div>
  )

  return (
    <Modal
      title="Kontenverwaltung"
      onClose={closeMain}
      width={680}
      footer={<Button onClick={onClose}>Schliessen</Button>}
    >
      {undeployed && deployHint}

      {/* Ohne Konten in der Liste hilft nur der Hinweis - alles Weitere scheitert ohnehin. */}
      {(!undeployed || (accounts !== null && accounts.length > 0)) && (
        <>
          {error && (
            <div className="notice notice-error" style={{ marginBottom: 12 }}>
              <span className="notice-text">{error}</span>
            </div>
          )}

          <h4 style={{ marginBottom: 6 }}>Konten</h4>

          {loading ? (
            <div className="row" style={{ justifyContent: 'center', padding: 20 }}>
              <Spinner />
            </div>
          ) : !accounts || accounts.length === 0 ? (
            <EmptyState>Noch keine Konten.</EmptyState>
          ) : (
            <div className="list panel">
              {accounts.map((a) => {
                const isMe = a.id === myUserId
                const name = a.display_name?.trim() || a.email
                return (
                  <div
                    key={a.id}
                    className="list-item"
                    style={{ cursor: 'default', flexWrap: 'wrap', rowGap: 6 }}
                  >
                    <div className="list-item-main" style={{ minWidth: 200 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="list-item-title truncate">{name}</span>
                        {a.is_app_admin && <Badge tone="accent">Administrator</Badge>}
                        {isMe && <Badge>du</Badge>}
                      </div>
                      <div className="list-item-sub truncate">
                        {a.email} · angelegt am {formatDateShort(new Date(a.created_at))}
                        {typeof a.workspace_count === 'number' &&
                          ` · ${pluralize(a.workspace_count, 'Arbeitsbereich', 'Arbeitsbereiche')}`}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      aria-label={`Passwort von ${a.email} zuruecksetzen`}
                      disabled={busyId === a.id}
                      onClick={() => {
                        setNewPassword('')
                        setResetError(null)
                        setResetting(a)
                      }}
                    >
                      Passwort
                    </Button>
                    <Button
                      size="sm"
                      aria-label={
                        a.is_app_admin
                          ? `${a.email} die Administratorrechte entziehen`
                          : `${a.email} zum App-Administrator machen`
                      }
                      busy={busyId === a.id}
                      onClick={() => void toggleAdmin(a)}
                    >
                      {a.is_app_admin ? 'Rechte entziehen' : 'Zum Administrator'}
                    </Button>
                    {!isMe && (
                      <Button
                        size="sm"
                        aria-label={`Konto ${a.email} loeschen`}
                        disabled={busyId === a.id}
                        onClick={() => setPendingDelete(a)}
                      >
                        Loeschen
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="divider" />
          <h4 style={{ marginBottom: 6 }}>Konto anlegen</h4>

          <form id={formId} onSubmit={submitCreate}>
            <div className="field-row">
              <TextField
                label="Anzeigename"
                value={displayName}
                autoComplete="off"
                maxLength={80}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <TextField
                label="E-Mail-Adresse"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (formError) setFormError(null)
                }}
              />
            </div>
            <TextField
              label="Passwort"
              type="password"
              autoComplete="new-password"
              hint={`Mindestens ${MIN_PASSWORD} Zeichen.`}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (formError) setFormError(null)
              }}
            />

            <div className="col" style={{ marginBottom: 12 }}>
              <Checkbox label="App-Administrator" checked={makeAdmin} onChange={setMakeAdmin} />
              {workspace && (
                <Checkbox
                  label={`Direkt in "${workspace.name}" aufnehmen`}
                  checked={joinWorkspace}
                  onChange={setJoinWorkspace}
                />
              )}
            </div>

            {joinWorkspace && workspace && (
              <SelectField
                label="Rolle im Arbeitsbereich"
                value={joinRole}
                onChange={(e) => setJoinRole(e.target.value as MemberRole)}
              >
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </SelectField>
            )}

            {formError && (
              <div className="notice notice-error" style={{ marginBottom: 12 }}>
                <span className="notice-text">{formError}</span>
              </div>
            )}

            <div className="row-between">
              <p className="small faint" style={{ margin: 0, maxWidth: 400 }}>
                Das Konto ist sofort nutzbar. Eine Bestaetigungsmail wird nicht verschickt — gib das
                Passwort selbst weiter.
              </p>
              <Button type="submit" variant="primary" busy={creating}>
                Konto anlegen
              </Button>
            </div>
          </form>
        </>
      )}

      {resetting && (
        <Modal
          title="Passwort zuruecksetzen"
          width={400}
          onClose={closeReset}
          footer={
            <>
              <Button onClick={closeReset} disabled={resetBusy}>
                Abbrechen
              </Button>
              <Button type="submit" form={resetFormId} variant="primary" busy={resetBusy}>
                Passwort setzen
              </Button>
            </>
          }
        >
          <form id={resetFormId} onSubmit={submitReset}>
            <p className="small muted">
              Neues Passwort fuer <strong>{resetting.email}</strong>. Die Person wird nicht
              benachrichtigt.
            </p>
            <TextField
              label="Neues Passwort"
              type="password"
              autoComplete="new-password"
              autoFocus
              hint={`Mindestens ${MIN_PASSWORD} Zeichen.`}
              error={resetError}
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value)
                if (resetError) setResetError(null)
              }}
            />
          </form>
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Konto loeschen"
          confirmLabel="Endgueltig loeschen"
          busy={deleting}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
          message={
            <>
              <p>
                Das Konto <strong>{pendingDelete.email}</strong> wird endgueltig geloescht und
                verliert den Zugang zu allen Arbeitsbereichen.
              </p>
              <p style={{ marginBottom: 0 }}>
                Standorte und Routen, die diese Person angelegt hat, bleiben erhalten.
              </p>
            </>
          }
        />
      )}
    </Modal>
  )
}
