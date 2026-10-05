/**
 * Text in die Zwischenablage.
 *
 * Die moderne Schnittstelle gibt es nur in sicheren Kontexten und nach einer
 * Nutzergeste; ein Firmenbrowser kann sie zusaetzlich sperren. Dann bleibt der
 * alte Weg ueber ein unsichtbares Textfeld. Gelingt keiner, sagt das Ergebnis
 * es - der Aufrufer meldet dann einen Fehler statt eines falschen "Kopiert".
 */
export async function inZwischenablage(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Weiter mit dem alten Weg.
  }
  try {
    const feld = document.createElement('textarea')
    feld.value = text
    feld.setAttribute('readonly', '')
    feld.style.position = 'fixed'
    feld.style.opacity = '0'
    document.body.appendChild(feld)
    feld.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(feld)
    return ok
  } catch {
    return false
  }
}
