/**
 * Anlegen und Bearbeiten einer Kategorie.
 *
 * Das Symbol wird als kurze Kennung gespeichert ('pin', 'haus', …) und nicht
 * als Emoji: die Darstellung soll austauschbar bleiben, ohne dass dafuer
 * Datenbestand angefasst werden muss.
 */
import { useId, useState } from 'react'
import { Button, ColorPicker, Modal, TextAreaField, TextField } from '@/components/ui'
import { useStore } from '@/lib/store'
import * as db from '@/lib/db'
import VisibilityEditor from './VisibilityEditor'
import type { Category, VisibilityLevel } from '@/types/domain'

export interface CategoryIcon {
  id: string
  emoji: string
  label: string
}

export const CATEGORY_ICONS: readonly CategoryIcon[] = [
  { id: 'pin', emoji: '📍', label: 'Nadel' },
  { id: 'haus', emoji: '🏠', label: 'Haus' },
  { id: 'werk', emoji: '🏭', label: 'Werk' },
  { id: 'lager', emoji: '📦', label: 'Lager' },
  { id: 'kunde', emoji: '🤝', label: 'Kunde' },
  { id: 'stern', emoji: '⭐', label: 'Stern' },
  { id: 'fahne', emoji: '🚩', label: 'Fahne' },
  { id: 'werkzeug', emoji: '🔧', label: 'Werkzeug' },
]

/** Faellt auf die Nadel zurueck, damit unbekannte Kennungen nichts zerreissen. */
export function categoryIconEmoji(icon: string): string {
  return CATEGORY_ICONS.find((i) => i.id === icon)?.emoji ?? '📍'
}

/** Vorgabe wie in der Datenbank (categories.color). */
const DEFAULT_COLOR = '#2563eb'
const MAX_NAME_LENGTH = 80

export default function CategoryEditor({
  category,
  onClose,
}: {
  category: Category | null
  onClose: () => void
}) {
  const workspaceId = useStore((s) => s.currentWorkspaceId)
  const refreshCategories = useStore((s) => s.refreshCategories)
  const notify = useStore((s) => s.notify)
  const reportError = useStore((s) => s.reportError)

  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [color, setColor] = useState(category?.color ?? DEFAULT_COLOR)
  const [icon, setIcon] = useState(category?.icon ?? 'pin')
  const [visibility, setVisibility] = useState<VisibilityLevel>(category?.visibility ?? 'workspace')
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const colorLabelId = useId()
  const iconLabelId = useId()

  async function save() {
    // Die Eingabetaste im Namensfeld loest ebenfalls aus; ohne diese Sperre
    // entstuenden bei zwei schnellen Anschlaegen zwei Kategorien.
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
      const input: db.CategoryInput = {
        name: trimmed,
        color,
        icon,
        description: description.trim() || null,
        visibility,
      }
      if (category) await db.updateCategory(category.id, input)
      else await db.createCategory(workspaceId, input)
      await refreshCategories()
      notify('success', category ? 'Kategorie gespeichert.' : 'Kategorie angelegt.')
      onClose()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={category ? 'Kategorie bearbeiten' : 'Neue Kategorie'}
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
        placeholder="z. B. Filiale, Baustelle, Lieferant"
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
        placeholder="Optional — wofuer steht diese Kategorie?"
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="field">
        <span id={colorLabelId} className="small muted" style={{ fontWeight: 600 }}>
          Farbe
        </span>
        <div role="group" aria-labelledby={colorLabelId}>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <span className="field-hint">Faerbt die Kartennadeln dieser Kategorie.</span>
      </div>

      <div className="field">
        <span id={iconLabelId} className="small muted" style={{ fontWeight: 600 }}>
          Symbol
        </span>
        <div className="chips" role="group" aria-labelledby={iconLabelId}>
          {CATEGORY_ICONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`chip ${icon === option.id ? 'is-on' : ''}`}
              aria-pressed={icon === option.id}
              onClick={() => setIcon(option.id)}
            >
              <span aria-hidden="true">{option.emoji}</span>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <hr className="divider" />

      <VisibilityEditor
        kind="category"
        entityId={category?.id ?? null}
        workspaceId={category?.workspace_id ?? workspaceId ?? ''}
        createdBy={category?.created_by ?? null}
        value={visibility}
        onChange={setVisibility}
      />
    </Modal>
  )
}
