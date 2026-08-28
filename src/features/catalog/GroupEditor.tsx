/**
 * Anlegen und Bearbeiten einer Gruppe. Gruppen tragen kein Symbol: sie
 * erscheinen nicht als Nadel auf der Karte, sondern sind eine Sicht auf
 * Standorte — ein Standort kann in beliebig vielen liegen.
 */
import { useId, useState } from 'react'
import { Button, ColorPicker, Modal, TextAreaField, TextField } from '@/components/ui'
import { useStore } from '@/lib/store'
import * as db from '@/lib/db'
import VisibilityEditor from './VisibilityEditor'
import type { Group, VisibilityLevel } from '@/types/domain'

/** Vorgabe wie in der Datenbank (groups.color), auf die Palette gerundet. */
const DEFAULT_COLOR = '#9333ea'
const MAX_NAME_LENGTH = 80

export default function GroupEditor({
  group,
  onClose,
}: {
  group: Group | null
  onClose: () => void
}) {
  const workspaceId = useStore((s) => s.currentWorkspaceId)
  const refreshGroups = useStore((s) => s.refreshGroups)
  const notify = useStore((s) => s.notify)
  const reportError = useStore((s) => s.reportError)

  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [color, setColor] = useState(group?.color ?? DEFAULT_COLOR)
  const [visibility, setVisibility] = useState<VisibilityLevel>(group?.visibility ?? 'workspace')
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const colorLabelId = useId()

  async function save() {
    // Die Eingabetaste im Namensfeld loest ebenfalls aus; ohne diese Sperre
    // entstuenden bei zwei schnellen Anschlaegen zwei Gruppen.
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Bitte einen Namen angeben.')
      return
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setNameError(`Hoechstens ${MAX_NAME_LENGTH} Zeichen.`)
      return
    }
    if (!workspaceId) return

    setNameError(null)
    setBusy(true)
    try {
      const input: db.GroupInput = {
        name: trimmed,
        color,
        description: description.trim() || null,
        visibility,
      }
      if (group) await db.updateGroup(group.id, input)
      else await db.createGroup(workspaceId, input)
      await refreshGroups()
      notify('success', group ? 'Gruppe gespeichert.' : 'Gruppe angelegt.')
      onClose()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={group ? 'Gruppe bearbeiten' : 'Neue Gruppe'}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Speichern
          </Button>
        </>
      }
    >
      <TextField
        label="Name"
        value={name}
        autoFocus
        maxLength={MAX_NAME_LENGTH}
        placeholder="z. B. Tour Nord, Wartungsvertrag, Region Sued"
        error={nameError}
        onChange={(e) => {
          setName(e.target.value)
          if (nameError) setNameError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
        }}
      />

      <TextAreaField
        label="Beschreibung"
        value={description}
        rows={2}
        placeholder="Optional — was fasst diese Gruppe zusammen?"
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="field">
        <span id={colorLabelId} className="small muted" style={{ fontWeight: 600 }}>
          Farbe
        </span>
        <div role="group" aria-labelledby={colorLabelId}>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <span className="field-hint">Kennzeichnet die Gruppe in Listen und Filtern.</span>
      </div>

      <hr className="divider" />

      <VisibilityEditor
        kind="group"
        entityId={group?.id ?? null}
        workspaceId={group?.workspace_id ?? workspaceId ?? ''}
        createdBy={group?.created_by ?? null}
        value={visibility}
        onChange={setVisibility}
      />
    </Modal>
  )
}
