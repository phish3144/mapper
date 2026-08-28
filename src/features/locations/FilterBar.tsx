/**
 * Filter der Standortliste.
 *
 * Der Filter liegt im Oberflaechenzustand und nicht hier, weil die Karte
 * dieselbe Menge zeigen muss wie die Liste. Diese Leiste ist also nur die
 * Bedienung eines gemeinsamen Zustands, kein eigener.
 */
import { Button, Checkbox, IconButton } from '@/components/ui'
import { useStore } from '@/lib/store'
import { isFilterActive, useUi } from '@/lib/uiStore'
import { formatLatLng } from '@/lib/geo'
import { formatDistance } from '@/lib/format'

export default function FilterBar() {
  const categories = useStore((s) => s.categories)
  const groups = useStore((s) => s.groups)
  const filter = useUi((s) => s.filter)
  const patchFilter = useUi((s) => s.patchFilter)
  const resetFilter = useUi((s) => s.resetFilter)

  const active = isFilterActive(filter)

  function toggleId(key: 'categoryIds' | 'groupIds', id: string) {
    const current = filter[key]
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    patchFilter(key === 'categoryIds' ? { categoryIds: next } : { groupIds: next })
  }

  return (
    <div className="col" style={{ gap: 8, marginBottom: 10 }}>
      <input
        className="input"
        type="search"
        value={filter.search}
        placeholder="Suchen in Name, Adresse, Notizen, Tags"
        aria-label="Standorte durchsuchen"
        onChange={(e) => patchFilter({ search: e.target.value })}
      />

      {categories.length > 0 && (
        <div
          className="chips scroll-y"
          style={{ maxHeight: 84 }}
          role="group"
          aria-label="Nach Kategorien filtern"
        >
          {categories.map((c) => {
            const on = filter.categoryIds.includes(c.id)
            return (
              <button
                key={c.id}
                type="button"
                className={`chip ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleId('categoryIds', c.id)}
              >
                <span className="dot" style={{ background: c.color }} aria-hidden="true" />
                {c.name}
              </button>
            )
          })}
        </div>
      )}

      {groups.length > 0 && (
        <div
          className="chips scroll-y"
          style={{ maxHeight: 84 }}
          role="group"
          aria-label="Nach Gruppen filtern"
        >
          {groups.map((g) => {
            const on = filter.groupIds.includes(g.id)
            return (
              <button
                key={g.id}
                type="button"
                className={`chip ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleId('groupIds', g.id)}
              >
                <span className="dot" style={{ background: g.color }} aria-hidden="true" />
                {g.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Tags werden nicht als Vorrat angeboten (es koennen sehr viele sein),
          ein gesetzter Tag-Filter muss aber sichtbar und loesbar sein. */}
      {filter.tags.length > 0 && (
        <div className="chips" role="group" aria-label="Aktive Tag-Filter">
          {filter.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip is-on"
              aria-label={`Tag-Filter "${tag}" entfernen`}
              onClick={() => patchFilter({ tags: filter.tags.filter((t) => t !== tag) })}
            >
              {tag}
              <span className="chip-x" aria-hidden="true">
                ✕
              </span>
            </button>
          ))}
        </div>
      )}

      {filter.center && filter.radiusKm !== null && filter.radiusKm > 0 && (
        <div className="row-between">
          <span className="small muted truncate">
            Umkreis {formatDistance(filter.radiusKm * 1000)} um {formatLatLng(filter.center)}
          </span>
          <IconButton
            label="Umkreisfilter entfernen"
            onClick={() => patchFilter({ center: null, radiusKm: null })}
          >
            ✕
          </IconButton>
        </div>
      )}

      <div className="row-between">
        <Checkbox
          label={<span className="small">nur aktive</span>}
          checked={filter.onlyActive}
          onChange={(on) => patchFilter({ onlyActive: on })}
        />
        {active && (
          <Button size="sm" variant="ghost" onClick={resetFilter}>
            Filter zuruecksetzen
          </Button>
        )}
      </div>
    </div>
  )
}
