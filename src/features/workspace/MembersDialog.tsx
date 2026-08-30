/**
 * Mitglieder und offene Einladungen eines Arbeitsbereichs.
 *
 * Fehler werden hier im Dialog gezeigt und nicht nur in der Meldungsleiste:
 * die Datenbank lehnt etwa das Herabstufen des letzten Eigentuemers ab, und
 * diese Auskunft gehoert neben die Zeile, die sie ausgeloest hat.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import * as db from '@/lib/db'
import type { AdminAccount, MemberWithProfile } from '@/lib/db'
import { describeError } from '@/lib/supabase'
import { useIsOwner, useStore } from '@/lib/store'
import type { MemberRole, WorkspaceInvite } from '@/types/domain'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Modal,
  SelectField,
  Spinner,
  TextField,
} from '@/components/ui'

const ROLE_LABEL: Record<MemberRole, string> = {
  viewer: 'Leser',
  editor: 'Bearbeiter',
  owner: 'Eigentuemer',
}

const ROLE_ORDER: MemberRole[] = ['viewer', 'editor', 'owner']

/** Grobpruefung. Die endgueltige Pruefung macht ohnehin die Anmeldung. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * So viele Konten stehen hoechstens in der Liste. Bei vielen Konten ist eine
 * endlose Liste keine Auswahl mehr - dann fuehrt die Suche schneller zum Ziel.
 */
const MAX_ACCOUNT_ROWS = 8

function memberName(m: MemberWithProfile): string {
  return m.profile?.display_name?.trim() || m.profile?.email || 'Unbekanntes Konto'
}

function friendly(error: unknown): string {
  const text = describeError(error)
  if (/letzte[nr]? Eigentuemer/i.test(text)) {
    return (
      'Ein Arbeitsbereich braucht mindestens einen Eigentuemer. ' +
      'Ernenne zuerst eine andere Person zum Eigentuemer.'
    )
  }
  return text
}

