/**
 * Die Angaben, die nur der Betreiber kennt.
 *
 * Sie stehen hier und nicht verstreut im Text, damit vor dem oeffentlichen
 * Start EINE Datei durchzugehen ist. Solange hier Platzhalter stehen, darf
 * die Seite nicht oeffentlich beworben werden - die Startseite zeigt dann
 * sichtbare Hinweise statt stiller Luecken.
 */

export interface Angaben {
  /**
   * Wer die Anwendung betreibt. Muss mit dem Impressum uebereinstimmen.
   * Leer heisst: noch nicht festgelegt.
   */
  betreiber: string
  /** Adresse fuer Rueckfragen. Leer heisst: noch keine. */
  kontakt: string
  /**
   * Was die Nutzung kostet - ein Satz, keine Preistabelle.
   * Leer heisst: noch nicht entschieden, die Seite sagt das dann auch.
   */
  preis: string
  /**
   * Steht die Registrierung offen?
   *
   * ACHTUNG, bewusst auf false: im Supabase-Projekt ist die
   * E-Mail-Bestaetigung aktiv (mailer_autoconfirm = false), der eingebaute
   * Mailversand des Free Tiers stellt die Bestaetigungsmail aber in aller
   * Regel nicht zu. Wer sich heute registriert, kommt nicht hinein. Erst
   * umstellen, wenn dieser Weg nachweislich durchlaeuft - sonst schickt die
   * Startseite Leute in eine Sackgasse.
   */
  registrierungOffen: boolean
  /** Quelltext. Leer blendet den Verweis aus. */
  quelltext: string
}

export const ANGABEN: Angaben = {
  betreiber: '',
  kontakt: '',
  preis: '',
  registrierungOffen: false,
  quelltext: 'https://github.com/phish3144/mapper',
}

/** Was vor dem oeffentlichen Start noch fehlt - fuer den Hinweis auf der Seite. */
export function offenePunkte(a: Angaben = ANGABEN): string[] {
  const fehlt: string[] = []
  if (!a.betreiber.trim()) fehlt.push('Betreiber im Impressum')
  if (!a.kontakt.trim()) fehlt.push('Kontaktadresse')
  if (!a.preis.trim()) fehlt.push('Angabe zu den Kosten')
  if (!a.registrierungOffen) fehlt.push('funktionierende Registrierung')
  return fehlt
}
