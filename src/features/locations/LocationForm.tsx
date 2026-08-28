/**
 * Anlegen und Bearbeiten eines Standorts.
 *
 * Adresse und Koordinaten sind zwei getrennte Angaben, die dasselbe meinen:
 * die Karte braucht Koordinaten, der Mensch liest eine Adresse. Deshalb gibt
 * es beide Wege — Adresse suchen setzt den Punkt, Punkt setzen sucht die
 * Adresse — und keiner von beiden ist Pflicht ausser dem Punkt selbst.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Modal,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
  useConfirm,
} from '@/components/ui'
import { useStore } from '@/lib/store'
import { useUi } from '@/lib/uiStore'
import * as db from '@/lib/db'
import { isValidLatLng } from '@/lib/geo'
import { createAddressSearch, reverseGeocode } from '@/lib/geocode'
import type { GeocodeHit } from '@/lib/geocode'
import SymbolPicker from '@/components/SymbolPicker'
import { symbolEmoji } from '@/lib/symbols'
import VisibilityEditor from '@/features/catalog/VisibilityEditor'
import TimeWindowsEditor from './TimeWindowsEditor'
import type { LatLng, MapLocation, TimeWindow, VisibilityLevel } from '@/types/domain'

const MAX_NAME_LENGTH = 120
/** Kuerzere Eingaben liefern bei Nominatim fast nur Rauschen. */
const MIN_QUERY_LENGTH = 3