export default function MembersDialog({ onClose }: { onClose: () => void }) {
  const workspaceId = useStore((s) => s.currentWorkspaceId)
  const myUserId = useStore((s) => s.session?.user.id ?? null)
  const notify = useStore((s) => s.notify)
  const reportError = useStore((s) => s.reportError)
  const loadWorkspaces = useStore((s) => s.loadWorkspaces)
  const isOwner = useIsOwner()
  const profile = useStore((s) => s.profile)
  // Das Verzeichnis aller Konten liegt hinter der Kontenverwaltung und ist
  // App-Administratoren vorbehalten. Eintragen darf nur, wer den Bereich
  // besitzt - beides muss also zusammenkommen.
  const kannKontenWaehlen = isOwner && profile?.is_app_admin === true

  const [members, setMembers] = useState<MemberWithProfile[] | null>(null)
  const [invites, setInvites] = useState<WorkspaceInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<MemberRole>('editor')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null)
  const [accountsNote, setAccountsNote] = useState<string | null>(null)
  const [accountQuery, setAccountQuery] = useState('')
  const [addRole, setAddRole] = useState<MemberRole>('editor')
  const [addingId, setAddingId] = useState<string | null>(null)

  const [pendingRemove, setPendingRemove] = useState<MemberWithProfile | null>(null)
  const [removing, setRemoving] = useState(false)

  /**
   * Konten, die noch nicht Mitglied sind, gefiltert nach der Suche. Wer schon
   * dabei ist, gehoert nicht in eine Liste zum Hinzufuegen - er steht oben.
   */
  const kandidaten = useMemo(() => {
    if (accounts === null) return []
    const drin = new Set((members ?? []).map((m) => m.user_id))
    const suche = accountQuery.trim().toLowerCase()
    return accounts
      .filter((a) => !drin.has(a.id))
      .filter(
        (a) =>
          suche === '' ||
          a.email.toLowerCase().includes(suche) ||
          (a.display_name ?? '').toLowerCase().includes(suche),
      )
      .sort((a, b) =>
        (a.display_name?.trim() || a.email).localeCompare(b.display_name?.trim() || b.email, 'de'),
      )
  }, [accounts, members, accountQuery])

  const formId = useId()

  // Der aeussere Dialog darf sich nicht schliessen, solange die Rueckfrage
  // offen ist - sonst nimmt eine Escape-Taste beide auf einmal mit.
  const nestedRef = useRef(false)
  useEffect(() => {
    nestedRef.current = pendingRemove !== null
  }, [pendingRemove])
  const closeMain = useCallback(() => {
    if (!nestedRef.current) onClose()
  }, [onClose])
  // Ebenfalls stabil: Modal haengt seinen Fokus-Effekt an onClose und zoege
  // den Fokus sonst bei jedem Rendern zurueck in die Kopfzeile der Rueckfrage.
  const cancelRemove = useCallback(() => setPendingRemove(null), [])

  // `initial` steuert nur die Ladeanzeige: nach einer Aktion soll die Liste
  // nicht kurz gegen einen Kreisel getauscht werden.
  const load = useCallback(async (initial = false) => {
    if (!workspaceId) return
    if (initial) setLoading(true)
    try {
      const [nextMembers, nextInvites] = await Promise.all([
        db.fetchMembers(workspaceId),
        // Einladungen sieht laut Richtlinie ohnehin nur der Eigentuemer.
        isOwner ? db.fetchInvites(workspaceId) : Promise.resolve<WorkspaceInvite[]>([]),
      ])
      setMembers(nextMembers)
      setInvites(nextInvites)
    } catch (e) {
      if (initial) setMembers([])
      reportError(e)
    } finally {
      if (initial) setLoading(false)
    }
  }, [workspaceId, isOwner, reportError])

  const loadAccounts = useCallback(async () => {
    if (!kannKontenWaehlen) return
    try {
      setAccounts((await db.admin.listAccounts()) ?? [])
      setAccountsNote(null)
    } catch (e) {
      setAccounts([])
      setAccountsNote(
        db.looksUndeployed(e)
          ? 'Das Benutzerverzeichnis ist derzeit nicht erreichbar. Einladen per E-Mail geht weiterhin.'
          : describeError(e),
      )
    }
  }, [kannKontenWaehlen])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  async function addAccount(account: AdminAccount) {
    if (!workspaceId) return
    setAddingId(account.id)
    setError(null)
    try {
      await db.addMember(workspaceId, account.id, addRole)
      await load()
      await loadWorkspaces()
      notify('success', `${account.display_name?.trim() || account.email} hinzugefuegt.`)
    } catch (e) {
      setError(friendly(e))
    } finally {
      setAddingId(null)
    }
  }

  useEffect(() => {
    void load(true)
  }, [load])

  async function changeRole(member: MemberWithProfile, next: MemberRole) {
    if (!workspaceId || next === member.role) return
    setBusyId(member.user_id)
    setError(null)
    try {
      await db.setMemberRole(workspaceId, member.user_id, next)
      notify('success', `Rolle von ${memberName(member)} geaendert.`)
      // Die eigene Rolle steckt auch im Speicher. Ohne dieses Neuladen boete die
      // Anwendung weiter Schaltflaechen an, die die Datenbank ab jetzt ablehnt.
      if (member.user_id === myUserId) await loadWorkspaces()
    } catch (e) {
      setError(friendly(e))
    } finally {
      setBusyId(null)
      // In beiden Faellen neu laden: nur die Datenbank weiss, was wirklich gilt.
      await load()
    }
  }

  async function confirmRemove() {
    if (!workspaceId || !pendingRemove) return
    const target = pendingRemove
    setRemoving(true)
    setError(null)
    try {
      await db.removeMember(workspaceId, target.user_id)
      setPendingRemove(null)
      if (target.user_id === myUserId) {
        // Wer sich selbst entfernt, verliert den Zugriff sofort. Der Speicher
        // muss das erfahren, sonst zeigt die Anwendung einen Bereich weiter an,
        // den die Datenbank ab jetzt verweigert.
        notify('info', 'Du hast den Arbeitsbereich verlassen.')
        await loadWorkspaces()
        onClose()
        return
      }
      notify('success', `${memberName(target)} wurde entfernt.`)
      await load()
    } catch (e) {
      setError(friendly(e))
      setPendingRemove(null)
      await load()
    } finally {
      setRemoving(false)
    }
  }

  async function submitInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!workspaceId) return
    const address = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(address)) {
      setEmailError('Bitte gib eine gueltige E-Mail-Adresse an.')
      return
    }
    if (members?.some((m) => m.profile?.email?.toLowerCase() === address)) {
      setEmailError('Diese Person ist bereits Mitglied.')
      return
    }
    setEmailError(null)
    setError(null)
    setInviting(true)
    try {
      await db.inviteToWorkspace(workspaceId, address, inviteRole)
      setEmail('')
      notify('success', `Einladung fuer ${address} angelegt.`)
      await load()
    } catch (err) {
      setError(friendly(err))
    } finally {
      setInviting(false)
    }
  }

  async function revoke(invite: WorkspaceInvite) {
    setBusyId(invite.id)
    setError(null)
    try {
      await db.revokeInvite(invite.id)
      await load()
    } catch (e) {
      setError(friendly(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal
      title="Mitglieder & Freigaben"
      onClose={closeMain}
      width={620}
      footer={<Button onClick={onClose}>Schliessen</Button>}
    >
      {error && (
        <div className="notice notice-error" style={{ marginBottom: 12 }}>
          <span className="notice-text">{error}</span>
        </div>
      )}

      <h4 style={{ marginBottom: 6 }}>Mitglieder</h4>

      {loading ? (
        <div className="row" style={{ justifyContent: 'center', padding: 20 }}>
          <Spinner />
        </div>
      ) : !members || members.length === 0 ? (
        <EmptyState>Noch keine Mitglieder.</EmptyState>
      ) : (
        <div className="list panel">
          {members.map((m) => {
            const isMe = m.user_id === myUserId
            const name = memberName(m)
            return (
              <div key={m.user_id} className="list-item" style={{ cursor: 'default' }}>
                <div className="list-item-main">
                  <div className="list-item-title truncate">
                    {name}
                    {isMe && <span className="muted"> (du)</span>}
                  </div>
                  <div className="list-item-sub truncate">{m.profile?.email ?? 'Adresse unbekannt'}</div>
                </div>

                {isOwner ? (
                  <select
                    className="select"
                    style={{ width: 140 }}
                    aria-label={`Rolle von ${name}`}
                    value={m.role}
                    disabled={busyId === m.user_id}
                    onChange={(e) => void changeRole(m, e.target.value as MemberRole)}
                  >
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge>{ROLE_LABEL[m.role]}</Badge>
                )}

                {/* Austreten darf laut members_delete jede Person selbst,
                    fremde Mitglieder entfernt nur der Eigentuemer. */}
                {(isOwner || isMe) && (
                  <Button
                    size="sm"
                    aria-label={
                      isMe ? 'Diesen Arbeitsbereich verlassen' : `${name} aus dem Arbeitsbereich entfernen`
                    }
                    disabled={busyId === m.user_id}
                    onClick={() => setPendingRemove(m)}
                  >
                    {isMe ? 'Verlassen' : 'Entfernen'}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!isOwner && (
        <p className="small faint" style={{ marginTop: 10, marginBottom: 0 }}>
          Rollen aendern und Personen einladen duerfen nur Eigentuemer dieses Arbeitsbereichs.
        </p>
      )}

      {kannKontenWaehlen && (
        <>
          <div className="divider" />
          <h4 style={{ marginBottom: 6 }}>Registrierte Benutzer</h4>

          {accountsNote !== null ? (
            <p className="small faint" style={{ marginTop: 0 }}>
              {accountsNote}
            </p>
          ) : accounts === null ? (
            <div className="row" style={{ gap: 8 }}>
              <Spinner />
              <span className="small muted">Konten werden geladen …</span>
            </div>
          ) : (
            <>
              <div className="field-row">
                <TextField
                  label="Suchen"
                  value={accountQuery}
                  placeholder="Name oder E-Mail"
                  autoComplete="off"
                  onChange={(e) => setAccountQuery(e.target.value)}
                />
                <SelectField
                  label="Rolle beim Hinzufuegen"
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as MemberRole)}
                >
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </SelectField>
              </div>

              {kandidaten.length === 0 ? (
                <EmptyState>
                  {accounts.length === 0
                    ? 'Keine Konten gefunden.'
                    : accountQuery.trim() !== ''
                      ? 'Kein Konto passt zur Suche.'
                      : 'Alle registrierten Konten sind bereits Mitglied.'}
                </EmptyState>
              ) : (
                <div className="list panel">
                  {kandidaten.slice(0, MAX_ACCOUNT_ROWS).map((a) => (
                    <div key={a.id} className="list-item" style={{ cursor: 'default' }}>
                      <div className="list-item-main">
                        <div className="list-item-title truncate">
                          {a.display_name?.trim() || a.email}
                        </div>
                        <div className="list-item-sub truncate">{a.email}</div>
                      </div>
                      {a.is_app_admin && <Badge tone="accent">App-Admin</Badge>}
                      <Button
                        size="sm"
                        variant="primary"
                        busy={addingId === a.id}
                        disabled={addingId !== null}
                        onClick={() => void addAccount(a)}
                      >
                        Hinzufuegen
                      </Button>
                    </div>
                  ))}
                  {kandidaten.length > MAX_ACCOUNT_ROWS && (
                    <div className="list-item small faint" style={{ cursor: 'default' }}>
                      … und {kandidaten.length - MAX_ACCOUNT_ROWS} weitere. Suche eingrenzen.
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {isOwner && (
        <>
          <div className="divider" />
          <h4 style={{ marginBottom: 6 }}>Offene Einladungen</h4>

          {invites.length === 0 ? (
            <EmptyState>Keine offenen Einladungen.</EmptyState>
          ) : (
            <div className="list panel">
              {invites.map((i) => (
                <div key={i.id} className="list-item" style={{ cursor: 'default' }}>
                  <div className="list-item-main">
                    <div className="list-item-title truncate">{i.email}</div>
                    <div className="list-item-sub">Wartet auf die erste Anmeldung</div>
                  </div>
                  <Badge>{ROLE_LABEL[i.role]}</Badge>
                  <Button
                    size="sm"
                    aria-label={`Einladung fuer ${i.email} zuruecknehmen`}
                    disabled={busyId === i.id}
                    onClick={() => void revoke(i)}
                  >
                    Zuruecknehmen
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="divider" />
          <h4 style={{ marginBottom: 6 }}>
            {kannKontenWaehlen ? 'Person ohne Konto einladen' : 'Person einladen'}
          </h4>

          <form id={formId} onSubmit={submitInvite}>
            <div className="field-row">
              <TextField
                label="E-Mail-Adresse"
                type="email"
                autoComplete="off"
                value={email}
                error={emailError}
                placeholder="person@example.org"
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (emailError) setEmailError(null)
                }}
              />
              <SelectField
                label="Rolle"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as MemberRole)}
              >
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="row-between">
              <p className="small faint" style={{ margin: 0, maxWidth: 380 }}>
                Es wird <strong>keine E-Mail verschickt</strong>. Die eingeladene Person sieht den
                Arbeitsbereich, sobald sie sich mit genau dieser Adresse anmeldet.
              </p>
              <Button type="submit" variant="primary" busy={inviting}>
                Einladen
              </Button>
            </div>
          </form>
        </>
      )}

      {pendingRemove && (
        <ConfirmDialog
          title={pendingRemove.user_id === myUserId ? 'Arbeitsbereich verlassen' : 'Mitglied entfernen'}
          confirmLabel={pendingRemove.user_id === myUserId ? 'Verlassen' : 'Entfernen'}
          busy={removing}
          onCancel={cancelRemove}
          onConfirm={() => void confirmRemove()}
          message={
            pendingRemove.user_id === myUserId ? (
              <>
                Du verlierst den Zugriff auf diesen Arbeitsbereich. Nur ein Eigentuemer kann dich
                wieder aufnehmen. Angelegte Standorte und Routen bleiben erhalten.
              </>
            ) : (
              <>
                <strong>{memberName(pendingRemove)}</strong> verliert den Zugriff auf diesen
                Arbeitsbereich. Angelegte Standorte und Routen bleiben erhalten.
              </>
            )
          }
        />
      )}
    </Modal>
  )
}
