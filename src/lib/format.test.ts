import { describe, expect, it } from 'vitest'
import type { TimeWindow } from '@/types/domain'
import {
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
  formatDateShort,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatMinutes,
  formatRelativeTime,
  formatTime,
  formatTimeWindows,
  minutesToTime,
  parseTimeToMinutes,
  pluralize,
} from './format'

/** Ortszeit-Konstruktor: die Erwartungen bleiben so von der Zeitzone unabhaengig. */
function at(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function tw(dow: number, from: string, to: string): TimeWindow {
  return { dow, from, to }
}

describe('formatDuration', () => {
  it('gibt Stunden und Minuten aus', () => {
    expect(formatDuration(3900)).toBe('1 Std. 5 Min.')
    expect(formatDuration(2700)).toBe('45 Min.')
    expect(formatDuration(7200)).toBe('2 Std.')
  })

  it('behandelt angebrochene Minuten', () => {
    expect(formatDuration(1)).toBe('< 1 Min.')
    expect(formatDuration(59)).toBe('< 1 Min.')
    expect(formatDuration(60)).toBe('1 Min.')
    expect(formatDuration(89)).toBe('1 Min.')
    expect(formatDuration(90)).toBe('2 Min.')
  })

  it('faengt 0, negative und ungueltige Werte ab', () => {
    expect(formatDuration(0)).toBe('0 Min.')
    expect(formatDuration(-1)).toBe('0 Min.')
    expect(formatDuration(-99999)).toBe('0 Min.')
    expect(formatDuration(Number.NaN)).toBe('0 Min.')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0 Min.')
  })

  it('gruppiert sehr grosse Werte', () => {
    expect(formatDuration(359999)).toBe('100 Std.')
    expect(formatDuration(3600000)).toBe('1.000 Std.')
    expect(formatDuration(86400)).toBe('24 Std.')
  })
})

describe('formatMinutes', () => {
  it('formatiert Minutenwerte', () => {
    expect(formatMinutes(20)).toBe('20 Min.')
    expect(formatMinutes(59)).toBe('59 Min.')
    expect(formatMinutes(60)).toBe('1 Std.')
    expect(formatMinutes(90)).toBe('1 Std. 30 Min.')
    expect(formatMinutes(1439)).toBe('23 Std. 59 Min.')
  })

  it('rundet und faengt Randwerte ab', () => {
    expect(formatMinutes(0)).toBe('0 Min.')
    expect(formatMinutes(-30)).toBe('0 Min.')
    expect(formatMinutes(0.4)).toBe('0 Min.')
    expect(formatMinutes(20.6)).toBe('21 Min.')
    expect(formatMinutes(Number.NaN)).toBe('0 Min.')
  })
})

describe('formatDistance', () => {
  it('bleibt unter 1 km bei Metern', () => {
    expect(formatDistance(850)).toBe('850 m')
    expect(formatDistance(850.4)).toBe('850 m')
    expect(formatDistance(1)).toBe('1 m')
    expect(formatDistance(999)).toBe('999 m')
  })

  it('wechselt ab 1000 m zu Kilometern mit Komma', () => {
    expect(formatDistance(999.6)).toBe('1,0 km')
    expect(formatDistance(1000)).toBe('1,0 km')
    expect(formatDistance(12400)).toBe('12,4 km')
    expect(formatDistance(12449)).toBe('12,4 km')
    expect(formatDistance(1234567)).toBe('1.234,6 km')
  })

  it('faengt 0, negative und ungueltige Werte ab', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(-500)).toBe('0 m')
    expect(formatDistance(Number.NaN)).toBe('0 m')
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('0 m')
  })
})

describe('formatTime', () => {
  it('formatiert Uhrzeiten zweistellig', () => {
    expect(formatTime(at(2026, 3, 16, 8, 30))).toBe('08:30')
    expect(formatTime(at(2026, 3, 16, 23, 59))).toBe('23:59')
  })

  it('behandelt Mitternacht', () => {
    expect(formatTime(at(2026, 3, 16, 0, 0))).toBe('00:00')
    expect(formatTime(at(2026, 3, 17, 0, 5))).toBe('00:05')
  })

  it('gibt fuer null und ungueltige Daten einen Strich aus', () => {
    expect(formatTime(null)).toBe('–')
    expect(formatTime(new Date(Number.NaN))).toBe('–')
  })
})

