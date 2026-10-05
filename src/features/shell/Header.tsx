import { useUi } from '@/lib/uiStore'
import { useStore } from '@/lib/store'
import { Tabs, IconButton } from '@/components/ui'
import BrandMark from '@/components/BrandMark'
import WorkspaceMenu from '@/features/workspace/WorkspaceMenu'
import UserMenu from '@/features/workspace/UserMenu'
import AddressSearchBar from '@/features/search/AddressSearchBar'

// Auf dem Tablet im Hochformat fehlt der Platz fuer den langen Reiter; dann
// steht dort nur "Gruppen" wie in der Navigationsleiste des Telefons.
const TABS = [
  { id: 'locations' as const, label: 'Standorte' },
  {
    id: 'catalog' as const,
    label: (
      <>
        <span className="wide-only">Kategorien &amp; </span>Gruppen
      </>
    ),
  },
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
        <BrandMark size={18} />
        <span className="wide-only">mapper</span>
      </span>

      <WorkspaceMenu />

      {/* Am Telefon stehen die Reiter unten in der Navigationsleiste. */}
      {hasWorkspace && (
        <div className="desktop-only" style={{ marginLeft: 8 }}>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>
      )}

      {/* Die Adresssuche steht in der Kopfzeile und ist damit auf jedem
          Reiter erreichbar, nicht nur in der Standortliste. */}
      {hasWorkspace && <AddressSearchBar />}

      <div className="grow desktop-only" />

      {hasWorkspace && (
        <IconButton
          className="desktop-only"
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
