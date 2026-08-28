import { useEffect } from 'react'
import { useStore } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import { Notices, Spinner } from '@/components/ui'
import AuthScreen from '@/features/auth/AuthScreen'
import Header from '@/features/shell/Header'
import LocationsPanel from '@/features/locations/LocationsPanel'
import CatalogPanel from '@/features/catalog/CatalogPanel'
import RoutesPanel from '@/features/routes/RoutesPanel'
import MapView from '@/features/map/MapView'
import WorkspaceGate from '@/features/workspace/WorkspaceGate'

export default function App() {
  const init = useStore((s) => s.init)
  const authReady = useStore((s) => s.authReady)
  const session = useStore((s) => s.session)
  const currentWorkspaceId = useStore((s) => s.currentWorkspaceId)
  const tab = useUi((s) => s.tab)
  const sidebarOpen = useUi((s) => s.sidebarOpen)

  useEffect(() => {
    void init()
  }, [init])

  if (!authReady) {
    return (
      <div className="auth-screen">
        <Spinner />
      </div>
    )
  }

  if (!session) {
    return (
      <>
        <AuthScreen />
        <Notices />
      </>
    )
  }

  return (
    <div className="app">
      <Header />
      {currentWorkspaceId ? (
        <div className={`app-body ${sidebarOpen ? '' : 'is-collapsed'}`}>
          <aside className="sidebar">
            {tab === 'locations' && <LocationsPanel />}
            {tab === 'catalog' && <CatalogPanel />}
            {tab === 'routes' && <RoutesPanel />}
          </aside>
          <main className="map-area">
            <MapView />
          </main>
        </div>
      ) : (
        <WorkspaceGate />
      )}
      <Notices />
    </div>
  )
}
