/**
 * Teilbare Verweise in die Anwendung: `?ws=…&standort=…` oder `?ws=…&tour=…`.
 *
 * Der Arbeitsbereich steht mit drin, weil eine Kennung allein nicht sagt, in
 * welchem Bestand sie liegt - geladen ist immer nur einer. Wer den Verweis
 * oeffnet, landet nach der Anmeldung direkt an der Stelle; wer keinen Zugriff
 * hat, bekommt das gesagt und keinen fremden Datensatz.
 */
export type SprungArt = 'standort' | 'tour'

export interface Sprungziel {
  ws: string
  art: SprungArt
  id: string
}

/** Kennungen sind UUIDs. Alles andere ist kein Verweis von uns. */
const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function leseSprungziel(search: string): Sprungziel | null {
  const p = new URLSearchParams(search)
  const ws = p.get('ws') ?? ''
  if (!KENNUNG.test(ws)) return null
  const standort = p.get('standort')
  if (standort && KENNUNG.test(standort)) return { ws, art: 'standort', id: standort }
  const tour = p.get('tour')
  if (tour && KENNUNG.test(tour)) return { ws, art: 'tour', id: tour }
  return null
}

/** `basis` ist die Adresse der Anwendung, etwa https://mapper.sanctora.eu/. */
export function sprungLink(basis: string, ziel: Sprungziel): string {
  const url = new URL(basis)
  url.search = ''
  url.hash = ''
  url.searchParams.set('ws', ziel.ws)
  url.searchParams.set(ziel.art, ziel.id)
  return url.toString()
}

/** Die Adresse ohne Sprungziel - nach dem Springen, damit Neuladen nicht erneut springt. */
export function ohneSprungziel(href: string): string {
  const url = new URL(href)
  for (const k of ['ws', 'standort', 'tour']) url.searchParams.delete(k)
  return url.toString()
}

/** Die Adresse der laufenden Anwendung, samt Unterpfad (GitHub Pages). */
export function appBasis(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString()
}
