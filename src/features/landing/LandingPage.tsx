/**
 * Die oeffentliche Startseite unter mapper.sanctora.eu.
 *
 * Sie steht vor der Anmeldung und beantwortet die Frage, die eine
 * Anmeldemaske nicht beantworten kann: wozu das hier gut ist und worauf es
 * beruht.
 *
 * Vier Regeln, nach denen sie gebaut ist:
 *
 * 1. Jede Aussage ist durch eine Funktion gedeckt, die es wirklich gibt.
 *    Was fehlt, steht unter "Was mapper nicht kann" - nicht, weil Demut
 *    huebsch aussieht, sondern weil eine Karte, die Sperrungen ANZEIGT, aber
 *    nicht einplant, sonst falsch verstanden wird.
 * 2. Zahlen statt Adjektive. "Alle zehn Minuten" und "108 Bundesautobahnen"
 *    kann man nachzaehlen, "blitzschnell" nicht.
 * 3. Kein Knopf, der ins Leere fuehrt - siehe ANGABEN.registrierungOffen.
 * 4. Keine Anfrage an Dritte. Keine Fremdschrift, kein Analyseskript, kein
 *    eingebettetes Video. Der Fuss behauptet das, also muss es stimmen.
 *
 * Optisch gehoert die Seite zur Familie von sanctora.eu und
 * lotse.sanctora.eu - dunkler Grund, Amber als einziger Akzent,
 * Mono-Kleinlabels - mit einem eigenen Motiv: Hoehenlinien.
 */
import BrandMark from '@/components/BrandMark'
import { ANGABEN, offenePunkte } from './angaben'

const BASIS = import.meta.env.BASE_URL

/** Ein Schritt des Arbeitstags. */
interface Schritt {
  nummer: string
  titel: string
  text: string
}

const ARBEITSTAG: Schritt[] = [
  {
    nummer: '01',
    titel: 'Bestand erfassen',
    text:
      'Standorte per Formular anlegen, auf die Karte klicken oder aus einer vorhandenen Datei einlesen — GeoJSON, CSV und KML, auch das aus Google My Maps. Vor dem Übernehmen steht eine Vorschau: gefundene Adressen angehakt, nicht gefundene sichtbar. Verworfen kostet nichts, weil bis dahin nichts entstanden ist.',
  },
  {
    nummer: '02',
    titel: 'Einfärben',
    text:
      'Die Kategorie sagt, was für ein Ort das ist — Kunde, Lager, Baustelle. Die Gruppe sagt, wer zuständig ist — Team Nord, Team Süd. Ein Standort hat höchstens eine Kategorie, aber beliebig viele Gruppen: gehört er zweien, wird die Nadel der Länge nach geteilt und trägt beide Farben. Keine Gruppe ist die Hauptgruppe.',
  },
  {
    nummer: '03',
    titel: 'Zeiten hinterlegen',
    text:
      'Je Standort die Aufenthaltsdauer und die Öffnungszeiten, getrennt nach Wochentag. Wer erst ab 13 Uhr aufmacht, wird nicht um 9 eingeplant.',
  },
  {
    nummer: '04',
    titel: 'Tour bauen',
    text:
      'Eine Liste Adressen ins Feld werfen, Vorschau prüfen, fertig ist die Tour. Dabei entstehen keine neuen Punkte auf der Karte: ein Stopp trägt seine Koordinate selbst. Wer lieber aus dem Bestand plant, zieht die Stopps von Hand in die Reihenfolge.',
  },
  {
    nummer: '05',
    titel: 'Rechnen lassen',
    text:
      'Die Reihenfolge kann die Anwendung bestimmen. Der Fahrplan nennt Ankunft und Abfahrt je Stopp und markiert, wer außerhalb seiner Öffnungszeit läge. Woher eine Fahrzeit stammt, steht dabei: gerechnete Strecke oder — wenn der Routendienst nicht antwortet — Luftlinie, dann sichtbar als „geschätzt".',
  },
  {
    nummer: '06',
    titel: 'Lage prüfen',
    text:
      'Sperrungen und Baustellen aller 108 Bundesautobahnen, alle zehn Minuten frisch. Dazu die zweistelligen PLZ-Leitregionen als Umriss, wenn Gebiete zwischen Teams aufgeteilt sind.',
  },
]

