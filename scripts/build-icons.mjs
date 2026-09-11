/**
 * Baut aus public/favicon.svg alle gerasterten Fassungen.
 *
 * Laeuft von Hand (node scripts/build-icons.mjs), nicht im Bau der Anwendung:
 * das Zeichen aendert sich praktisch nie, und ein Bau soll keinen Browser
 * starten muessen. Gerastert wird mit dem Chromium, das ohnehin fuer die
 * Tests da ist - so entsteht genau das Bild, das auch im Browser erscheint.
 *
 * Ergebnis:
 *   favicon.ico          16/32/48 - fuer alles, was kein SVG mag
 *   apple-touch-icon.png 180      - iOS-Startbildschirm
 *   icon-192.png         192      - Android, Web-App-Manifest
 *   icon-512.png         512      - dito, grosse Fassung
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const QUELLE = new URL('../public/favicon.svg', import.meta.url)
const VERZEICHNIS = new URL('../public/', import.meta.url)

const svg = readFileSync(QUELLE, 'utf8')

/**
 * iOS legt seine eigene runde Maske ueber das Bild. Mit unseren runden Ecken
 * blieben an den vier Ecken helle Zwickel stehen - fuer diese eine Fassung
 * werden sie deshalb ausgestellt.
 */
const eckig = svg.replace('rx="7"', 'rx="0"')

const browser = await chromium.launch()

/** Rastert ein SVG auf genau groesse x groesse Pixel. */
async function rastern(quelltext, groesse) {
  const page = await browser.newPage({ viewport: { width: groesse, height: groesse } })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${groesse}px;height:${groesse}px}</style>${quelltext}`,
  )
  const bild = await page.screenshot({ omitBackground: true })
  await page.close()
  return bild
}

/**
 * Packt mehrere PNG in eine ICO-Datei.
 *
 * Das Format ist ein 6-Byte-Kopf, je Bild ein 16-Byte-Eintrag und danach die
 * Bilddaten am Stueck. PNG darf seit Vista unveraendert darin liegen.
 */
function ico(bilder) {
  const kopf = Buffer.alloc(6)
  kopf.writeUInt16LE(0, 0) // reserviert
  kopf.writeUInt16LE(1, 2) // 1 = Symbol
  kopf.writeUInt16LE(bilder.length, 4)

  let versatz = 6 + bilder.length * 16
  const eintraege = bilder.map(({ groesse, daten }) => {
    const e = Buffer.alloc(16)
    // 256 wird als 0 geschrieben - das Feld ist nur ein Byte breit.
    e.writeUInt8(groesse >= 256 ? 0 : groesse, 0)
    e.writeUInt8(groesse >= 256 ? 0 : groesse, 1)
    e.writeUInt8(0, 2) // Farbtafel: keine
    e.writeUInt8(0, 3) // reserviert
    e.writeUInt16LE(1, 4) // Ebenen
    e.writeUInt16LE(32, 6) // Bit je Punkt
    e.writeUInt32LE(daten.length, 8)
    e.writeUInt32LE(versatz, 12)
    versatz += daten.length
    return e
  })

  return Buffer.concat([kopf, ...eintraege, ...bilder.map((b) => b.daten)])
}

const fuerIco = []
for (const groesse of [16, 32, 48]) {
  fuerIco.push({ groesse, daten: await rastern(svg, groesse) })
}
writeFileSync(new URL('favicon.ico', VERZEICHNIS), ico(fuerIco))

const pngs = [
  ['apple-touch-icon.png', eckig, 180],
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
]
for (const [name, quelltext, groesse] of pngs) {
  writeFileSync(new URL(name, VERZEICHNIS), await rastern(quelltext, groesse))
}

await browser.close()

console.log(
  ['favicon.ico (16/32/48)', ...pngs.map(([n, , g]) => `${n} (${g})`)].join('\n'),
)
