/**
 * Team-Schnellfilter direkt auf der Karte.
 *
 * Derselbe Gruppenfilter wie in der Standortliste - nur dort, wo hingeschaut
 * wird. "Zeig mir nur Team FOB" soll ein Klick sein und nicht erst ein
 * Reiterwechsel in die Seitenleiste, die auf dem Telefon die Karte verdeckt.
 */
import { Dot } from '@/components/ui'
import { useStore } from '@/lib/store'
import { useUi } from '@/lib/uiStore'

export default function TeamChips() {
  const groups = useStore((s) => s.groups)
  const groupIds = useUi((s) => s.filter.groupIds)
  const patchFilter = useUi((s) => s.patchFilter)

  if (groups.length === 0) return null

  function umschalten(id: string): void {
    patchFilter({
      groupIds: groupIds.includes(id) ? groupIds.filter((g) => g !== id) : [...groupIds, id],
    })
  }

  return (
    <div className="team-chips" role="group" aria-label="Nach Team filtern">
      <button
        type="button"
        className={`team-chip ${groupIds.length === 0 ? 'is-on' : ''}`}
        aria-pressed={groupIds.length === 0}
        onClick={() => patchFilter({ groupIds: [] })}
      >
        Alle
      </button>
      {groups.map((g) => {
        const an = groupIds.includes(g.id)
        return (
          <button
            key={g.id}
            type="button"
            className={`team-chip ${an ? 'is-on' : ''}`}
            aria-pressed={an}
            onClick={() => umschalten(g.id)}
          >
            <Dot color={g.color} />
            {g.name}
          </button>
        )
      })}
    </div>
  )
}
