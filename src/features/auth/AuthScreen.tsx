/**
 * Anmeldung und Registrierung — der einzige Bildschirm ohne Sitzung.
 *
 * Fehler landen bewusst in der Karte und nicht in der Meldungsleiste: sie
 * gehoeren zu dem Formular, das sie ausgeloest hat, und muessen dort sichtbar
 * bleiben, solange die Eingabe korrigiert wird.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useStore } from '@/lib/store'
import { describeError, supabase } from '@/lib/supabase'
import { Button, Tabs, TextField } from '@/components/ui'

type Mode = 'signin' | 'signup'

const MODES = [
  { id: 'signin' as const, label: 'Anmelden' },
  { id: 'signup' as const, label: 'Registrieren' },
]

/** Untergrenze dieser Oberflaeche. Sie liegt bewusst ueber der von Supabase. */
const MIN_PASSWORD_LENGTH = 8

/** Grobe Plausibilitaet — die endgueltige Pruefung macht ohnehin der Server. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

interface FieldErrors {
  displayName?: string
  email?: string
  password?: string
  confirm?: string
}

/**
 * describeError kennt nur die drei haeufigsten Anmeldefehler; alles andere
 * reicht es unuebersetzt durch. Hier stehen die restlichen Meldungen des
 * Auth-Dienstes, damit auf diesem Bildschirm kein englischer Rohtext auftaucht.
 */
function describeAuthError(error: unknown): string {
  const msg = (error as { message?: string } | null)?.message ?? ''

  if (/Email not confirmed/i.test(msg)) {
    return 'Diese Adresse ist noch nicht bestaetigt. Oeffne bitte zuerst den Link aus der Bestaetigungsmail.'
  }
  const throttled = /after (\d+) seconds/i.exec(msg)
  if (throttled) {
    return `Zu viele Versuche. Bitte warte ${throttled[1]} Sekunden und versuche es erneut.`
  }
  if (/rate limit|too many requests/i.test(msg)) {
    return 'Zu viele Versuche. Bitte warte einen Moment und versuche es erneut.'
  }
  if (/Unable to validate email address|Email address .* is invalid|invalid format/i.test(msg)) {
    return 'Diese E-Mail-Adresse akzeptiert der Server nicht.'
  }
  if (/Signup requires a valid password|Password cannot be empty/i.test(msg)) {
    return 'Bitte gib ein Passwort ein.'
  }
  if (/weak.?password|password is too weak/i.test(msg)) {
    return 'Dieses Passwort ist zu schwach. Waehle bitte ein laengeres oder ungewoehnlicheres.'
  }
  if (/Signups not allowed|Signup is disabled|signup_disabled/i.test(msg)) {
    return 'Die Registrierung ist fuer diese Installation abgeschaltet. Bitte lass dich einladen.'
  }
  return describeError(error)
}

