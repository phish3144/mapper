/**
 * Konto- und Bereichsmenue rechts in der Kopfzeile. Es zeigt nur, was die
 * angemeldete Person auch darf: Umbenennen und Loeschen erscheinen allein
 * Eigentuemern, die Kontenverwaltung allein App-Administratoren.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import * as db from '@/lib/db'
import { useCurrentWorkspace, useIsOwner, useMyRole, useStore } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import { Badge, Button, ColorPicker, Modal, PALETTE, TextField, useConfirm } from '@/components/ui'
import MembersDialog from '@/features/workspace/MembersDialog'
import AdminDialog from '@/features/workspace/AdminDialog'
import type { MemberRole } from '@/types/domain'

const THEMES = [
  { id: 'light' as const, label: 'Hell' },
  { id: 'dark' as const, label: 'Dunkel' },
  { id: 'system' as const, label: 'System' },
]

const ROLE_LABEL: Record<MemberRole, string> = {
  viewer: 'Leser',
  editor: 'Bearbeiter',
  owner: 'Eigentuemer',
}

export default function UserMenu() {
  const profile = useStore((s) => s.profile)
  const sessionEmail = useStore((s) => s.session?.user.email ?? '')
  const signOut = useStore((s) => s.signOut)
  const loadWorkspaces = useStore((s) => s.loadWorkspaces)
  const notify = useStore((s) => s.notify)
  const reportError = useStore((s) => s.reportError)
  const workspace = useCurrentWorkspace()
  const isOwner = useIsOwner()
  const role = useMyRole()

  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)

  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'members' | 'admin' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PALETTE[0])
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { confirm, confirmElement } = useConfirm()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const formId = useId()
  const colorLabelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Stabil, weil Modal seinen Fokus-Effekt an onClose haengt: ein bei jedem
  // Rendern neu gebautes Schliessen zoege den Fokus nach jedem Tastendruck
  // zurueck auf die Kopfzeile des Dialogs.
  const closeRename = useCallback(() => setRenaming(false), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  const label = profile?.display_name?.trim() || profile?.email || sessionEmail || 'Konto'

  function openRename() {
    if (!workspace) return
    setOpen(false)
    setName(workspace.name)
    setColor(workspace.color)
    setNameError(null)
    setRenaming(true)
  }

  async function submitRename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!workspace) return
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Bitte gib einen Namen an.')
      return
    }
    setBusy(true)
    try {
      await db.updateWorkspace(workspace.id, { name: trimmed, color })
      await loadWorkspaces()
      notify('success', 'Arbeitsbereich gespeichert.')
      setRenaming(false)
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(false)
    }
  }

  function askDelete() {
    if (!workspace) return
    setOpen(false)
    const doomed = workspace
    confirm(
      'Arbeitsbereich loeschen',
      <>
        <p>
          Der Arbeitsbereich <strong>{doomed.name}</strong> wird endgueltig geloescht.
        </p>
        <p style={{ marginBottom: 0 }}>
          Mit ihm verschwinden <strong>alle Standorte, Kategorien, Gruppen, Routen und
          Mitgliedschaften</strong> dieses Bereichs. Das laesst sich nicht rueckgaengig machen.
        </p>
      </>,
      async () => {
        try {
          await db.deleteWorkspace(doomed.id)
          await loadWorkspaces()
          notify('success', `Arbeitsbereich "${doomed.name}" wurde geloescht.`)
        } catch (error) {
          reportError(error)
        }
      },
      'Endgueltig loeschen',
    )
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate" style={{ maxWidth: 150 }}>
          {label}
        </span>
        <span aria-hidden="true" style={{ fontSize: 10 }}>
          &#9662;
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          className="panel"
          aria-label="Konto und Arbeitsbereich"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 600,
            minWidth: 260,
            maxWidth: 320,
            padding: 4,
            boxShadow: 'var(--shadow)',
          }}
        >
          <div style={{ padding: '6px 8px' }}>
            <div className="truncate" style={{ fontWeight: 600 }}>
              {profile?.display_name?.trim() || 'Ohne Anzeigename'}
            </div>
            <div className="small muted truncate">{profile?.email || sessionEmail}</div>
            <div className="row" style={{ gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              {role && <Badge>{ROLE_LABEL[role]}</Badge>}
              {profile?.is_app_admin && <Badge tone="accent">App-Administrator</Badge>}
            </div>
          </div>

          <div className="divider" style={{ margin: '4px 0' }} />

          {workspace && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={() => {
                setOpen(false)
                setDialog('members')
              }}
            >
              Mitglieder &amp; Freigaben
            </button>
          )}

          {profile?.is_app_admin && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={() => {
                setOpen(false)
                setDialog('admin')
              }}
            >
              Kontenverwaltung
            </button>
          )}

          {workspace && isOwner && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={openRename}
              >
                Bereich umbenennen
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={askDelete}
              >
                Bereich loeschen
              </button>
            </>
          )}

          <div className="divider" style={{ margin: '4px 0' }} />

          <div className="small faint" style={{ padding: '2px 8px 4px' }}>
            Darstellung
          </div>
          <div className="chips" style={{ padding: '0 8px 6px' }}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`chip ${theme === t.id ? 'is-on' : ''}`}
                aria-pressed={theme === t.id}
                onClick={() => setTheme(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="divider" style={{ margin: '4px 0' }} />

          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: '100%', justifyContent: 'flex-start' }}
            onClick={() => {
              setOpen(false)
              void signOut()
            }}
          >
            Abmelden
          </button>
        </div>
      )}

      {/*
        Alle Ueberlagerungen haengen am body und nicht in der Kopfzeile:
        `.app-header` ist ein Rasterelement mit z-index 500 und damit ein
        eigener Stapelkontext - Leaflets Bedienelemente (z-index 1000 im
        Wurzelkontext) laegen sonst ueber jedem Dialog.
      */}
      {createPortal(
        <>
          {renaming && workspace && (
            <Modal
              title="Arbeitsbereich umbenennen"
              onClose={closeRename}
              footer={
                <>
                  <Button onClick={closeRename} disabled={busy}>
                    Abbrechen
                  </Button>
                  <Button type="submit" form={formId} variant="primary" busy={busy}>
                    Speichern
                  </Button>
                </>
              }
            >
              <form id={formId} onSubmit={submitRename}>
                <TextField
                  label="Name"
                  value={name}
                  error={nameError}
                  autoFocus
                  maxLength={80}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (nameError) setNameError(null)
                  }}
                />
                <div className="field">
                  <span id={colorLabelId} className="small muted" style={{ fontWeight: 600 }}>
                    Farbe
                  </span>
                  <div role="group" aria-labelledby={colorLabelId}>
                    <ColorPicker value={color} onChange={setColor} />
                  </div>
                </div>
              </form>
            </Modal>
          )}

          {dialog === 'members' && <MembersDialog onClose={closeDialog} />}
          {dialog === 'admin' && <AdminDialog onClose={closeDialog} />}
          {confirmElement}
        </>,
        document.body,
      )}
    </div>
  )
}
