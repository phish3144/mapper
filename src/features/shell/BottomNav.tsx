/**
 * Navigationsleiste unten - nur auf dem Telefon.
 *
 * Ersetzt dort die Reiter der Kopfzeile und den Umschalter fuer die
 * Seitenleiste: "Karte" schliesst die Seitenleiste, jeder andere Punkt
 * oeffnet sie mit dem passenden Reiter. Unten, weil dort der Daumen ist und
 * weil die Kopfzeile neben der Suche keinen Platz fuer drei Reiter hat.
 */
import { useUi, type PanelTab } from '@/lib/uiStore'

type Ziel = 'karte' | PanelTab

const STRICH = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const PUNKTE: { id: Ziel; label: string; aria?: string; icon: React.ReactNode }[] = [
  {
    id: 'karte',
    label: 'Karte',
    icon: (
      <svg viewBox="0 0 24 24" {...STRICH} aria-hidden="true">
        <path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4z" />
        <path d="M9 4v13.5M15 6.5V20" />
      </svg>
    ),
  },
  {
    id: 'locations',
    label: 'Standorte',
    icon: (
      <svg viewBox="0 0 24 24" {...STRICH} aria-hidden="true">
        <path d="M12 21s-6.5-6.2-6.5-11.5a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" />
        <circle cx="12" cy="9.5" r="2.3" />
      </svg>
    ),
  },
  {
    id: 'catalog',
    label: 'Gruppen',
    aria: 'Kategorien und Gruppen',
    icon: (
      <svg viewBox="0 0 24 24" {...STRICH} aria-hidden="true">
        <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0z" />
        <circle cx="8" cy="8" r="1.4" />
      </svg>
    ),
  },
  {
    id: 'routes',
    label: 'Routen',
    icon: (
      <svg viewBox="0 0 24 24" {...STRICH} aria-hidden="true">
        <circle cx="6" cy="18" r="2.2" />
        <circle cx="18" cy="6" r="2.2" />
        <path d="M8.2 18h6.3a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7h6.3" />
      </svg>
    ),
  },
]

export default function BottomNav() {
  const tab = useUi((s) => s.tab)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const setTab = useUi((s) => s.setTab)
  const setSidebarOpen = useUi((s) => s.setSidebarOpen)

  const aktiv: Ziel = sidebarOpen ? tab : 'karte'

  function waehle(ziel: Ziel): void {
    if (ziel === 'karte') {
      setSidebarOpen(false)
      return
    }
    setTab(ziel)
    setSidebarOpen(true)
  }

  return (
    <nav className="bottom-nav mobile-only" aria-label="Hauptnavigation">
      {PUNKTE.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`bottom-nav-item ${aktiv === p.id ? 'is-active' : ''}`}
          aria-current={aktiv === p.id ? 'page' : undefined}
          aria-label={p.aria}
          onClick={() => waehle(p.id)}
        >
          {p.icon}
          <span>{p.label}</span>
        </button>
      ))}
    </nav>
  )
}
