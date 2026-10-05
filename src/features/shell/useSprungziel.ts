/**
 * Fuehrt einen geteilten Verweis aus: Standort zeigen oder Tour oeffnen.
 *
 * Das Sprungziel wird genau einmal beim Aufbau gelesen. Der Arbeitsbereich
 * wird noch VOR der Anmeldung vorgemerkt, damit init() gleich den richtigen
 * laedt statt erst den zuletzt benutzten und dann einen zweiten.
 *
 * Gesprungen wird erst, wenn der Bestand des Bereichs geladen ist - vorher
 * saehe jeder Standort aus wie einer, den es nicht gibt.
 */
import { useEffect, useRef, useState } from 'react'
import { LAST_WORKSPACE_KEY, useStore } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import { leseSprungziel, ohneSprungziel, type Sprungziel } from '@/lib/deepLink'

/** Zoomstufe fuer einen geteilten Standort - Strassenebene. */
const SPRUNG_ZOOM = 15
/** Gleiche Grenze wie in layout.css: darunter verdeckt die Seitenleiste die Karte. */
const SCHMAL = '(max-width: 760px)'

interface Vorgemerkt {
  ziel: Sprungziel | null
  /** Der zuvor gemerkte Bereich - zurueck, falls der Link in einen fremden fuehrt. */
  vorher: string | null
}

function vormerken(): Vorgemerkt {
  const ziel = leseSprungziel(window.location.search)
  let vorher: string | null = null
  if (ziel) {
    try {
      vorher = localStorage.getItem(LAST_WORKSPACE_KEY)
      localStorage.setItem(LAST_WORKSPACE_KEY, ziel.ws)
    } catch {
      /* Ohne Speicher wird eben nach dem Laden umgeschaltet. */
    }
  }
  return { ziel, vorher }
}

/** Gibt das Sprungziel zurueck, damit die Anwendung gleich zur Anmeldung gehen kann. */
export function useSprungziel(): Sprungziel | null {
  const [{ ziel, vorher }] = useState(vormerken)
  const session = useStore((s) => s.session)
  const profile = useStore((s) => s.profile)
  const workspaces = useStore((s) => s.workspaces)
  const current = useStore((s) => s.currentWorkspaceId)
  const loading = useStore((s) => s.loadingWorkspace)
  const locations = useStore((s) => s.locations)
  const routes = useStore((s) => s.routes)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const notify = useStore((s) => s.notify)

  const erledigt = useRef(false)
  const sahLaden = useRef(false)

  useEffect(() => {
    if (loading) sahLaden.current = true
  }, [loading])

  useEffect(() => {
    if (!ziel || erledigt.current || !session || !profile) return

    const fertig = (fehler?: string) => {
      erledigt.current = true
      window.history.replaceState(null, '', ohneSprungziel(window.location.href))
      if (fehler) notify('error', fehler)
    }

    if (!workspaces.some((w) => w.id === ziel.ws)) {
      // Ein fremder Link darf nicht still den eigenen Lieblingsbereich ersetzen.
      try {
        if (localStorage.getItem(LAST_WORKSPACE_KEY) === ziel.ws) {
          if (vorher) localStorage.setItem(LAST_WORKSPACE_KEY, vorher)
          else localStorage.removeItem(LAST_WORKSPACE_KEY)
        }
      } catch {
        /* nichts zu retten */
      }
      fertig('Dieser Link führt in einen Arbeitsbereich, in dem du nicht Mitglied bist.')
      return
    }
    if (current !== ziel.ws) {
      void selectWorkspace(ziel.ws)
      return
    }
    if (loading || !sahLaden.current) return

    const ui = useUi.getState()
    if (ziel.art === 'standort') {
      const ort = locations.find((l) => l.id === ziel.id)
      if (!ort) {
        fertig('Diesen Standort gibt es nicht mehr, oder du darfst ihn nicht sehen.')
        return
      }
      ui.setTab('locations')
      ui.selectLocation(ort.id)
      // Auf dem Telefon verdeckt die Seitenleiste die Karte - gezeigt werden
      // soll aber der Ort.
      if (window.matchMedia(SCHMAL).matches) ui.setSidebarOpen(false)
      ui.focusPoint({ lat: ort.lat, lng: ort.lng }, SPRUNG_ZOOM)
    } else {
      if (!routes.some((r) => r.id === ziel.id)) {
        fertig('Diese Tour gibt es nicht mehr, oder du darfst sie nicht sehen.')
        return
      }
      ui.setTab('routes')
      ui.setSidebarOpen(true)
      ui.setActiveRoute(ziel.id)
    }
    fertig()
  }, [ziel, vorher, session, profile, workspaces, current, loading, locations, routes, selectWorkspace, notify])

  return ziel
}