/** Was die Anwendung kann, das im Arbeitstag oben nicht vorkommt. */
const KANN: { marke: string; was: string; text: string }[] = [
  {
    marke: 'Zu mehreren',
    was: 'Arbeitsbereiche und Rollen',
    text:
      'Jeder Bestand ist ein Arbeitsbereich mit eigener Mitgliederliste. Drei Rollen: lesen, bearbeiten, verwalten. Wer nur liest, sieht dieselbe Karte, kann aber nichts verschieben. Einzelne Standorte lassen sich enger stellen als der Bereich.',
  },
  {
    marke: 'Suchen',
    was: 'Adresse und Umgebung',
    text:
      'Die Suche findet gespeicherte Standorte und freie Adressen in einem Feld und merkt sich die letzten acht. Zu jedem Punkt lässt sich fragen, was in der Nähe liegt — und von dort direkt eine Strecke zu einem beliebigen Ziel zeichnen.',
  },
  {
    marke: 'Hinein',
    was: 'Import ohne Abtippen',
    text:
      'GeoJSON, CSV und KML. Spaltennamen werden erkannt, auch deutsche mit Umlauten. Adressen ohne Koordinaten werden nachgeschlagen; was nicht eindeutig ist, wird angezeigt statt stillschweigend geraten.',
  },
  {
    marke: 'Hinaus',
    was: 'Und wieder heraus',
    text:
      'Der ganze Bestand als GeoJSON oder CSV, vollständig und ohne Nachfrage. Kein Abo, das die eigenen Daten als Geisel nimmt — was hineingeht, kommt auch wieder heraus.',
  },
]

/** Woher die Daten kommen. Der eigentliche Grund, warum es diese Seite gibt. */
const HERKUNFT: { was: string; woher: string }[] = [
  {
    was: 'Karte',
    woher:
      'Straßenkarte und Gelände von OpenStreetMap, Satellitenbilder von Esri. Die Namensnennung steht unter der Karte, wie es die Lizenzen verlangen — nicht im Kleingedruckten.',
  },
  {
    was: 'Adressen',
    woher:
      'Nominatim, der Geocoder des OpenStreetMap-Projekts, mit Photon von Komoot als Ausweiche. Beide ohne eigenen Schlüssel. Die Anfragen laufen gebündelt über einen eigenen Server, damit die Grenze von einer Anfrage je Sekunde eingehalten wird, auch wenn mehrere Leute gleichzeitig suchen.',
  },
  {
    was: 'Verkehr',
    woher:
      'Die offene Schnittstelle der Autobahn GmbH des Bundes, Datenlizenz Deutschland 2.0. Ein vollständiger Stand kostet 216 Abrufe; die laufen einmal je zehn Minuten für alle zusammen, nicht je Person.',
  },
  {
    was: 'Postleitzahlen',
    woher:
      'Die Grenzen der zweistelligen Leitregionen stammen aus OpenStreetMap (ODbL) und liegen fertig aufbereitet in der Anwendung. Sie werden erst geladen, wenn die Ebene eingeschaltet wird.',
  },
  {
    was: 'Deine Daten',
    woher:
      'Datenbank und Anmeldung laufen bei Supabase in der Region eu-central-1 — Frankfurt am Main. Tracking- oder Analyseskripte Dritter sind nicht eingebaut.',
  },
]

