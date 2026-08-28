/**
 * Leere Startseite fuer angemeldete Personen ohne Arbeitsbereich. Sie erklaert
 * den Begriff, statt nur eine leere Karte zu zeigen — ohne Bereich gibt es in
 * der Anwendung sonst nichts zu sehen.
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { useStore } from '@/lib/store'
import { Button, ColorPicker, Modal, PALETTE, Spinner, TextField } from '@/components/ui'

export default function WorkspaceGate() {
  const profile = useStore((s) => s.profile)
  const addWorkspace = useStore((s) => s.addWorkspace)
  const loadWorkspaces = useStore((s) => s.loadWorkspaces)
  const notify = useStore((s) => s.notify)

  const [waited, setWaited] = useState(false)
  const [creating, setCreating] = useState(false)
  const [checking, setChecking] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PALETTE[0])
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formId = useId()
  const colorLabelId = useId()

  useEffect(() => {
    // Der Speicher kennt kein Kennzeichen "Bereiche werden geladen". Statt hier
    // endlos zu drehen, zeigt die Seite ihren Inhalt nach kurzer Wartezeit auch
    // dann, wenn das Profil nicht ankommt.
    const timer = window.setTimeout(() => setWaited(true), 1200)
    return () => window.clearTimeout(timer)
  }, [])

  // Stabil, weil Modal seinen Fokus-Effekt an onClose haengt: ein bei jedem
  // Rendern neu gebautes Schliessen risse den Fokus nach jedem Tastendruck
  // aus dem Namensfeld.
  const closeCreate = useCallback(() => setCreating(false), [])

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

  async function recheck() {
    setChecking(true)
    try {
      await loadWorkspaces()
      // Ohne Rueckmeldung waere nicht zu erkennen, ob ueberhaupt etwas geprueft
      // wurde: bei Erfolg wechselt die Ansicht, sonst passiert sichtbar nichts.
      if (useStore.getState().workspaces.length === 0) {
        notify('info', 'Es liegt keine Einladung fuer deine Adresse vor.')
      }
    } finally {
      setChecking(false)
    }
  }

  if (!waited && !profile) {
    return (
      <div className="auth-screen">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <div className="auth-card panel" style={{ maxWidth: 460 }}>
        <h1 className="auth-title">Noch kein Arbeitsbereich</h1>
        <p className="auth-sub">
          Ein Arbeitsbereich ist der Rahmen fuer alles, was du hier pflegst.
        </p>

        <ul className="small muted" style={{ margin: '0 0 18px', paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Standorte, Kategorien, Gruppen und Routen gehoeren immer genau einem Bereich.</li>
          <li>
            Du entscheidest, wer mitarbeitet: als Leser, Bearbeiter oder Eigentuemer.
          </li>
          <li>Mehrere Bereiche bleiben streng getrennt — etwa je Region oder je Kunde.</li>
        </ul>

        <Button variant="primary" block onClick={() => setCreating(true)}>
          Ersten Arbeitsbereich anlegen
        </Button>

        <div className="divider" />

        <p className="small faint" style={{ marginBottom: 8 }}>
          Wurdest du eingeladen? Einladungen werden beim Anmelden eingeloest. Fehlt der
          Bereich, pruefe hier noch einmal.
        </p>
        <Button block busy={checking} onClick={() => void recheck()}>
          Einladungen pruefen
        </Button>
      </div>

      {creating && (
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
        </Modal>
      )}
    </div>
  )
}
