import { describe, expect, it } from 'vitest'
import { reichweiteAusText, reichweitenUrteil, reichweiteText } from './reichweite'

describe('reichweiteAusText - echte HWP-Namen', () => {
  const faelle: [string, number | null, number | null][] = [
    ['Karl Rabofsky -KN ja- Alu ja - 75 min. / 100km', 100, 75],
    ['Bosold -KN ja- Alu ja - max. 100km', 100, null],
    ['HaMu -KN ja- 200km', 200, null],
    ['HaMu Saarland - KN ja - 100 Km', 100, null],
    ['Cordts -KN nein- max.60 min.', null, 60],
    ['Schmidt -KN ja- 60 min. / 150 Km', 150, 60],
    ['Sanders & Pietsch 130km/90min ACH und ACV 2 Tage', 130, 90],
    ['Arslan 95 min / 130 km ACH und ACV 2 Tage', 130, 95],
    ['Pahl  100 min. / 170km ACH und ACV 1 Tag', 170, 100],
    ['Bekir -KN Nein- max 60 min. / 100 km / max. bis Hamburg', 100, 60],
    ['Celik -KN ja- Alu ja -70 min. / 95km - 2 Tage ACV/ACM', 95, 70],
    ['Celik Darmstadt - 70 KM - KN ja - 2 Tage ACV/ACM', 70, null],
    ['Deine Sonne -KN nein- 75min/100km -  - 1 Tag ACV/ACM', 100, 75],
    ['WFN Schmidt Nürnberg -KN ja- 60min/100km', 100, 60],
    ['Hamu SN02 /100km', 100, null],
    ['Caliskan 150 km', 150, null],
    ['ETP-Jannik Petersen KN:NEIN 75 min. / 100km', 100, 75],
  ]
  for (const [name, km, minuten] of faelle) {
    it(name, () => expect(reichweiteAusText(name)).toEqual({ km, minuten }))
  }

  it('erfindet nichts, wo keine Angabe steht', () => {
    for (const name of ['Bisol GmbH - Team Hof SN 05', 'Dammer SN01', 'E-Sanierung Sanders&Pietsch SN 02']) {
      expect(reichweiteAusText(name)).toEqual({ km: null, minuten: null })
    }
  })

  it('verwechselt Tage nicht mit Minuten', () => {
    expect(reichweiteAusText('2 Tage ACV/ACM').minuten).toBeNull()
  })
})

describe('reichweitenUrteil', () => {
  const r = { km: 100, minuten: 75 }

  it('sagt nichts ohne Reichweite', () => {
    expect(reichweitenUrteil({ km: null, minuten: null }, 3600, 90000)).toBeNull()
  })

  it('ist drin, wenn beide Grenzen halten', () => {
    expect(reichweitenUrteil(r, 70 * 60, 95_000)?.status).toBe('drin')
  })

  it('ist draussen, sobald eine Grenze reisst - auch wenn die andere passt', () => {
    const u = reichweitenUrteil(r, 90 * 60, 80_000)
    expect(u?.status).toBe('draussen')
    expect(u?.text).toContain('max. 75 Min.')
    expect(reichweitenUrteil(r, 60 * 60, 132_000)?.text).toContain('132,0 km statt max. 100 km')
  })

  it('bleibt offen, solange eine angegebene Grenze nicht pruefbar ist', () => {
    expect(reichweitenUrteil(r, null, null)?.status).toBe('offen')
    expect(reichweitenUrteil({ km: 100, minuten: null }, 3600, null)?.status).toBe('offen')
  })

  it('urteilt schon ohne Strecke draussen, wenn die Zeit allein reisst', () => {
    expect(reichweitenUrteil(r, 120 * 60, null)?.status).toBe('draussen')
  })

  it('beschriftet in der Reihenfolge, in der eure Namen es tun', () => {
    expect(reichweiteText(r)).toBe('75 Min. / 100 km')
  })
})