/** Was die Anwendung NICHT kann. Gehoert auf die Seite, nicht in die Fussnote. */
const GRENZEN: { was: string; text: string }[] = [
  {
    was: 'Keine Tour aufs Navi',
    text:
      'Es gibt einen Navigationsverweis von Punkt zu Punkt, aber keinen Export einer ganzen Tour als GPX oder KML. Eine Reihenfolge mit acht Stopps landet nicht in einem Schlag auf dem Telefon des Fahrers.',
  },
  {
    was: 'Verkehr wird gezeigt, nicht eingeplant',
    text:
      'Sperrungen und Baustellen liegen auf der Karte. In die Berechnung der Fahrzeiten fließen sie nicht ein — die Tour ist nach freier Strecke geplant.',
  },
  {
    was: 'Keine Stauprognose',
    text:
      'Die Fahrzeiten kennen keine Tageszeit. Wer zur Hauptverkehrszeit fährt, braucht länger als der Fahrplan sagt.',
  },
  {
    was: 'Nicht offlinefähig',
    text: 'Ohne Netz geht nichts. Es gibt keinen zwischengespeicherten Kartenausschnitt.',
  },
]

/** Kapitelkopf: Nummer und Marginalie links, Aussage rechts. */
function Kapitelrand({ nr, tt }: { nr: string; tt: string }) {
  return (
    <div className="lp-rand">
      <span className="nr">{nr}</span>
      <span className="tt">{tt}</span>
    </div>
  )
}

interface LandingPageProps {
  /** Oeffnet die Anmeldemaske. `registrieren` waehlt dort gleich den Reiter. */
  onAnmelden: (registrieren?: boolean) => void
}

