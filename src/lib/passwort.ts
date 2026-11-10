/**
 * Passwoerter, die ein Administrator fuer jemand anderen vergibt.
 *
 * Sie werden vorgelesen, abgetippt oder per Nachricht weitergegeben. Deshalb
 * fehlen Zeichen, die man leicht verwechselt (0/O, 1/l/I), und Sonderzeichen,
 * die auf Handytastaturen erst gesucht werden muessen. 12 Zeichen aus 55
 * ergeben rund 69 Bit - genug fuer ein Passwort, das ohnehin bald geaendert
 * werden sollte.
 */
export const PASSWORT_ZEICHEN = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function erzeugePasswort(laenge = 12): string {
  const n = PASSWORT_ZEICHEN.length
  // Verworfen wird, was ueber dem letzten vollen Vielfachen liegt; sonst kaemen
  // die ersten Zeichen des Alphabets etwas haeufiger vor als die letzten.
  const grenze = 256 - (256 % n)
  const zeichen: string[] = []
  const puffer = new Uint8Array(laenge * 2)
  while (zeichen.length < laenge) {
    crypto.getRandomValues(puffer)
    for (const b of puffer) {
      if (b >= grenze) continue
      zeichen.push(PASSWORT_ZEICHEN[b % n] as string)
      if (zeichen.length === laenge) break
    }
  }
  return zeichen.join('')
}
