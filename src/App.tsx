import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import { Notices, Spinner } from '@/components/ui'
import AuthScreen from '@/features/auth/AuthScreen'
import Header from '@/features/shell/Header'
import LocationsPanel from '@/features/locations/LocationsPanel'
import CatalogPanel from '@/features/catalog/CatalogPanel'
import RoutesPanel from '@/features/routes/RoutesPanel'
import MapView from '@/features/map/MapView'
import LandingPage from '@/features/landing/LandingPage'
import RouteFromDialog from '@/features/search/RouteFromDialog'
import WorkspaceGate from '@/features/workspace/WorkspaceGate'

/**
 * Kommt der Aufruf aus einem Link in einer E-Mail (Bestaetigung, Einladung,
 * Passwort)?
 *
 * Dann darf keine Startseite dazwischen: Supabase loest den Code in der
 * Adresse ein, und waehrend das laeuft, gibt es noch keine Sitzung. Wer hier
 * eine Werbeseite saehe, haette den Eindruck, der Link sei ins Leere gegangen.
 *
 * Wird genau einmal beim Aufbau ausgewertet - danach hat supabase-js die
 * Parameter aus der Adresse schon entfernt.
 */
function kommtVonAuthLink(): boolean {
  const suche = new URLSearchParams(window.location.search)
  if (suche.has('code') || suche.has('error') || suche.has('error_description')) return true
  // Der aeltere implizite Fluss haengt alles hinter die Raute.
  const raute = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return raute.has('access_token') || raute.has('error') || raute.has('type')
}

export default function App() {
  const init = useStore((s) => s.init)
  const authReady = useStore((s) => s.authReady)
  const session = useStore((s) => s.session)
  const currentWorkspaceId = useStore((s) => s.currentWorkspaceId)
  const tab = useUi((s) => s.tab)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  /**
   * Einmal beim Aufbau festgehalten: supabase-js raeumt die Parameter aus der
   * Adresse, sobald es den Code eingeloest hat. Spaeter erneut zu fragen
   * ergaebe eine andere Antwort als beim ersten Mal.
   */
  const [vonAuthLink] = useState(kommtVonAuthLink)
  /** Anmeldemaske statt Startseite - von Hand geoeffnet oder per E-Mail-Link. */
  const [zeigeAnmeldung, setZeigeAnmeldung] = useState(vonAuthLink)

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
        {zeigeAnmeldung ? (
          <AuthScreen onZurueck={vonAuthLink ? undefined : () => setZeigeAnmeldung(false)} />
        ) : (
          <LandingPage onAnmelden={() => setZeigeAnmeldung(true)} />
        )}
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
      {/* Ausserhalb der Karte: die Karte bildet einen eigenen Stapelkontext,
          ein Dialog darin laege unter ihren Ebenen. */}
      <RouteFromDialog />
      <Notices />
    </div>
  )
}
