/**
 * Gemeinsame Einstellungen fuer die Sprechblasen der Karte.
 *
 * Am Telefon breiter, damit die Knoepfe nebeneinander passen statt
 * untereinander zu stapeln, und mit Abstand zu den Kartenknoepfen rechts
 * oben und zur Team-Leiste unten: Leaflet schiebt die Karte beim Oeffnen so,
 * dass die Sprechblase diesen Rand frei laesst.
 */
import type { PopupOptions } from 'leaflet'
import { istSchmal } from '@/lib/uiStore'

export function popupOptionen(): PopupOptions {
  if (!istSchmal()) return { minWidth: 180, maxWidth: 320 }
  const breite = Math.min(320, window.innerWidth - 80)
  return {
    minWidth: breite,
    maxWidth: breite,
    autoPanPaddingTopLeft: [12, 12],
    // Rechts die runden Kartenknoepfe, unten die Team-Leiste.
    autoPanPaddingBottomRight: [64, 76],
  }
}
