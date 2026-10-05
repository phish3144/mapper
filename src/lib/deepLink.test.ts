import { describe, expect, it } from 'vitest'
import { leseSprungziel, ohneSprungziel, sprungLink } from './deepLink'

const WS = '552fd605-4bcf-4667-885f-e36da067f309'
const ID = '9fa5d20c-8298-4256-a8a9-8375e29db803'

describe('Sprungziele', () => {
  it('liest Standort und Tour', () => {
    expect(leseSprungziel(`?ws=${WS}&standort=${ID}`)).toEqual({ ws: WS, art: 'standort', id: ID })
    expect(leseSprungziel(`?ws=${WS}&tour=${ID}`)).toEqual({ ws: WS, art: 'tour', id: ID })
  })

  it('verlangt den Arbeitsbereich und echte Kennungen', () => {
    expect(leseSprungziel(`?standort=${ID}`)).toBeNull()
    expect(leseSprungziel(`?ws=${WS}&standort=abc`)).toBeNull()
    expect(leseSprungziel(`?ws=x&standort=${ID}`)).toBeNull()
    expect(leseSprungziel('')).toBeNull()
  })

  it('ignoriert die Parameter eines Anmeldelinks', () => {
    expect(leseSprungziel('?code=abc123')).toBeNull()
  })

  it('baut einen Verweis, der sich wieder lesen laesst', () => {
    const link = sprungLink('https://mapper.sanctora.eu/?alt=1#x', { ws: WS, art: 'tour', id: ID })
    expect(link).toBe(`https://mapper.sanctora.eu/?ws=${WS}&tour=${ID}`)
    expect(leseSprungziel(new URL(link).search)).toEqual({ ws: WS, art: 'tour', id: ID })
  })

  it('behaelt den Unterpfad der Pages-Ausgabe', () => {
    const link = sprungLink('https://phish3144.github.io/mapper/', { ws: WS, art: 'standort', id: ID })
    expect(link.startsWith('https://phish3144.github.io/mapper/?ws=')).toBe(true)
  })

  it('entfernt nur das Sprungziel', () => {
    expect(ohneSprungziel(`https://mapper.sanctora.eu/?ws=${WS}&standort=${ID}&x=1`)).toBe(
      'https://mapper.sanctora.eu/?x=1',
    )
  })
})
