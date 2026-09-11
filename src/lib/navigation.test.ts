import { describe, expect, it } from 'vitest'
import { navigationUrl } from './navigation'

const HANNOVER = { lat: 52.3759, lng: 9.732 }
const BERLIN = { lat: 52.52, lng: 13.405 }

describe('navigationUrl', () => {
  it('baut eine Google-Maps-Adresse mit Start, Ziel und Fahrprofil', () => {
    const url = new URL(navigationUrl(HANNOVER, BERLIN))
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/')
    expect(url.searchParams.get('api')).toBe('1')
    expect(url.searchParams.get('origin')).toBe('52.375900,9.732000')
    expect(url.searchParams.get('destination')).toBe('52.520000,13.405000')
    expect(url.searchParams.get('travelmode')).toBe('driving')
  })

  it('uebergibt reine Koordinaten', () => {
    // Ein Standortname wie "Bisol GmbH - Team Hannover" ist keine Adresse und
    // wuerde dort neu und womoeglich falsch gesucht. Start und Ziel duerfen
    // deshalb nichts als Zahlen enthalten.
    const url = new URL(navigationUrl(HANNOVER, BERLIN))
    for (const feld of ['origin', 'destination']) {
      expect(url.searchParams.get(feld)).toMatch(/^-?\d+\.\d{6},-?\d+\.\d{6}$/)
    }
  })

  it('haelt die Reihenfolge ein - Start ist Start', () => {
    const hin = new URL(navigationUrl(HANNOVER, BERLIN))
    const zurueck = new URL(navigationUrl(BERLIN, HANNOVER))
    expect(hin.searchParams.get('origin')).toBe(zurueck.searchParams.get('destination'))
    expect(hin.searchParams.get('destination')).toBe(zurueck.searchParams.get('origin'))
  })

  it('rundet auf sechs Stellen - mehr ist bei einer Adresse Schein', () => {
    const url = new URL(navigationUrl({ lat: 52.1234567891, lng: 9.9876543219 }, BERLIN))
    expect(url.searchParams.get('origin')).toBe('52.123457,9.987654')
  })
})
