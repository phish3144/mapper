import { describe, expect, it } from 'vitest'
import { PASSWORT_ZEICHEN, erzeugePasswort } from './passwort'

describe('erzeugePasswort', () => {
  it('liefert die gewuenschte Laenge, voreingestellt 12', () => {
    expect(erzeugePasswort()).toHaveLength(12)
    expect(erzeugePasswort(20)).toHaveLength(20)
  })

  it('nimmt nur Zeichen, die man nicht verwechselt', () => {
    const viele = Array.from({ length: 200 }, () => erzeugePasswort()).join('')
    for (const z of viele) expect(PASSWORT_ZEICHEN).toContain(z)
    expect(viele).not.toMatch(/[0O1lI]/)
  })

  it('wiederholt sich nicht', () => {
    const satz = new Set(Array.from({ length: 500 }, () => erzeugePasswort()))
    expect(satz.size).toBe(500)
  })
})
