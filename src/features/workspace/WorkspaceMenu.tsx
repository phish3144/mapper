/**
 * Bereichswahl in der Kopfzeile. Bewusst ein Aufklappmenue und keine Liste in
 * der Seitenleiste: der Arbeitsbereich wechselt selten, kostet aber jedes Mal
 * den gesamten Datenbestand — er gehoert an eine Stelle, an die man nicht
 * versehentlich klickt.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useCurrentWorkspace, useStore } from '@/lib/store'
import { Button, ColorPicker, Dot, Modal, PALETTE, TextField } from '@/components/ui'

export default function WorkspaceMenu() {
  const workspaces = useStore((s) => s.workspaces)
  const currentId = useStore((s) => s.currentWorkspaceId)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const addWorkspace = useStore((s) => s.addWorkspace)
  const notify = useStore((s) => s.notify)
  const current = useCurrentWorkspace()

  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PALETTE[0])
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  async function switchTo(id: string) {
    setOpen(false)
    triggerRef.current?.focus()
    if (id === currentId) return
    await selectWorkspace(id)
  }

  // Stabile Kennung: Modal haengt seinen Fokus-Effekt an onClose. Ein bei jedem
  // Rendern neu gebautes Schliessen wuerde den Effekt nach jedem Tastendruck
  // erneut ausloesen und den Fokus aus dem Namensfeld reissen.
  const closeCreate = useCallback(() => setCreating(false), [])

  function openCreate() {
    setOpen(false)
    setName('')
    setNameError(null)
    // Eine noch nicht vergebene Farbe vorschlagen, damit sich die Punkte im
    // Menue voneinander unterscheiden.
    setColor(PALETTE[workspaces.length % PALETTE.length])
    setCreating(true)
  }

  async function submitCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Bitte gib einen Namen an.')
      return
    }
    setNameError(null)
    setBusy(true)
    const created = await addWorkspace(trimmed, color)
    setBusy(false)
    if (!created) return // addWorkspace hat den Fehler bereits gemeldet
    notify('success', `Arbeitsbereich "${created.name}" wurde angelegt.`)
    setCreating(false)
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
        {current ? (
          <>
            <Dot color={current.color} />
            <span className="truncate" style={{ maxWidth: 170 }}>
              {current.name}
            </span>
          </>
        ) : (
          <span className="muted">Kein Arbeitsbereich</span>
        )}
        <span aria-hidden="true" style={{ fontSize: 10 }}>
          &#9662;
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          className="panel"
          aria-label="Arbeitsbereiche"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 600,
            minWidth: 250,
            maxWidth: 340,
            padding: 4,
            boxShadow: 'var(--shadow)',
          }}
        >
          <div className="scroll-y" style={{ maxHeight: 320 }}>
            {workspaces.length === 0 ? (
              <div className="empty" style={{ padding: '14px 10px' }}>
                Noch keine Arbeitsbereiche.
              </div>
            ) : (
              workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className="btn btn-ghost"
                  aria-current={w.id === currentId ? 'true' : undefined}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => void switchTo(w.id)}
                >
                  <Dot color={w.color} />
                  <span className="grow truncate" style={{ textAlign: 'left' }}>
                    {w.name}
                  </span>
                  {w.id === currentId && <span aria-hidden="true">&#10003;</span>}
                </button>
              ))
            )}
          </div>

          <div className="divider" style={{ margin: '4px 0' }} />

          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: '100%', justifyContent: 'flex-start' }}
            onClick={openCreate}
          >
            <span aria-hidden="true">+</span>
            <span>Neuer Arbeitsbereich ...</span>
          </button>
        </div>
      )}

      {/*
        Der Dialog haengt am body statt in der Kopfzeile: `.app-header` ist ein
        Rasterelement mit z-index 500 und damit ein eigener Stapelkontext -
        Leaflets Bedienelemente (z-index 1000 im Wurzelkontext) laegen sonst
        ueber dem Dialog.
      */}
      {creating &&
        createPortal(
          <Modal
            title="Neuer Arbeitsbereich"
            onClose={closeCreate}
            footer={
              <>
                <Button onClick={closeCreate} disabled={busy}>
                  Abbrechen
                </Button>
                <Button type="submit" form={formId} variant="primary" busy={busy}>
                  Anlegen
                </Button>
              </>
            }
          >
            <form id={formId} onSubmit={submitCreate}>
              <TextField
                label="Name"
                value={name}
                error={nameError}
                autoFocus
                maxLength={80}
                placeholder="z. B. Aussendienst Nord"
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
                <span className="field-hint">Kennzeichnet den Bereich in der Kopfzeile.</span>
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                Du wirst automatisch Eigentuemer und kannst anschliessend weitere Personen einladen.
              </p>
            </form>
          </Modal>,
          document.body,
        )}
    </div>
  )
}
