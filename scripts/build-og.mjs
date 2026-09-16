/**
 * Baut public/og.png - das Bild, das Messenger und soziale Netze zeigen,
 * wenn jemand mapper.sanctora.eu verlinkt.
 *
 * Laeuft von Hand (node scripts/build-og.mjs), nicht im Bau: es aendert sich
 * nur, wenn sich der Auftritt aendert. Gerastert wird mit dem Chromium, das
 * ohnehin fuer die Tests da ist - dieselbe Maschine, die auch die Symbole
 * baut, und damit dasselbe Schriftbild wie im Browser.
 *
 * 1200 x 630 ist das Mass, das Open Graph und Twitter gemeinsam vertragen.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')
const b64 = (p, typ) => `data:${typ};base64,${readFileSync(join(wurzel, p)).toString('base64')}`

// Die Bilder als Data-URI einbetten: die Seite wird aus einem String geladen
// und hat keine Herkunft, von der aus sie Dateien nachladen koennte.
const zeichen = b64('public/favicon.svg', 'image/svg+xml')
const linien = b64('public/hoehenlinien.svg', 'image/svg+xml')

const seite = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;background:#050810;color:#e3eaf6;overflow:hidden;position:relative;
    font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
    -webkit-font-smoothing:antialiased}
  .motiv{position:absolute;inset:0;background:url('${linien}') center/cover;opacity:.5;
    -webkit-mask-image:linear-gradient(105deg,transparent 18%,#000 62%)}
  .inhalt{position:relative;height:100%;padding:72px 80px;display:flex;flex-direction:column;justify-content:space-between}
  .marke{display:flex;align-items:center;gap:16px;font-size:34px;font-weight:800;letter-spacing:-.03em}
  .marke img{width:52px;height:52px;border-radius:11px;display:block}
  h1{font-size:76px;font-weight:800;letter-spacing:-.04em;line-height:1.02;max-width:17ch}
  h1 em{font-style:normal;color:#f2b544}
  .fuss{display:flex;align-items:baseline;gap:28px;font-size:19px;
    font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:.16em;text-transform:uppercase;color:#78889f}
  .fuss .adresse{color:#f2b544}
  .strich{height:3px;width:104px;background:#f2b544;margin-bottom:30px}
</style></head><body>
  <div class="motiv"></div>
  <div class="inhalt">
    <div class="marke"><img src="${zeichen}" alt="">mapper</div>
    <div>
      <div class="strich"></div>
      <h1>Standorte und Touren auf <em>einer Karte</em>.</h1>
    </div>
    <div class="fuss">
      <span class="adresse">mapper.sanctora.eu</span>
      <span>Kostenlos</span>
      <span>Daten in Frankfurt</span>
      <span>Offener Quelltext</span>
    </div>
  </div>
</body></html>`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(seite, { waitUntil: 'load' })
await page.waitForTimeout(300)
const png = await page.screenshot({ type: 'png' })
await browser.close()
writeFileSync(join(wurzel, 'public/og.png'), png)
console.log(`public/og.png — ${(png.length / 1024).toFixed(0)} kB`)