function parseCoord(value: string): number | null {
  const text = value.trim().replace(',', '.')
  if (text === '') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

export default function LocationForm({
  location,
  initialPoint,
  onClose,
}: {
  location: MapLocation | null
  initialPoint: LatLng | null
  onClose: () => void
}) {
  const workspaceId = useStore((s) => s.currentWorkspaceId)
  const categories = useStore((s) => s.categories)
  const groups = useStore((s) => s.groups)
  const locationGroups = useStore((s) => s.locationGroups)
  const refreshLocations = useStore((s) => s.refreshLocations)
  const notify = useStore((s) => s.notify)
  const reportError = useStore((s) => s.reportError)
  const setPickingPoint = useUi((s) => s.setPickingPoint)
  const selectLocation = useUi((s) => s.selectLocation)

  const [name, setName] = useState(location?.name ?? '')
  const [address, setAddress] = useState(location?.address ?? '')
  const [lat, setLat] = useState(() =>
    initialPoint ? String(initialPoint.lat) : location ? String(location.lat) : '',
  )
  const [lng, setLng] = useState(() =>
    initialPoint ? String(initialPoint.lng) : location ? String(location.lng) : '',
  )
  const [categoryId, setCategoryId] = useState(location?.category_id ?? '')
  const [icon, setIcon] = useState<string | null>(location?.icon ?? null)
  const gewaehlteKategorie = categories.find((c) => c.id === categoryId)
  const [groupIds, setGroupIds] = useState<string[]>(() =>
    location
      ? locationGroups.filter((lg) => lg.location_id === location.id).map((lg) => lg.group_id)
      : [],
  )
  const [serviceMinutes, setServiceMinutes] = useState(String(location?.service_minutes ?? 0))
  const [windows, setWindows] = useState<TimeWindow[]>(location?.time_windows ?? [])
  const [tags, setTags] = useState<string[]>(location?.tags ?? [])
  const [tagDraft, setTagDraft] = useState('')
  const [notes, setNotes] = useState(location?.notes ?? '')
  const [isActive, setIsActive] = useState(location?.is_active ?? true)
  const [visibility, setVisibility] = useState<VisibilityLevel>(location?.visibility ?? 'workspace')

  const [hits, setHits] = useState<GeocodeHit[]>([])
  const [searching, setSearching] = useState(false)
  const [reverseBusy, setReverseBusy] = useState(false)

  const [nameError, setNameError] = useState<string | null>(null)
  const [coordError, setCoordError] = useState<string | null>(null)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const groupsLabelId = useId()
  const tagsLabelId = useId()
  const { confirm, confirmElement } = useConfirm()

  const search = useMemo(() => createAddressSearch(), [])
  useEffect(() => () => search.cancel(), [search])

  const point = useMemo<LatLng | null>(() => {
    const parsedLat = parseCoord(lat)
    const parsedLng = parseCoord(lng)
    if (parsedLat === null || parsedLng === null) return null
    const candidate = { lat: parsedLat, lng: parsedLng }
    return isValidLatLng(candidate) ? candidate : null
  }, [lat, lng])

  function onAddressChange(value: string) {
    setAddress(value)
    const query = value.trim()
    if (query.length < MIN_QUERY_LENGTH) {
      search.cancel()
      setHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    search(query, (found) => {
      setHits(found)
      setSearching(false)
    })
  }

  function applyHit(hit: GeocodeHit) {
    search.cancel()
    setAddress(hit.label)
    setLat(String(hit.lat))
    setLng(String(hit.lng))
    setHits([])
    setSearching(false)
    setCoordError(null)
  }

  async function lookupAddress() {
    if (!point) {
      setCoordError('Bitte zuerst gueltige Koordinaten angeben.')
      return
    }
    setReverseBusy(true)
    try {
      const hit = await reverseGeocode(point)
      if (hit) {
        search.cancel()
        setAddress(hit.label)
        setHits([])
        notify('success', 'Adresse zum Punkt uebernommen.')
      } else {
        notify('info', 'Zu diesem Punkt wurde keine Adresse gefunden.')
      }
    } finally {
      setReverseBusy(false)
    }
  }

  function pickOnMap() {
    // Das Formular macht der Karte Platz; LocationsPanel oeffnet es mit dem
    // geklickten Punkt erneut.
    setPickingPoint(true)
    onClose()
  }

  function addTags(raw: readonly string[]) {
    const cleaned = raw.map((t) => t.trim()).filter((t) => t !== '')
    if (cleaned.length === 0) return
    setTags((prev) => {
      const next = [...prev]
      for (const tag of cleaned) {
        if (!next.some((existing) => existing.toLowerCase() === tag.toLowerCase())) next.push(tag)
      }
      return next
    })
  }

  function onTagInput(value: string) {
    if (!value.includes(',')) {
      setTagDraft(value)
      return
    }
    const parts = value.split(',')
    const rest = parts.pop() ?? ''
    addTags(parts)
    setTagDraft(rest)
  }

  async function save() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError('Bitte einen Namen angeben.')
      return
    }
    if (!point) {
      setCoordError('Breite muss zwischen -90 und 90 liegen, Laenge zwischen -180 und 180.')
      return
    }
    if (!workspaceId) return

    const minutes = parseCoord(serviceMinutes) ?? 0
    if (minutes < 0) {
      setServiceError('Die Aufenthaltsdauer darf nicht negativ sein.')
      return
    }

    // Ein noch nicht bestaetigter Tag im Eingabefeld waere sonst verloren.
    const pendingTag = tagDraft.trim()
    const finalTags =
      pendingTag && !tags.some((t) => t.toLowerCase() === pendingTag.toLowerCase())
        ? [...tags, pendingTag]
        : tags

    setNameError(null)
    setCoordError(null)
    setServiceError(null)
    setBusy(true)
    try {
      const input: db.LocationInput = {
        name: trimmedName,
        lat: point.lat,
        lng: point.lng,
        address: address.trim() || null,
        notes: notes.trim() || null,
        category_id: categoryId || null,
        icon,
        service_minutes: Math.round(minutes),
        time_windows: windows,
        tags: finalTags,
        is_active: isActive,
        visibility,
      }
      const saved = location
        ? await db.updateLocation(location.id, input)
        : await db.createLocation(workspaceId, input)
      await db.setLocationGroups(saved.id, groupIds)
      await refreshLocations()
      selectLocation(saved.id)
      notify('success', location ? 'Standort gespeichert.' : 'Standort angelegt.')
      onClose()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }

  function askDelete() {
    if (!location) return
    confirm(
      'Standort loeschen',
      <>
        Soll <strong>{location.name}</strong> wirklich geloescht werden? Der Standort verschwindet
        damit auch aus allen Routen und Gruppen.
      </>,
      async () => {
        try {
          await db.deleteLocation(location.id)
          await refreshLocations()
          if (useUi.getState().selectedLocationId === location.id) selectLocation(null)
          notify('success', 'Standort geloescht.')
          onClose()
        } catch (e) {
          reportError(e)
        }
      },
    )
  }

  return (
    <Modal
      title={location ? 'Standort bearbeiten' : 'Neuer Standort'}
      onClose={onClose}
      width={560}
      footer={
        <>
          {location && (
            <Button variant="danger" onClick={askDelete} disabled={busy} style={{ marginRight: 'auto' }}>
              Loeschen
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Speichern
          </Button>
        </>
      }
    >
      <TextField
        label="Name"
        value={name}
        autoFocus
        maxLength={MAX_NAME_LENGTH}
        placeholder="z. B. Lager Nord"
        error={nameError}
        onChange={(e) => {
          setName(e.target.value)
          if (nameError) setNameError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
        }}
      />

      <Field
        label="Adresse"
        hint="Tippen sucht passende Adressen bei OpenStreetMap. Ein Vorschlag setzt auch die Koordinaten."
      >
        {(id) => (
          <div className="row">
            <input
              id={id}
              className="input"
              value={address}
              placeholder="Strasse Hausnummer, PLZ Ort"
              autoComplete="off"
              onChange={(e) => onAddressChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && hits.length > 0) {
                  e.stopPropagation()
                  setHits([])
                }
              }}
            />
            {searching && <Spinner />}
          </div>
        )}
      </Field>

      {hits.length > 0 && (
        <div className="panel scroll-y" style={{ maxHeight: 190, marginTop: -6, marginBottom: 12 }}>
          <div className="list">
            {hits.map((hit, index) => (
              <div
                key={`${index}-${hit.lat}-${hit.lng}`}
                className="list-item"
                role="button"
                tabIndex={0}
                onClick={() => applyHit(hit)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    applyHit(hit)
                  }
                }}
              >
                <div className="list-item-main">
                  <div className="list-item-title" style={{ whiteSpace: 'normal' }}>
                    {hit.label}
                  </div>
                  <div className="list-item-sub mono">
                    {hit.lat.toFixed(5)} / {hit.lng.toFixed(5)}
                  </div>
                </div>
                {hit.type && <Badge>{hit.type}</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="field-row">
        <TextField
          label="Breite"
          value={lat}
          inputMode="decimal"
          placeholder="52.5170"
          error={coordError}
          onChange={(e) => {
            setLat(e.target.value)
            if (coordError) setCoordError(null)
          }}
        />
        <TextField
          label="Laenge"
          value={lng}
          inputMode="decimal"
          placeholder="13.4050"
          onChange={(e) => {
            setLng(e.target.value)
            if (coordError) setCoordError(null)
          }}
        />
      </div>

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <Button size="sm" onClick={pickOnMap}>
          Auf der Karte waehlen
        </Button>
        <Button size="sm" busy={reverseBusy} disabled={!point} onClick={() => void lookupAddress()}>
          Adresse zum Punkt suchen
        </Button>
      </div>
      <div className="field-hint" style={{ marginTop: -8, marginBottom: 12 }}>
        „Auf der Karte waehlen“ schliesst dieses Formular. Nach dem Klick auf die Karte oeffnet es
        sich mit dem gewaehlten Punkt erneut — andere noch nicht gespeicherte Eingaben gehen dabei
        verloren.
      </div>

      <SelectField
        label="Kategorie"
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
      >
        <option value="">Ohne Kategorie</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>

      <SymbolPicker
        label="Symbol auf der Karte"
        value={icon}
        onChange={setIcon}
        inherit={{
          label: gewaehlteKategorie
            ? `Von der Kategorie „${gewaehlteKategorie.name}" uebernehmen`
            : 'Vorgabe (Nadel)',
          emoji: symbolEmoji(gewaehlteKategorie?.icon),
        }}
      />

      <div className="field">
        <span id={groupsLabelId} className="small muted" style={{ fontWeight: 600 }}>
          Gruppen
        </span>
        {groups.length === 0 ? (
          <span className="field-hint">Noch keine Gruppen angelegt.</span>
        ) : (
          <div className="chips" role="group" aria-labelledby={groupsLabelId}>
            {groups.map((g) => {
              const on = groupIds.includes(g.id)
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`chip ${on ? 'is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() =>
                    setGroupIds((prev) =>
                      prev.includes(g.id) ? prev.filter((x) => x !== g.id) : [...prev, g.id],
                    )
                  }
                >
                  <span className="dot" style={{ background: g.color }} aria-hidden="true" />
                  {g.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <TextField
        label="Aufenthaltsdauer (Minuten)"
        type="number"
        min={0}
        step={5}
        value={serviceMinutes}
        hint="Wie lange vor Ort geblieben wird — die Routenplanung rechnet damit."
        error={serviceError}
        onChange={(e) => {
          setServiceMinutes(e.target.value)
          if (serviceError) setServiceError(null)
        }}
      />

      <TimeWindowsEditor value={windows} onChange={setWindows} />

      <div className="field">
        <span id={tagsLabelId} className="small muted" style={{ fontWeight: 600 }}>
          Tags
        </span>
        {tags.length > 0 && (
          <div className="chips" role="group" aria-labelledby={tagsLabelId}>
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip"
                aria-label={`Tag "${tag}" entfernen`}
                onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
              >
                {tag}
                <span className="chip-x" aria-hidden="true">
                  ✕
                </span>
              </button>
            ))}
          </div>
        )}
        <input
          className="input"
          value={tagDraft}
          placeholder="Tag eingeben, mit Komma oder Eingabetaste bestaetigen"
          aria-label="Neuen Tag eingeben"
          onChange={(e) => onTagInput(e.target.value)}
          onBlur={() => {
            addTags([tagDraft])
            setTagDraft('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTags([tagDraft])
              setTagDraft('')
            } else if (e.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
              setTags((prev) => prev.slice(0, -1))
            }
          }}
        />
      </div>

      <TextAreaField
        label="Notizen"
        value={notes}
        rows={3}
        placeholder="Optional — Ansprechpartner, Zufahrt, Besonderheiten"
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="field">
        <Checkbox
          label="Aktiv — wird in Karte, Filtern und Routenregeln beruecksichtigt"
          checked={isActive}
          onChange={setIsActive}
        />
      </div>

      <hr className="divider" />

      <VisibilityEditor
        kind="location"
        entityId={location?.id ?? null}
        workspaceId={location?.workspace_id ?? workspaceId ?? ''}
        createdBy={location?.created_by}
        value={visibility}
        onChange={setVisibility}
      />

      {confirmElement}
    </Modal>
  )
}
