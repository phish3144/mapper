import { useMemo, useState } from 'react'
import {
  MAP_SYMBOLS,
  SYMBOL_GROUPS,
  findSymbol,
  searchSymbols,
  symbolEmoji,
  symbolLabel,
  type MapSymbol,
  type SymbolGroup,
} from '@/lib/symbols'

export interface SymbolPickerProps {
  value: string | null
  onChange: (id: string | null) => void
  /**
   * Wenn gesetzt, gibt es zusaetzlich die Wahl "erben" (Wert null) - so kann
   * ein Standort das Symbol seiner Kategorie uebernehmen, statt ein eigenes
   * zu fuehren.
   */
  inherit?: { label: string; emoji: string }
  label?: string
}

/**
 * Auswahl eines Kartensymbols. Die Liste ist lang genug, dass eine Suche
 * noetig ist; ohne Suchbegriff bleibt sie nach Themen gruppiert, weil man ein
 * Symbol meist eher wiedererkennt als benennt.
 */
export default function SymbolPicker({ value, onChange, inherit, label = 'Symbol' }: SymbolPickerProps) {
  const [query, setQuery] = useState('')

  const treffer = useMemo(() => searchSymbols(query), [query])
  const gruppiert = useMemo(() => {
    const map = new Map<SymbolGroup, MapSymbol[]>()
    for (const s of treffer) {
      const liste = map.get(s.group)
      if (liste) liste.push(s)
      else map.set(s.group, [s])
    }
    return map
  }, [treffer])

  const gewaehlt = findSymbol(value)
  const suchend = query.trim() !== ''

  return (
    <div className="field">
      <label>{label}</label>

      <div className="symbol-current">
        <span className="symbol-current-emoji" aria-hidden="true">
          {value === null && inherit ? inherit.emoji : symbolEmoji(value)}
        </span>
        <span className="grow truncate">
          {value === null && inherit ? inherit.label : (gewaehlt?.label ?? symbolLabel(value))}
        </span>
        <input
          className="input"
          style={{ maxWidth: 170 }}
          type="search"
          value={query}
          placeholder="Symbol suchen …"
          aria-label="Symbol suchen"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {inherit && (
        <button
          type="button"
          className={`chip ${value === null ? 'is-on' : ''}`}
          style={{ marginBottom: 8 }}
          aria-pressed={value === null}
          onClick={() => onChange(null)}
        >
          <span aria-hidden="true">{inherit.emoji}</span>
          {inherit.label}
        </button>
      )}

      <div className="symbol-groups">
        {treffer.length === 0 ? (
          <div className="empty" style={{ padding: '14px 0' }}>
            Kein Symbol passt zu „{query}".
          </div>
        ) : suchend ? (
          <div className="symbol-grid">
            {treffer.map((s) => (
              <SymbolButton key={s.id} symbol={s} active={s.id === value} onChange={onChange} />
            ))}
          </div>
        ) : (
          SYMBOL_GROUPS.map((gruppe) => {
            const liste = gruppiert.get(gruppe)
            if (!liste || liste.length === 0) return null
            return (
              <div key={gruppe}>
                <div className="symbol-group-title">{gruppe}</div>
                <div className="symbol-grid">
                  {liste.map((s) => (
                    <SymbolButton key={s.id} symbol={s} active={s.id === value} onChange={onChange} />
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
      <span className="field-hint">
        {MAP_SYMBOLS.length} Symbole. Das gewaehlte erscheint in der Nadel auf der Karte.
      </span>
    </div>
  )
}

function SymbolButton({
  symbol,
  active,
  onChange,
}: {
  symbol: MapSymbol
  active: boolean
  onChange: (id: string) => void
}) {
  return (
    <button
      type="button"
      className={`symbol-btn ${active ? 'is-on' : ''}`}
      title={symbol.label}
      aria-label={symbol.label}
      aria-pressed={active}
      onClick={() => onChange(symbol.id)}
    >
      <span aria-hidden="true">{symbol.emoji}</span>
    </button>
  )
}