describe('formatDateShort', () => {
  it('formatiert Tag, Monat und Jahr', () => {
    expect(formatDateShort(at(2026, 3, 16))).toBe('16.03.2026')
    expect(formatDateShort(at(2026, 1, 1, 23, 59))).toBe('01.01.2026')
    expect(formatDateShort(at(2026, 12, 31))).toBe('31.12.2026')
  })

  it('gibt fuer null einen Strich aus', () => {
    expect(formatDateShort(null)).toBe('–')
    expect(formatDateShort(new Date(Number.NaN))).toBe('–')
  })
})

describe('formatDateTime', () => {
  it('stellt den abgekuerzten Wochentag voran', () => {
    expect(formatDateTime(at(2026, 3, 16, 8, 30))).toBe('Mo., 16.03.2026, 08:30')
    expect(formatDateTime(at(2026, 3, 21, 9, 0))).toBe('Sa., 21.03.2026, 09:00')
    expect(formatDateTime(at(2026, 3, 22, 0, 0))).toBe('So., 22.03.2026, 00:00')
  })

  it('gibt fuer null einen Strich aus', () => {
    expect(formatDateTime(null)).toBe('–')
  })
})

describe('parseTimeToMinutes', () => {
  it('liest gueltige Uhrzeiten', () => {
    expect(parseTimeToMinutes('08:30')).toBe(510)
    expect(parseTimeToMinutes('00:00')).toBe(0)
    expect(parseTimeToMinutes('23:59')).toBe(1439)
    expect(parseTimeToMinutes('8:30')).toBe(510)
    expect(parseTimeToMinutes('  08:30  ')).toBe(510)
    expect(parseTimeToMinutes('08:30:00')).toBe(510)
  })

  it('weist ungueltige Eingaben zurueck', () => {
    expect(parseTimeToMinutes('24:00')).toBeNull()
    expect(parseTimeToMinutes('12:60')).toBeNull()
    expect(parseTimeToMinutes('99:99')).toBeNull()
    expect(parseTimeToMinutes('8:3')).toBeNull()
    expect(parseTimeToMinutes('0830')).toBeNull()
    expect(parseTimeToMinutes('-1:00')).toBeNull()
    expect(parseTimeToMinutes('ab 8')).toBeNull()
    expect(parseTimeToMinutes('')).toBeNull()
    expect(parseTimeToMinutes('   ')).toBeNull()
  })
})

describe('minutesToTime', () => {
  it('formatiert Minuten seit Mitternacht', () => {
    expect(minutesToTime(510)).toBe('08:30')
    expect(minutesToTime(0)).toBe('00:00')
    expect(minutesToTime(1439)).toBe('23:59')
  })

  it('normalisiert ueber 24 h hinaus und rueckwaerts', () => {
    expect(minutesToTime(1440)).toBe('00:00')
    expect(minutesToTime(1500)).toBe('01:00')
    expect(minutesToTime(4410)).toBe('01:30')
    expect(minutesToTime(-1)).toBe('23:59')
    expect(minutesToTime(-60)).toBe('23:00')
    expect(minutesToTime(-1440)).toBe('00:00')
  })

  it('rundet und faengt ungueltige Werte ab', () => {
    expect(minutesToTime(510.4)).toBe('08:30')
    expect(minutesToTime(Number.NaN)).toBe('00:00')
    expect(minutesToTime(Number.POSITIVE_INFINITY)).toBe('00:00')
  })

  it('ist zu parseTimeToMinutes umkehrbar', () => {
    for (const value of [0, 1, 59, 60, 510, 1000, 1439]) {
      expect(parseTimeToMinutes(minutesToTime(value))).toBe(value)
    }
  })
})

describe('Wochentagsnamen', () => {
  it('beginnt bei Montag und deckt ISO 1..7 ab', () => {
    expect(WEEKDAYS_SHORT).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])
    expect(WEEKDAYS_LONG[0]).toBe('Montag')
    expect(WEEKDAYS_LONG[6]).toBe('Sonntag')
    expect(WEEKDAYS_LONG).toHaveLength(7)
    expect(WEEKDAYS_SHORT).toHaveLength(7)
  })
})

