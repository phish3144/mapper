import { useUi } from '@/lib/uiStore'
import { useStore } from '@/lib/store'
import { Tabs, IconButton } from '@/components/ui'
import WorkspaceMenu from '@/features/workspace/WorkspaceMenu'
import UserMenu from '@/features/workspace/UserMenu'

const TABS = [
  { id: 'locations' as const, label: 'Standorte' },
  { id: 'catalog' as const, label: 'Kategorien & Gruppen' },
  { id: 'routes' as const, label: 'Routen' },
]

export default function Header() {
  const tab = useUi((s) => s.tab)
  const setTab = useUi((s) => s.setTab)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const setSidebarOpen = useUi((s) => s.setSidebarOpen)
  const hasWorkspace = useStore((s) => s.currentWorkspaceId !== null)

  return (
    <header className="app-header">
      <span className="app-brand">
        <span aria-hidden="true">📍</span> mapper
      </span>

      <WorkspaceMenu />

      {hasWorkspace && (
        <div style={{ marginLeft: 8 }}>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>
      )}

      <div className="grow" />

      {hasWorkspace && (
        <IconButton
          label={sidebarOpen ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden'}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? '◧' : '▣'}
        </IconButton>
      )}
      <UserMenu />
    </header>
  )
}
