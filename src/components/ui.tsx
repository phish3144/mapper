/**
 * Gemeinsame Bausteine der Oberflaeche. Bewusst schlank gehalten: die
 * eigentliche Gestaltung steckt in den Klassen aus styles/global.css,
 * hier liegt nur das Verhalten.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { useStore } from '@/lib/store'

// --- Schaltflaeche ---------------------------------------------------------

type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  block?: boolean
  busy?: boolean
}

export function Button({
  variant = 'default',
  size = 'md',
  block,
  busy,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn-${variant}` : '',
    size === 'sm' ? 'btn-sm' : '',
    block ? 'btn-block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={classes} disabled={disabled || busy} {...rest}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-icon ${className ?? ''}`}
      title={label}
      aria-label={label}
      {...rest}
    >
      {children}
    </button>
  )
}

// --- Formularfelder --------------------------------------------------------

interface FieldProps {
  label: string
  hint?: string
  error?: string | null
  children: (id: string) => ReactNode
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}

export function TextField({
  label,
  hint,
  error,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => <input id={id} className={`input ${error ? 'is-invalid' : ''}`} {...rest} />}
    </Field>
  )
}

export function TextAreaField({
  label,
  hint,
  error,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string | null }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => <textarea id={id} className="textarea" {...rest} />}
    </Field>
  )
}

export function SelectField({
  label,
  hint,
  error,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string | null }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <select id={id} className="select" {...rest}>
          {children}
        </select>
      )}
    </Field>
  )
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

/** Farbwahl aus einer festen Palette — freie Farbwahl fuehrt zu unlesbaren Karten. */
export const PALETTE = [
  '#2563eb', '#0891b2', '#059669', '#65a30d', '#ca8a04',
  '#ea580c', '#dc2626', '#db2777', '#9333ea', '#4f46e5',
  '#0f766e', '#78716c',
] as const

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Farbe ${c}`}
          aria-pressed={value.toLowerCase() === c}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: c,
            cursor: 'pointer',
            border: value.toLowerCase() === c ? '2px solid var(--text)' : '2px solid transparent',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
          }}
        />
      ))}
    </div>
  )
}

// --- Dialog ----------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 480,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Fokus in den Dialog holen, sonst bleibt er beim ausloesenden Element und
    // die Tastaturbedienung verlaesst den Dialog sofort wieder.
    const first = ref.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
    )
    first?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <IconButton label="Schliessen" onClick={onClose}>
            ✕
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

/** Bestaetigung fuer nicht umkehrbare Aktionen. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Loeschen',
  onConfirm,
  onCancel,
  busy,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={400}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="danger" onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 13 }}>{message}</div>
    </Modal>
  )
}

/** Kapselt den Zustand rund um eine Bestaetigung, damit Seiten ihn nicht selbst halten. */
export function useConfirm() {
  const [pending, setPending] = useState<{
    title: string
    message: ReactNode
    confirmLabel?: string
    action: () => Promise<void> | void
  } | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = useCallback(
    (title: string, message: ReactNode, action: () => Promise<void> | void, confirmLabel?: string) => {
      setPending({ title, message, action, confirmLabel })
    },
    [],
  )

  const element = pending ? (
    <ConfirmDialog
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      busy={busy}
      onCancel={() => setPending(null)}
      onConfirm={async () => {
        setBusy(true)
        try {
          await pending.action()
          setPending(null)
        } finally {
          setBusy(false)
        }
      }}
    />
  ) : null

  return { confirm, confirmElement: element }
}

// --- Kleinteile ------------------------------------------------------------

export function Badge({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'accent' | 'danger' | 'success' | 'warning'
  children: ReactNode
}) {
  return <span className={`badge ${tone !== 'default' ? `badge-${tone}` : ''}`}>{children}</span>
}

export function Dot({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} aria-hidden="true" />
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Laedt" />
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`tab ${active === t.id ? 'is-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Meldungsleiste. Erfolge und Hinweise verschwinden von selbst, Fehler nicht. */
export function Notices() {
  const notices = useStore((s) => s.notices)
  const dismiss = useStore((s) => s.dismissNotice)

  useEffect(() => {
    const timers = notices
      .filter((n) => n.kind !== 'error')
      .map((n) => window.setTimeout(() => dismiss(n.id), 4000))
    return () => timers.forEach(window.clearTimeout)
  }, [notices, dismiss])

  if (notices.length === 0) return null
  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`notice notice-${n.kind}`}>
          <span className="notice-text">{n.text}</span>
          <IconButton label="Ausblenden" onClick={() => dismiss(n.id)}>
            ✕
          </IconButton>
        </div>
      ))}
    </div>
  )
}
