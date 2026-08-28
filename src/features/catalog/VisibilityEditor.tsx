/**
 * Sichtbarkeit eines einzelnen Objekts.
 *
 * Die Stufen sind hier absichtlich mit ihren Grenzen beschriftet: "privat"
 * heisst nicht unsichtbar fuer die Eigentuemer des Arbeitsbereichs. Genau so
 * steht es in der Datenbankfunktion is_visible(); eine Oberflaeche, die mehr
 * verspricht, waere eine Luege.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Badge, Checkbox, SelectField, Spinner } from '@/components/ui'
import { useCanEdit, useIsOwner, useStore } from '@/lib/store'
import * as db from '@/lib/db'
import type { EntityKind, VisibilityLevel } from '@/types/domain'

const LEVEL_LABELS: Record<VisibilityLevel, string> = {
  workspace: 'Alle im Arbeitsbereich',
  restricted: 'Nur ausgewaehlte Personen',
  private: 'Nur ich',
}

const LEVEL_HINTS: Record<VisibilityLevel, string> = {
  workspace: 'Jede Person mit Zugang zu diesem Arbeitsbereich sieht den Eintrag.',
  restricted:
    'Sichtbar fuer die unten ausgewaehlten Personen. Zusaetzlich sehen ihn immer die Eigentuemer ' +
    'des Arbeitsbereichs und die Person, die ihn angelegt hat.',
  private:
    'Sichtbar nur fuer die Person, die den Eintrag angelegt hat. Die Eigentuemer des ' +
    'Arbeitsbereichs sehen ihn weiterhin — vor ihnen laesst sich nichts verbergen.',
}

interface Props {
  kind: EntityKind
  entityId: string | null
  workspaceId: string
  value: VisibilityLevel
  onChange: (next: VisibilityLevel) => void
  /**
   * Wer den Eintrag angelegt hat. Optional: nur damit die Oberflaeche weiss,
   * ob Einzelfreigaben ueberhaupt geaendert werden duerfen
   * (can_manage_entity_visibility in Migration 0003/0005 laesst dafuer nur
   * Eigentuemer des Bereichs und den Ersteller zu). Ohne Angabe bleibt es beim
   * Versuch — dann entscheidet die Datenbank.
   */
  createdBy?: string | null
}

function memberName(m: db.MemberWithProfile, myId: string | null): string {
  const base = m.profile?.display_name?.trim() || m.profile?.email || 'Unbekanntes Konto'
  return m.user_id === myId ? `${base} (du)` : base
}

