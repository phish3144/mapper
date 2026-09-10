/**
 * Baut public/plz2.geojson: die 95 zweistelligen PLZ-Leitregionen.
 *
 * Laeuft von Hand (node scripts/build-plz2.mjs), nicht im Bau der Anwendung -
 * die Grenzen aendern sich praktisch nie, und ein Bau soll nicht am Netz
 * haengen. Alles Weitere steht in public/plz2.README.md.
 */
import { writeFileSync } from 'node:fs'

const QUELLE =
  'https://raw.githubusercontent.com/kibotu/umriss/main/data/plz-boundaries-2d.geojson'
const ZIEL = new URL('../public/plz2.geojson', import.meta.url)

/** Toleranz in Grad. Bei 51 Grad Nord rund 80 m quer, 110 m hoch. */
const TOLERANZ = 0.001
/** Nachkommastellen der Koordinaten; 4 sind rund 11 m. */
const STELLEN = 4
/** Ein Quadratgrad entspricht bei 51 Grad Nord rund 7770 km2. */
const QKM_JE_QUADRATGRAD = 7770
/** Kleinere Ringe sind Splitter, keine Inseln. */
const MIN_QKM = 2

/** Senkrechter Abstand von p zur Strecke a-b, in Gradmass. */
function abstand(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Douglas-Peucker, iterativ statt rekursiv (Ringe haben bis zu 10.000 Punkte). */
function duennen(pts, tol) {
  if (pts.length < 3) return pts
  const behalten = new Uint8Array(pts.length)
  behalten[0] = behalten[pts.length - 1] = 1
  const stapel = [[0, pts.length - 1]]
  while (stapel.length) {
    const [i, j] = stapel.pop()
    let max = 0, k = -1
    for (let m = i + 1; m < j; m++) {
      const d = abstand(pts[m], pts[i], pts[j])
      if (d > max) { max = d; k = m }
    }
    if (max > tol && k > 0) { behalten[k] = 1; stapel.push([i, k], [k, j]) }
  }
  return pts.filter((_, i) => behalten[i])
}

const runden = (p, n) => [Number(p[0].toFixed(n)), Number(p[1].toFixed(n))]

/** Flaeche eines Rings in Quadratgrad - zum Wegwerfen winziger Inseln. */
function ringFlaeche(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return Math.abs(a / 2)
}

function ringVerarbeiten(ring, tol, stellen, minFlaeche) {
  if (ringFlaeche(ring) < minFlaeche) return null
  let d = duennen(ring, tol).map((p) => runden(p, stellen))
  // Nach dem Runden koennen Punkte zusammenfallen.
  d = d.filter((p, i) => i === 0 || p[0] !== d[i - 1][0] || p[1] !== d[i - 1][1])
  if (d.length < 4) return null
  const [a, b] = [d[0], d[d.length - 1]]
  if (a[0] !== b[0] || a[1] !== b[1]) d.push([a[0], a[1]])
  return d.length >= 4 ? d : null
}

function polygonVerarbeiten(ringe, tol, stellen, minFlaeche) {
  const out = ringe.map((r) => ringVerarbeiten(r, tol, stellen, minFlaeche)).filter(Boolean)
  return out.length ? out : null
}

/**
 * Wo die Nummer der Region stehen soll.
 *
 * Der Schwerpunkt des GROESSTEN Rings, nicht der aller Ringe: sonst zoege eine
 * Nordseeinsel die Beschriftung ihrer Region aufs Wasser hinaus. Ein echter
 * Pol der Unzugaenglichkeit waere genauer, aber bei diesen Formen liegt der
 * Schwerpunkt fast immer schon in der Flaeche.
 */
function beschriftungsPunkt(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  let besterRing = null
  let besteFlaeche = -1
  for (const poly of polys) {
    const f = ringFlaeche(poly[0])
    if (f > besteFlaeche) {
      besteFlaeche = f
      besterRing = poly[0]
    }
  }
  let x = 0
  let y = 0
  let a = 0
  for (let i = 0, j = besterRing.length - 1; i < besterRing.length; j = i++) {
    const kreuz = besterRing[j][0] * besterRing[i][1] - besterRing[i][0] * besterRing[j][1]
    a += kreuz
    x += (besterRing[j][0] + besterRing[i][0]) * kreuz
    y += (besterRing[j][1] + besterRing[i][1]) * kreuz
  }
  // Entartete Ringe (Flaeche 0) gibt es nach dem Filtern nicht mehr; der
  // Rueckfall auf den ersten Punkt kostet aber nichts.
  if (a === 0) return [Number(besterRing[0][0].toFixed(4)), Number(besterRing[0][1].toFixed(4))]
  const f = 1 / (3 * a)
  return [Number((x * f).toFixed(4)), Number((y * f).toFixed(4))]
}

function vereinfachen(quelle, { tol, stellen, minFlaeche }) {
  const features = []
  for (const f of quelle.features) {
    const g = f.geometry
    let geom = null
    if (g.type === 'Polygon') {
      const p = polygonVerarbeiten(g.coordinates, tol, stellen, minFlaeche)
      if (p) geom = { type: 'Polygon', coordinates: p }
    } else if (g.type === 'MultiPolygon') {
      const ps = g.coordinates
        .map((p) => polygonVerarbeiten(p, tol, stellen, minFlaeche))
        .filter(Boolean)
      if (ps.length === 1) geom = { type: 'Polygon', coordinates: ps[0] }
      else if (ps.length > 1) geom = { type: 'MultiPolygon', coordinates: ps }
    }
    if (geom) {
      features.push({
        type: 'Feature',
        properties: { plz: f.properties.d2, c: beschriftungsPunkt(geom) },
        geometry: geom,
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

const antwort = await fetch(QUELLE)
if (!antwort.ok) throw new Error(`Quelle nicht erreichbar: HTTP ${antwort.status}`)
const quelle = await antwort.json()

const ergebnis = vereinfachen(quelle, {
  tol: TOLERANZ,
  stellen: STELLEN,
  minFlaeche: MIN_QKM / QKM_JE_QUADRATGRAD,
})

// Ein stiller Verlust ganzer Regionen waere der schlimmste Fehler hier: die
// Karte haette dann einfach ein Loch, das niemandem als Fehler auffiele.
if (ergebnis.features.length !== quelle.features.length) {
  throw new Error(
    `Regionen verloren: ${quelle.features.length} hinein, ${ergebnis.features.length} heraus`,
  )
}

const text = JSON.stringify(ergebnis)
writeFileSync(ZIEL, text)
console.log(`${ergebnis.features.length} Regionen, ${(text.length / 1024).toFixed(0)} KB`)
