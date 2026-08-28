import { useMemo } from 'react'
import { Checkbox, Field } from '@/components/ui'
import { useStore, buildMembershipMap } from '@/lib/store'
import { applyRule, describeRule } from '@/lib/rules'
import { formatLatLng } from '@/lib/geo'
import { pluralize } from '@/lib/format'
import type { RouteRule } from '@/types/domain'

/**
 * Stellt die Regel ein, aus der sich eine dynamische Route speist, und zeigt
 * unmittelbar, wie viele Standorte sie derzeit trifft. Ohne diese Vorschau
 * waere eine Regel ein Blindflug.
 */
export default function RuleEditor({
  value,
  onChange,
}: {
  value: RouteRule
  onChange: (next: RouteRule) => void
}) {
  const categories = useStore((s) => s.categories)
  const groups = useStore((s) => s.groups)
  const locations = useStore((s) => s.locations)
  const locationGroups = useStore((s) => s.locationGroups)

  const membership = useMemo(() => buildMembershipMap(locationGroups), [locationGroups])
  const matched = useMemo(
    () => applyRule(value, locations, membership),
    [value, locations, membership],
  )

  const toggle = (key: 'categoryIds' | 'groupIds', id: string) => {
    const current = value[key] ?? []
    onChange({
      ...value,
      [key]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    })
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <Field label="Kategorien">
        {() =>
          categories.length === 0 ? (
            <span className="faint small">Noch keine Kategorien angelegt.</span>
          ) : (
            <div className="chips">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip ${(value.categoryIds ?? []).includes(c.id) ? 'is-on' : ''}`}
                  onClick={() => toggle('categoryIds', c.id)}
                  aria-pressed={(value.categoryIds ?? []).includes(c.id)}
                >
                  <span className="dot" style={{ background: c.color }} aria-hidden="true" />
                  {c.name}
                </button>
              ))}
            </div>
          )
        }
      </Field>

      <Field label="Gruppen">
        {() =>
          groups.length === 0 ? (
            <span className="faint small">Noch keine Gruppen angelegt.</span>
          ) : (
            <div className="chips">
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`chip ${(value.groupIds ?? []).includes(g.id) ? 'is-on' : ''}`}
                  onClick={() => toggle('groupIds', g.id)}
                  aria-pressed={(value.groupIds ?? []).includes(g.id)}
                >
                  <span className="dot" style={{ background: g.color }} aria-hidden="true" />
                  {g.name}
                </button>
              ))}
            </div>
          )
        }
      </Field>

      <div className="field-row">
        <Field label="Umkreis um (Breite / Laenge)" hint="Leer lassen fuer keinen Umkreisfilter">
          {(id) => (
            <input
              id={id}
              className="input"
              placeholder="52.5170, 13.4050"
              defaultValue={value.center ? `${value.center.lat}, ${value.center.lng}` : ''}
              onBlur={(e) => {
                const raw = e.target.value.trim()
                if (!raw) {
                  onChange({ ...value, center: null })
                  return
                }
                const parts = raw.split(/[,;]/).map((p) => Number(p.trim().replace(',', '.')))
                if (parts.length === 2 && parts.every(Number.isFinite)) {
                  onChange({ ...value, center: { lat: parts[0], lng: parts[1] } })
                }
              }}
            />
          )}
        </Field>
        <Field label="Radius (km)">
          {(id) => (
            <input
              id={id}
              className="input"
              type="number"
              min={0}
              step={1}
              value={value.radiusKm ?? ''}
              onChange={(e) =>
                onChange({ ...value, radiusKm: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          )}
        </Field>
      </div>

      <div className="field-row">
        <Field label="Hoechstzahl der Stopps" hint="Leer = alle Treffer">
          {(id) => (
            <input
              id={id}
              className="input"
              type="number"
              min={1}
              step={1}
              value={value.maxStops ?? ''}
              onChange={(e) =>
                onChange({ ...value, maxStops: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          )}
        </Field>
        <div className="field">
          <label>Weitere Bedingungen</label>
          <Checkbox
            label="nur aktive Standorte"
            checked={value.onlyActive !== false}
            onChange={(on) => onChange({ ...value, onlyActive: on })}
          />
        </div>
      </div>

      <div className="panel panel-pad" style={{ background: 'var(--bg-subtle)' }}>
        <div className="small muted" style={{ marginBottom: 4 }}>
          {describeRule(value, categories, groups)}
        </div>
        <div>
          <strong>{matched.length}</strong> {pluralize(matched.length, 'Standort', 'Standorte')} treffen zu
          {value.center && (
            <span className="faint small"> · Mittelpunkt {formatLatLng(value.center)}</span>
          )}
        </div>
        {matched.length > 0 && (
          <div className="small faint truncate" style={{ marginTop: 4 }}>
            {matched.slice(0, 6).map((l) => l.name).join(', ')}
            {matched.length > 6 && ` … und ${matched.length - 6} weitere`}
          </div>
        )}
      </div>
    </div>
  )
}