export default function VisibilityEditor({
  kind,
  entityId,
  workspaceId,
  value,
  onChange,
  createdBy,
}: Props) {
  const canEdit = useCanEdit()
  const isOwner = useIsOwner()
  const grants = useStore((s) => s.grants)
  const myId = useStore((s) => s.profile?.id ?? null)
  const reportError = useStore((s) => s.reportError)
  const reloadWorkspaceData = useStore((s) => s.reloadWorkspaceData)

  const [members, setMembers] = useState<db.MemberWithProfile[] | null>(null)
  const [membersFailed, setMembersFailed] = useState(false)
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const listLabelId = useId()

  // Freigaben darf nur aendern, wer den Bereich besitzt oder den Eintrag
  // angelegt hat. Ist der Ersteller unbekannt, wird nichts unterstellt.
  const canManageGrants =
    isOwner || createdBy === undefined || (createdBy !== null && createdBy === myId)

  const needsMembers = canEdit && value === 'restricted' && entityId !== null

  const grantedInStore = useMemo(() => {
    const set = new Set<string>()
    if (!entityId) return set
    for (const g of grants) {
      if (g.entity_kind === kind && g.entity_id === entityId) set.add(g.user_id)
    }
    return set
  }, [grants, kind, entityId])

  const [granted, setGranted] = useState<Set<string>>(grantedInStore)
  useEffect(() => {
    setGranted(grantedInStore)
  }, [grantedInStore])

  // Der Datenspeicher kennt keine eigene Aktion fuer Freigaben. Statt nach
  // jedem Haken alles neu zu laden, wird einmal beim Verlassen nachgezogen.
  const changedRef = useRef(false)
  useEffect(
    () => () => {
      if (changedRef.current) void reloadWorkspaceData()
    },
    [reloadWorkspaceData],
  )

  useEffect(() => {
    if (!needsMembers) return
    let cancelled = false
    setMembersFailed(false)
    db.fetchMembers(workspaceId)
      .then((rows) => {
        if (!cancelled) setMembers(rows)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // Ohne diesen Merker bliebe `members` null und die Liste behauptete,
        // es gaebe keine Mitglieder.
        setMembersFailed(true)
        reportError(e)
      })
    return () => {
      cancelled = true
    }
  }, [needsMembers, workspaceId, reportError])

  async function toggle(userId: string, next: boolean) {
    if (!entityId || !canManageGrants) return
    setPendingUserId(userId)
    try {
      if (next) await db.grantVisibility(workspaceId, kind, entityId, userId)
      else await db.revokeVisibility(kind, entityId, userId)
      setGranted((prev) => {
        const copy = new Set(prev)
        if (next) copy.add(userId)
        else copy.delete(userId)
        return copy
      })
      changedRef.current = true
    } catch (e) {
      reportError(e)
    } finally {
      setPendingUserId(null)
    }
  }

  // Leserinnen und Leser bekommen keine Bedienelemente, sondern die Auskunft,
  // woran sie sind.
  if (!canEdit) {
    return (
      <div className="field">
        <span className="small muted" style={{ fontWeight: 600 }}>
          Sichtbarkeit
        </span>
        <div className="row">
          <Badge tone={value === 'workspace' ? 'default' : 'warning'}>{LEVEL_LABELS[value]}</Badge>
        </div>
        <span className="field-hint">{LEVEL_HINTS[value]}</span>
      </div>
    )
  }

  const sortedMembers = members
    ? [...members].sort((a, b) => memberName(a, myId).localeCompare(memberName(b, myId), 'de'))
    : null

  return (
    <>
      <SelectField
        label="Sichtbarkeit"
        value={value}
        hint={LEVEL_HINTS[value]}
        onChange={(e) => onChange(e.target.value as VisibilityLevel)}
      >
        <option value="workspace">{LEVEL_LABELS.workspace}</option>
        <option value="restricted">{LEVEL_LABELS.restricted}</option>
        <option value="private">{LEVEL_LABELS.private}</option>
      </SelectField>

      {value === 'restricted' && (
        <div className="field">
          <span id={listLabelId} className="small muted" style={{ fontWeight: 600 }}>
            Einzelfreigaben
          </span>

          {!entityId ? (
            <span className="field-hint">
              Einzelfreigaben lassen sich vergeben, sobald der Eintrag einmal gespeichert ist. Bis
              dahin sehen ihn nur du und die Eigentuemer des Arbeitsbereichs.
            </span>
          ) : membersFailed ? (
            <span className="field-hint">
              Die Mitglieder konnten nicht geladen werden. Schliesse den Dialog und versuche es
              erneut.
            </span>
          ) : !sortedMembers ? (
            <div className="row" style={{ padding: '6px 0' }}>
              <Spinner />
              <span className="small muted">Mitglieder werden geladen …</span>
            </div>
          ) : sortedMembers.length === 0 ? (
            <span className="field-hint">In diesem Arbeitsbereich gibt es keine weiteren Mitglieder.</span>
          ) : (
            <>
              <div
                className="panel scroll-y"
                style={{ maxHeight: 190, padding: 10 }}
                role="group"
                aria-labelledby={listLabelId}
              >
                <div className="col" style={{ gap: 7 }}>
                  {sortedMembers.map((m) => {
                    // Eigentuemer sehen jeden Eintrag ohnehin — ein leeres
                    // Kaestchen daneben waere eine Falschaussage.
                    if (m.role === 'owner') {
                      return (
                        <div key={m.user_id} className="row-between">
                          <span className="truncate">{memberName(m, myId)}</span>
                          <Badge tone="success">sieht es immer</Badge>
                        </div>
                      )
                    }
                    if (!canManageGrants) {
                      return (
                        <div key={m.user_id} className="row-between">
                          <span className="truncate">{memberName(m, myId)}</span>
                          {granted.has(m.user_id) ? (
                            <Badge tone="accent">freigegeben</Badge>
                          ) : (
                            <span className="small faint">ohne Zugriff</span>
                          )}
                        </div>
                      )
                    }
                    return (
                      <div key={m.user_id} className="row-between">
                        <Checkbox
                          label={<span className="truncate">{memberName(m, myId)}</span>}
                          checked={granted.has(m.user_id)}
                          disabled={pendingUserId === m.user_id}
                          onChange={(next) => void toggle(m.user_id, next)}
                        />
                        {m.role === 'viewer' && <Badge>Leser</Badge>}
                      </div>
                    )
                  })}
                </div>
              </div>
              <span className="field-hint">
                {canManageGrants
                  ? 'Aenderungen an dieser Liste werden sofort gespeichert, unabhaengig vom Formular.'
                  : 'Diese Liste kann nur aendern, wer den Eintrag angelegt hat oder den Arbeitsbereich besitzt.'}
              </span>
            </>
          )}
        </div>
      )}
    </>
  )
}