describe('formatTimeWindows', () => {
  it('meldet fehlende Fenster als jederzeit', () => {
    expect(formatTimeWindows([])).toBe('jederzeit')
  })

  it('fasst gleiche Zeiten an aufeinanderfolgenden Tagen zusammen', () => {
    const windows = [
      tw(1, '08:00', '17:00'),
      tw(2, '08:00', '17:00'),
      tw(3, '08:00', '17:00'),
      tw(4, '08:00', '17:00'),
      tw(5, '08:00', '17:00'),
      tw(6, '09:00', '13:00'),
    ]
    expect(formatTimeWindows(windows)).toBe('Mo–Fr 08:00–17:00, Sa 09:00–13:00')
  })

  it('fasst auch zwei benachbarte Tage zusammen und bricht die Woche nicht um', () => {
    expect(formatTimeWindows([tw(6, '09:00', '13:00'), tw(7, '09:00', '13:00')]))
      .toBe('Sa–So 09:00–13:00')
    // Sonntag und Montag sind keine Folge - der Sonntag bleibt am Ende stehen.
    expect(formatTimeWindows([tw(7, '10:00', '12:00'), tw(1, '10:00', '12:00')]))
      .toBe('Mo 10:00–12:00, So 10:00–12:00')
    expect(formatTimeWindows([tw(7, '10:00', '14:00')])).toBe('So 10:00–14:00')
  })

  it('laesst nicht zusammenhaengende Tage einzeln stehen', () => {
    const windows = [tw(1, '08:00', '17:00'), tw(3, '08:00', '17:00'), tw(5, '08:00', '17:00')]
    expect(formatTimeWindows(windows)).toBe(
      'Mo 08:00–17:00, Mi 08:00–17:00, Fr 08:00–17:00',
    )
  })

  it('trennt benachbarte Tage mit abweichenden Zeiten', () => {
    const windows = [tw(1, '08:00', '17:00'), tw(2, '09:00', '17:00'), tw(3, '08:00', '17:00')]
    expect(formatTimeWindows(windows)).toBe(
      'Mo 08:00–17:00, Di 09:00–17:00, Mi 08:00–17:00',
    )
  })

  it('verbindet mehrere Fenster eines Tages', () => {
    const windows = [
      tw(1, '13:00', '17:00'),
      tw(1, '08:00', '12:00'),
      tw(2, '08:00', '12:00'),
      tw(2, '13:00', '17:00'),
    ]
    expect(formatTimeWindows(windows)).toBe('Mo–Di 08:00–12:00 u. 13:00–17:00')
  })

  it('sortiert, normalisiert und entdoppelt die Eingabe', () => {
    const windows = [
      tw(5, '8:00', '17:00'),
      tw(1, '08:00', '17:00'),
      tw(1, '08:00', '17:00'),
    ]
    expect(formatTimeWindows(windows)).toBe('Mo 08:00–17:00, Fr 08:00–17:00')
  })

  it('uebergeht Fenster mit unmoeglichem Wochentag', () => {
    const windows = [tw(0, '08:00', '17:00'), tw(8, '08:00', '17:00'), tw(2, '08:00', '17:00')]
    expect(formatTimeWindows(windows)).toBe('Di 08:00–17:00')
    expect(formatTimeWindows([tw(0, '08:00', '17:00')])).toBe('jederzeit')
  })

  it('deckt die ganze Woche mit einem Bereich ab', () => {
    const windows = [1, 2, 3, 4, 5, 6, 7].map((dow) => tw(dow, '00:00', '23:59'))
    expect(formatTimeWindows(windows)).toBe('Mo–So 00:00–23:59')
  })

  it('behaelt Fenster ueber Mitternacht bei', () => {
    expect(formatTimeWindows([tw(5, '22:00', '02:00')])).toBe('Fr 22:00–02:00')
  })

  it('bildet mehrere getrennte Bereiche', () => {
    const windows = [1, 2, 4, 5].map((dow) => tw(dow, '08:00', '17:00'))
    expect(formatTimeWindows(windows)).toBe('Mo–Di 08:00–17:00, Do–Fr 08:00–17:00')
  })

  it('uebergeht Fenster ohne verwertbare Uhrzeiten', () => {
    // time_windows ist JSONB - fehlende Felder duerfen nicht als "undefined" durchschlagen.
    const broken = { dow: 1, from: undefined, to: '17:00' } as unknown as TimeWindow
    expect(formatTimeWindows([broken, tw(2, '08:00', '17:00')])).toBe('Di 08:00–17:00')
    expect(formatTimeWindows([broken])).toBe('jederzeit')
    expect(formatTimeWindows([tw(1, '', '')])).toBe('jederzeit')
  })
})