export default function AuthScreen() {
  const signIn = useStore((s) => s.signIn)
  const signUp = useStore((s) => s.signUp)

  const [mode, setMode] = useState<Mode>('signin')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Gesetzt, wenn die Registrierung noch auf eine Bestaetigungsmail wartet. */
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<string | null>(null)

  const confirmationHeading = useRef<HTMLHeadingElement>(null)

  // Der Hinweisbildschirm ersetzt das Formular vollstaendig. Ohne diesen Griff
  // faellt der Tastaturfokus auf den Seitenanfang zurueck und Vorlesegeraete
  // melden den Wechsel gar nicht.
  useEffect(() => {
    if (awaitingConfirmation) confirmationHeading.current?.focus()
  }, [awaitingConfirmation])

  function switchMode(next: Mode) {
    if (next === mode || busy) return
    setMode(next)
    setErrors({})
    setFormError(null)
    setConfirm('')
  }

  /** Beanstandungen verschwinden, sobald das betroffene Feld angefasst wird. */
  function clearErrors(...fields: (keyof FieldErrors)[]) {
    setErrors((prev) => {
      if (!fields.some((f) => prev[f])) return prev
      const next = { ...prev }
      for (const f of fields) delete next[f]
      return next
    })
    setFormError(null)
  }

  function validate(): FieldErrors {
    const found: FieldErrors = {}
    const mail = email.trim()

    if (!mail) found.email = 'Bitte gib deine E-Mail-Adresse ein.'
    else if (!EMAIL_PATTERN.test(mail)) found.email = 'Diese E-Mail-Adresse sieht nicht gueltig aus.'

    if (!password) found.password = 'Bitte gib dein Passwort ein.'

    if (mode === 'signup') {
      if (!displayName.trim()) found.displayName = 'Bitte gib einen Anzeigenamen ein.'
      if (password && password.length < MIN_PASSWORD_LENGTH) {
        found.password = `Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`
      }
      if (!found.password && confirm !== password) {
        found.confirm = 'Die beiden Passwoerter stimmen nicht ueberein.'
      }
    }

    return found
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setFormError(null)
      return
    }

    setBusy(true)
    setFormError(null)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        await signUp(email, password, displayName)
        // Ist die E-Mail-Bestaetigung im Projekt aktiv, entsteht hier noch
        // keine Sitzung — dann bleibt der Bildschirm stehen und erklaert das.
        const { data } = await supabase.auth.getSession()
        if (!data.session) {
          setAwaitingConfirmation(email.trim())
          setPassword('')
          setConfirm('')
        }
      }
    } catch (error) {
      setFormError(describeAuthError(error))
    } finally {
      setBusy(false)
    }
  }

  if (awaitingConfirmation) {
    return (
      <div className="auth-screen">
        <div className="auth-card panel">
          <h1 className="auth-title" tabIndex={-1} ref={confirmationHeading}>
            Fast geschafft
          </h1>
          <p className="auth-sub">Noch ein Schritt bis zum ersten Standort.</p>

          <div className="notice notice-success" role="status">
            <span className="notice-text">
              Wir haben eine Bestaetigungsmail an <strong>{awaitingConfirmation}</strong> geschickt.
              Oeffne den Link darin, danach kannst du dich hier anmelden.
            </span>
          </div>

          <p className="small muted" style={{ marginTop: 12 }}>
            Keine Nachricht erhalten? Sieh bitte auch im Spam-Ordner nach.
          </p>

          <Button
            type="button"
            variant="primary"
            block
            style={{ marginTop: 4 }}
            onClick={() => {
              setAwaitingConfirmation(null)
              setMode('signin')
              setDisplayName('')
              setErrors({})
              setFormError(null)
            }}
          >
            Zur Anmeldung
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <div className="auth-card panel">
        <h1 className="auth-title">
          <span aria-hidden="true">📍</span> mapper
        </h1>
        <p className="auth-sub">Standorte pflegen, gruppieren und Routen planen.</p>

        {/* Der Umschalter steht ausserhalb des Formulars: seine Schaltflaechen
            wuerden sonst als Absenden zaehlen. */}
        <Tabs tabs={MODES} active={mode} onChange={switchMode} />

        {/* key: der Moduswechsel baut die Felder neu auf, damit autoFocus
            greift — sonst verliert die Tastatur beim Umschalten den Fokus. */}
        <form key={mode} onSubmit={handleSubmit} noValidate style={{ marginTop: 16 }}>
          {mode === 'signup' && (
            <TextField
              label="Anzeigename"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value)
                clearErrors('displayName')
              }}
              error={errors.displayName}
              aria-invalid={Boolean(errors.displayName)}
              autoComplete="name"
              autoFocus
              disabled={busy}
              placeholder="Wie sollen dich andere sehen?"
            />
          )}

          <TextField
            label="E-Mail-Adresse"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              clearErrors('email')
            }}
            error={errors.email}
            aria-invalid={Boolean(errors.email)}
            autoComplete="email"
            autoFocus={mode === 'signin'}
            disabled={busy}
            placeholder="name@beispiel.de"
          />

          <TextField
            label="Passwort"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              clearErrors('password', 'confirm')
            }}
            error={errors.password}
            aria-invalid={Boolean(errors.password)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            hint={mode === 'signup' ? `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen.` : undefined}
            disabled={busy}
          />

          {mode === 'signup' && (
            <TextField
              label="Passwort wiederholen"
              type="password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value)
                clearErrors('confirm')
              }}
              error={errors.confirm}
              aria-invalid={Boolean(errors.confirm)}
              autoComplete="new-password"
              disabled={busy}
            />
          )}

          {formError && (
            <div className="notice notice-error" role="alert" style={{ marginBottom: 12 }}>
              <span className="notice-text">{formError}</span>
            </div>
          )}

          <Button type="submit" variant="primary" block busy={busy}>
            {mode === 'signin' ? 'Anmelden' : 'Konto anlegen'}
          </Button>
        </form>

        {mode === 'signup' && (
          <>
            <hr className="divider" />
            <p className="small muted" style={{ margin: 0 }}>
              Das erste Konto dieser Installation wird automatisch App-Administrator und kann
              anschliessend weitere Konten anlegen.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