export default function LandingPage({ onAnmelden }: LandingPageProps) {
  const fehlt = offenePunkte()
  const offen = ANGABEN.registrierungOffen

  return (
    <div className="lp">
      <div className="lp-motiv" aria-hidden="true" />

      <header className="lp-kopf">
        <div className="lp-huelle lp-kopf-reihe">
          <a className="lp-marke" href="#oben">
            <BrandMark size={22} />
            mapper
          </a>
          <nav aria-label="Abschnitte dieser Seite">
            <a href="#arbeitstag">Ein Arbeitstag</a>
            <a href="#herkunft">Herkunft</a>
            <a href="#grenzen">Grenzen</a>
            <a href="#preis">Preis</a>
            <a href="#fragen">Fragen</a>
          </nav>
          <div className="lp-kopf-rechts">
            <button type="button" className="lp-knopf leise" onClick={() => onAnmelden(false)}>
              Anmelden
            </button>
            {offen && (
              <button type="button" className="lp-knopf" onClick={() => onAnmelden(true)}>
                Konto anlegen
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="lp-schicht" id="oben">
        {/* --- Bühne ------------------------------------------------------ */}
        <div className="lp-huelle">
          <section className="lp-buehne">
            <span className="lp-etikett">Sanctora · Standorte und Touren</span>
            <h1>Deine Standorte auf einer Karte, die du nachprüfen kannst.</h1>
            <p className="lp-lead">
              mapper hält feste Standorte nach <b>Kategorie</b> und <b>Gruppe</b> auf der Karte und
              plant daraus Touren. Woher die Karte kommt, woher die Adressen kommen und wo die
              Daten liegen, steht weiter unten — und im offenen Quelltext an der Stelle, die es
              umsetzt.
            </p>

            <div className="lp-knopfreihe">
              {offen ? (
                <button
                  type="button"
                  className="lp-knopf gross"
                  onClick={() => onAnmelden(true)}
                >
                  Kostenlos anlegen <span className="pfeil" aria-hidden="true">→</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="lp-knopf gross"
                  onClick={() => onAnmelden(false)}
                >
                  Anmelden <span className="pfeil" aria-hidden="true">→</span>
                </button>
              )}
              {ANGABEN.quelltext && (
                <a
                  className="lp-knopf leise gross"
                  href={ANGABEN.quelltext}
                  target="_blank"
                  rel="noreferrer"
                >
                  Quelltext ansehen
                </a>
              )}
            </div>

            {!offen && (
              /* Kein Knopf, der ins Leere fuehrt: solange die Bestaetigungsmail
                 nicht ankommt, kommt auch niemand hinein, der sich neu
                 anmeldet. Das gehoert dorthin, wo sonst "jetzt loslegen" stuende. */
              <p className="lp-baustelle" role="note">
                <strong>Die Registrierung ist noch nicht offen.</strong> Konten werden derzeit von
                Hand angelegt
                {ANGABEN.kontakt ? (
                  <>
                    {' '}
                    — schreib an <a href={`mailto:${ANGABEN.kontakt}`}>{ANGABEN.kontakt}</a>
                  </>
                ) : null}
                .
              </p>
            )}
          </section>

          <figure className="lp-fenster">
            <figcaption className="lp-fenster-leiste">
              <span>Kartenansicht</span>
              <span aria-hidden="true">·</span>
              <span>zwei Gruppen, eine Tour</span>
            </figcaption>
            <img
              src={`${BASIS}karte.webp`}
              alt="Kartenausschnitt zwischen Hannover und Braunschweig: zwölf Standortnadeln in den Farben zweier Gruppen, zwei davon zweifarbig geteilt, dazu eine Tour mit sechs nummerierten Stopps als durchgezogene Linie entlang der Autobahn."
              width={1920}
              height={1013}
            />
            <figcaption>
              Nadeln in den Farben ihrer Gruppen. Wer zu zweien gehört, trägt beide.
            </figcaption>
          </figure>
        </div>

        {/* --- Das Problem ------------------------------------------------ */}
        <section className="lp-getoent" id="problem">
          <div className="lp-huelle lp-kapitel">
            <Kapitelrand nr="01" tt="Warum" />
            <div className="lp-kapitel-koerper">
              <h2 className="lp-aussage">
                Die Orte stehen in einer Tabelle. Die Reihenfolge steht <em>in einem Kopf</em>.
              </h2>
              <div className="lp-fliess">
                <p>
                  Wer feste Adressen abfährt, kennt das Bild: eine Liste in der Tabelle, eine
                  zweite Liste im Telefon, und die Frage, wer welches Gebiet hat, beantwortet immer
                  dieselbe Person. Fällt die aus, fällt die Planung aus.
                </p>
                <p>
                  Karten helfen erst, wenn man ihnen glauben kann. Deshalb macht mapper zwei Dinge
                  sichtbar, die andere verstecken: <b>woher jede Angabe stammt</b> und{' '}
                  <b>was die Anwendung nicht weiß</b>. Eine geschätzte Fahrzeit steht als
                  geschätzte Fahrzeit da, und eine Adresse, die nicht eindeutig war, wird
                  angezeigt, statt geraten zu werden.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* --- Arbeitstag -------------------------------------------------- */}
        <section id="arbeitstag">
          <div className="lp-huelle lp-kapitel">
            <Kapitelrand nr="02" tt="Ablauf" />
            <div className="lp-kapitel-koerper">
              <h2 className="lp-aussage">Ein Arbeitstag, in sechs Schritten.</h2>
              <ol className="lp-schritte">
                {ARBEITSTAG.map((s) => (
                  <li key={s.nummer}>
                    <span className="nr">{s.nummer}</span>
                    <h3>{s.titel}</h3>
                    <p>{s.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* --- Können ------------------------------------------------------ */}
        <section className="lp-getoent" id="kann">
          <div className="lp-huelle lp-kapitel">
            <Kapitelrand nr="03" tt="Ausserdem" />
            <div className="lp-kapitel-koerper">
              <h2 className="lp-aussage">Was sonst noch drin ist.</h2>
              <ul className="lp-karten">
                {KANN.map((k) => (
                  <li key={k.was} className="lp-karte">
                    <span className="marke">{k.marke}</span>
                    <h3>{k.was}</h3>
                    <p>{k.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* --- Herkunft ---------------------------------------------------- */}
        <section id="herkunft">
          <div className="lp-huelle lp-kapitel">
            <Kapitelrand nr="04" tt="Herkunft" />
            <div className="lp-kapitel-koerper">
              <h2 className="lp-aussage">Woher die Daten kommen.</h2>
              <div className="lp-fliess">
                <p>
                  Das ist der Teil, den die meisten Anbieter ins Kleingedruckte schreiben. Hier
                  steht er oben, weil er der Grund ist, mapper zu nehmen und nicht etwas anderes.
                </p>
              </div>
              <dl className="lp-herkunft">
                {HERKUNFT.map((h) => (
                  <div key={h.was}>
                    <dt>{h.was}</dt>
                    <dd>{h.woher}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* --- Grenzen ----------------------------------------------------- */}
        <section className="lp-getoent" id="grenzen">
          <div className="lp-huelle lp-kapitel">
            <Kapitelrand nr="05" tt="Grenzen" />
            <div className="lp-kapitel-koerper">
              <h2 className="lp-aussage">Was mapper nicht kann.</h2>
              <div className="lp-fliess">
                <p>
                  Vier Dinge, die man vorher wissen sollte. Wer sie braucht, ist hier falsch — und
                  soll das erfahren, bevor er seinen Bestand eintippt.
                </p>
              </div>
              <ul className="lp-karten">
                {GRENZEN.map((g) => (
                  <li key={g.was} className="lp-karte lp-grenze">
                    <h3>{g.was}</h3>
                    <p>{g.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* --- Preis ------------------------------------------------------- */}
        <section id="preis">
          <div className="lp-huelle lp-kapitel">
            <Kapitelrand nr="06" tt="Preis" />
            <div className="lp-kapitel-koerper">
              <div className="lp-preis">
                <span className="lp-etikett">Was es kostet</span>
                <span className="zahl">
                  {ANGABEN.preis || <em className="lp-offen">Noch nicht entschieden</em>}
                </span>
                <p>
                  Keine Testphase, die abläuft, und keine Zahl, die später erscheint. Die
                  laufenden Kosten sind klein, weil mapper auf offenen Daten und geteilten
                  Abrufen aufbaut — der Verkehrsstand wird einmal für alle geholt, nicht einmal
                  je Person.
                </p>
                {offen && (
                  <button type="button" className="lp-knopf" onClick={() => onAnmelden(true)}>
                    Konto anlegen <span className="pfeil" aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* --- Fragen ------------------------------------------------------ */}
        <section className="lp-getoent" id="fragen">
          <div className="lp-huelle lp-kapitel">
            <Kapitelrand nr="07" tt="Fragen" />
            <div className="lp-kapitel-koerper">
              <h2 className="lp-aussage">Fragen, die du jetzt hast.</h2>
              <dl className="lp-fragen">
                <div>
                  <dt>Wer steckt dahinter?</dt>
                  <dd>
                    {ANGABEN.betreiber ? (
                      <>
                        {ANGABEN.betreiber}. Die vollständigen Angaben stehen im{' '}
                        <a href={`${BASIS}impressum.html`}>Impressum</a>.
                      </>
                    ) : (
                      <em className="lp-offen">
                        Steht noch nicht fest — siehe{' '}
                        <a href={`${BASIS}impressum.html`}>Impressum</a>.
                      </em>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Was passiert mit meinen Standortdaten?</dt>
                  <dd>
                    Sie werden gespeichert, damit du sie wiederfindest — sonst nichts. Sie werden
                    nicht verkauft, nicht ausgewertet und nicht an Dritte weitergegeben. Was genau
                    wohin geht, steht in der{' '}
                    <a href={`${BASIS}datenschutz.html`}>Datenschutzerklärung</a>.
                  </dd>
                </div>
                <div>
                  <dt>Komme ich wieder raus?</dt>
                  <dd>
                    Jederzeit. Der Bestand lässt sich als GeoJSON oder CSV herunterladen,
                    vollständig und ohne Nachfrage. Was hineingeht, kommt auch wieder heraus.
                  </dd>
                </div>
                <div>
                  <dt>Brauche ich einen Schlüssel für Karten oder Adressen?</dt>
                  <dd>
                    Nein. Karte, Adresssuche und Routenberechnung laufen über offene Dienste, die
                    keinen Zugang verlangen. Wer eigene Rad- und Fußprofile möchte, kann einen
                    kostenlosen OpenRouteService-Schlüssel hinterlegen — nötig ist er nicht.
                  </dd>
                </div>
                <div>
                  <dt>Läuft das auf dem Telefon?</dt>
                  <dd>
                    Im Browser, ja — die Oberfläche ist für schmale Bildschirme gebaut. Eine App
                    zum Installieren gibt es nicht, und ohne Netz geht nichts.
                  </dd>
                </div>
                <div>
                  <dt>Kann ich mit Kollegen zusammenarbeiten?</dt>
                  <dd>
                    Ja. Ein Arbeitsbereich hat eine Mitgliederliste mit drei Rollen — lesen,
                    bearbeiten, verwalten. Alle sehen denselben Bestand; wer nur liest, ändert
                    nichts.
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* --- Abschluss --------------------------------------------------- */}
        <section>
          <div className="lp-huelle">
            <div className="lp-abschluss">
              <span className="lp-etikett">Loslegen</span>
              <h2>Eine Karte, die sagt, woher sie es weiß.</h2>
              <div className="lp-knopfreihe">
                {offen ? (
                  <button
                    type="button"
                    className="lp-knopf gross"
                    onClick={() => onAnmelden(true)}
                  >
                    Kostenlos anlegen <span className="pfeil" aria-hidden="true">→</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="lp-knopf gross"
                    onClick={() => onAnmelden(false)}
                  >
                    Anmelden <span className="pfeil" aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {fehlt.length > 0 && (
          /* Sichtbar und nicht versteckt: eine halbfertige Seite soll man
             ansehen koennen, ohne sie versehentlich fuer fertig zu halten.
             Verschwindet von allein, sobald angaben.ts ausgefuellt ist. */
          <section style={{ paddingTop: 0 }}>
            <div className="lp-huelle">
              <div className="lp-baustelle" role="note">
                <strong>Vor der Veröffentlichung fehlt noch:</strong> {fehlt.join(', ')}.
                Einzutragen in <code>src/features/landing/angaben.ts</code>.
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="lp-fuss lp-schicht">
        <div className="lp-huelle">
          <div className="lp-fuss-raster">
            <div>
              <span className="lp-marke">
                <BrandMark size={18} />
                mapper
              </span>
              <p>
                Standorte nach Kategorie und Gruppe auf der Karte, Touren daraus geplant. Diese
                Seite lädt keine Fremdschriften, keine Skripte von Dritten und keine Analytics.
              </p>
            </div>
            <div>
              <h2>Diese Seite</h2>
              <ul>
                <li><a href={`${BASIS}impressum.html`}>Impressum</a></li>
                <li><a href={`${BASIS}datenschutz.html`}>Datenschutz</a></li>
                {ANGABEN.quelltext && (
                  <li>
                    <a href={ANGABEN.quelltext} target="_blank" rel="noreferrer">
                      Quelltext
                    </a>
                  </li>
                )}
              </ul>
            </div>
            <div>
              <h2>Sanctora</h2>
              <ul>
                <li>
                  <a href="https://sanctora.eu" target="_blank" rel="noreferrer">
                    sanctora.eu
                  </a>
                </li>
                <li>
                  <a href="https://lotse.sanctora.eu" target="_blank" rel="noreferrer">
                    Lotse — Logbuch für Vorhaben
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="lp-fuss-schluss">
            <span>Karten: OpenStreetMap-Mitwirkende, Esri</span>
            <span>Verkehr: Autobahn GmbH des Bundes (dl-de/by-2-0)</span>
            <span>Postleitzahlen: OpenStreetMap (ODbL)</span>
            <span>Gebaut in Deutschland</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
