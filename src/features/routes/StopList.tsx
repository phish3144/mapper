import { useMemo } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconButton, Badge, GroupStripe } from '@/components/ui'
import { useLocationColors, useStore } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import { formatTime, formatDuration, formatMinutes } from '@/lib/format'
import type { Schedule, ScheduledStop } from '@/lib/planner'
import type { MapLocation, RouteStop } from '@/types/domain'

interface Entry {
  stop: RouteStop
  location: MapLocation
}

function violationLabel(v: ScheduledStop['violation']): string | null {
  if (v === 'late') return 'zu spaet'
  if (v === 'closed-day') return 'geschlossen'
  return null
}

function SortableStop({
  entry,
  index,
  scheduled,
  colors,
  canEdit,
  onRemove,
}: {
  entry: Entry
  index: number
  scheduled: ScheduledStop | undefined
  colors: string[]
  canEdit: boolean
  onRemove: (stopId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.stop.id,
    disabled: !canEdit,
  })
  const focusPoint = useUi((s) => s.focusPoint)
  const selectLocation = useUi((s) => s.selectLocation)

  const violation = scheduled ? violationLabel(scheduled.violation) : null

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`stop-row ${isDragging ? 'is-dragging' : ''} ${violation ? 'is-violation' : ''}`}
    >
      {canEdit && (
        <span
          className="stop-handle"
          {...attributes}
          {...listeners}
          aria-label={`Stopp ${index + 1} verschieben`}
          title="Zum Umsortieren ziehen"
        >
          ⠿
        </span>
      )}
      <span className="stop-index">{index + 1}</span>
      <button
        type="button"
        className="grow truncate"
        style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, font: 'inherit', color: 'inherit' }}
        onClick={() => {
          selectLocation(entry.location.id)
          focusPoint({ lat: entry.location.lat, lng: entry.location.lng })
        }}
      >
        <span className="row" style={{ gap: 6 }}>
          <GroupStripe colors={colors} />
          <span className="truncate">{entry.location.name}</span>
        </span>
        <span className="stop-time">
          {scheduled?.arrival ? (
            <>
              an {formatTime(scheduled.arrival)}
              {scheduled.waitMinutes > 0 && ` · ${formatMinutes(scheduled.waitMinutes)} Wartezeit`}
              {scheduled.departure && ` · ab ${formatTime(scheduled.departure)}`}
            </>
          ) : (
            scheduled && scheduled.travelSecFromPrev > 0 && `${formatDuration(scheduled.travelSecFromPrev)} Fahrt`
          )}
        </span>
      </button>
      {violation && <Badge tone="danger">{violation}</Badge>}
      {canEdit && (
        <IconButton label={`${entry.location.name} aus der Route entfernen`} onClick={() => onRemove(entry.stop.id)}>
          ✕
        </IconButton>
      )}
    </div>
  )
}

export default function StopList({
  entries,
  schedule,
  canEdit,
  onReorder,
  onRemove,
}: {
  entries: Entry[]
  schedule: Schedule | null
  canEdit: boolean
  onReorder: (orderedStopIds: string[]) => void
  onRemove: (stopId: string) => void
}) {
  const categories = useStore((s) => s.categories)
  const catIndex = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const colorsOf = useLocationColors()

  const sensors = useSensors(
    // Erst ab 5 px Bewegung ziehen, sonst verschluckt der Zieh-Handler jeden Klick.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ids = useMemo(() => entries.map((e) => e.stop.id), [entries])
  const scheduledByIndex = useMemo(() => {
    const map = new Map<number, ScheduledStop>()
    if (schedule) for (const s of schedule.stops) map.set(s.index, s)
    return map
  }, [schedule])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(ids, from, to))
  }

  if (entries.length === 0) {
    return (
      <div className="empty">
        Noch keine Stopps. Waehle Standorte auf der Karte oder in der Liste aus und fuege sie hinzu.
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div>
          {entries.map((entry, i) => (
            <SortableStop
              key={entry.stop.id}
              entry={entry}
              index={i}
              scheduled={scheduledByIndex.get(i)}
              colors={colorsOf(
                entry.location,
                entry.location.category_id ? catIndex.get(entry.location.category_id) : undefined,
              )}
              canEdit={canEdit}
              onRemove={onRemove}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