describe('pluralize', () => {
  it('waehlt Singular nur bei genau eins', () => {
    expect(pluralize(1, 'Standort', 'Standorte')).toBe('1 Standort')
    expect(pluralize(3, 'Standort', 'Standorte')).toBe('3 Standorte')
    expect(pluralize(0, 'Standort', 'Standorte')).toBe('0 Standorte')
    expect(pluralize(-1, 'Route', 'Routen')).toBe('-1 Routen')
  })

  it('gruppiert grosse Zahlen deutsch', () => {
    expect(pluralize(1000, 'Stopp', 'Stopps')).toBe('1.000 Stopps')
    expect(pluralize(1234567, 'Stopp', 'Stopps')).toBe('1.234.567 Stopps')
  })

  it('faengt gebrochene und ungueltige Zahlen ab', () => {
    expect(pluralize(1.5, 'Stunde', 'Stunden')).toBe('1,5 Stunden')
    expect(pluralize(Number.NaN, 'Stopp', 'Stopps')).toBe('0 Stopps')
    // Rundung auf Null darf kein Minuszeichen stehen lassen.
    expect(pluralize(-0.04, 'Stunde', 'Stunden')).toBe('0,0 Stunden')
  })

  it('verstuemmelt Zahlen jenseits der Exponentialschwelle nicht', () => {
    expect(pluralize(1e21, 'Stopp', 'Stopps')).toBe('1e+21 Stopps')
  })
})

describe('formatRelativeTime', () => {
  const now = at(2026, 3, 16, 12, 0)
  const minusSeconds = (seconds: number) => new Date(now.getTime() - seconds * 1000)

  it('meldet sehr kurze Abstaende als gerade eben', () => {
    expect(formatRelativeTime(now, now)).toBe('gerade eben')
    expect(formatRelativeTime(minusSeconds(10), now)).toBe('gerade eben')
    expect(formatRelativeTime(minusSeconds(44), now)).toBe('gerade eben')
    expect(formatRelativeTime(minusSeconds(-30), now)).toBe('gerade eben')
  })

  it('zaehlt Minuten, Stunden und Tage in der Vergangenheit', () => {
    expect(formatRelativeTime(minusSeconds(45), now)).toBe('vor 1 Minute')
    expect(formatRelativeTime(minusSeconds(300), now)).toBe('vor 5 Minuten')
    expect(formatRelativeTime(minusSeconds(3599), now)).toBe('vor 59 Minuten')
    expect(formatRelativeTime(minusSeconds(3600), now)).toBe('vor 1 Stunde')
    expect(formatRelativeTime(minusSeconds(7200), now)).toBe('vor 2 Stunden')
    expect(formatRelativeTime(minusSeconds(86400), now)).toBe('vor 1 Tag')
    expect(formatRelativeTime(minusSeconds(2 * 86400), now)).toBe('vor 2 Tagen')
  })

  it('geht bei groesseren Abstaenden zu Wochen, Monaten und Jahren ueber', () => {
    expect(formatRelativeTime(minusSeconds(7 * 86400), now)).toBe('vor 1 Woche')
    expect(formatRelativeTime(minusSeconds(21 * 86400), now)).toBe('vor 3 Wochen')
    expect(formatRelativeTime(minusSeconds(60 * 86400), now)).toBe('vor 2 Monaten')
    expect(formatRelativeTime(minusSeconds(400 * 86400), now)).toBe('vor 1 Jahr')
    expect(formatRelativeTime(minusSeconds(1000 * 86400), now)).toBe('vor 2 Jahren')
  })

  it('formuliert die Zukunft mit in', () => {
    expect(formatRelativeTime(minusSeconds(-300), now)).toBe('in 5 Minuten')
    expect(formatRelativeTime(minusSeconds(-3600), now)).toBe('in 1 Stunde')
    expect(formatRelativeTime(minusSeconds(-2 * 86400), now)).toBe('in 2 Tagen')
  })

  it('gibt fuer ungueltige Daten einen Strich aus', () => {
    expect(formatRelativeTime(new Date(Number.NaN), now)).toBe('–')
    expect(formatRelativeTime(now, new Date(Number.NaN))).toBe('–')
    expect(formatRelativeTime(null, now)).toBe('–')
    expect(formatRelativeTime(now, null)).toBe('–')
  })
})
