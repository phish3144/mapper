/**
 * Die oeffentliche Startseite.
 *
 * Sie steht vor der Anmeldung und beantwortet die Frage, die eine
 * Anmeldemaske nicht beantworten kann: wozu das hier gut ist und worauf es
 * beruht.
 *
 * Drei Regeln, nach denen der Text gebaut ist:
 *
 * 1. Jede Aussage ist durch eine Funktion gedeckt, die es wirklich gibt.
 *    Was fehlt, steht unter "Was mapper nicht kann" - nicht, weil Demut
 *    huebsch aussieht, sondern weil eine Karte, die Sperrungen ANZEIGT, aber
 *    nicht einplant, sonst falsch verstanden wird.
 * 2. Zahlen statt Adjektive. "Alle zehn Minuten" und "ab 60 Nadeln" kann man
 *    nachzaehlen, "blitzschnell" nicht.
 * 3. Kein Knopf, der ins Leere fuehrt. Solange die Registrierung nicht
 *    nachweislich durchlaeuft, steht hier kein "Konto anlegen" - siehe
 *    ANGABEN.registrierungOffen.
 */
import BrandMark from '@/components/BrandMark'
import { ANGABEN, offenePunkte } from './angaben'

/** Ein Schritt des Arbeitstags. */
interface Schritt {
  nummer: string
  titel: string
  text: string
}

const ARBEITSTAG: Schritt[] = [
  {
    nummer: '1',
    titel: 'Bestand erfassen',
    text:
      'Standorte per Formular anlegen, auf die Karte klicken oder aus einer vorhandenen Datei einlesen — GeoJSON, CSV und KML, auch das aus Google My Maps. Vor dem Uebernehmen steht eine Vorschau: gefundene Adressen angehakt, nicht gefundene sichtbar. Verworfen kostet nichts, weil bis dahin nichts entstanden ist.',
  },
  {
    nummer: '2',
    titel: 'Einfärben',
    text:
      'Die Kategorie sagt, was für ein Ort das ist — Kunde, Lager, Baustelle. Die Gruppe sagt, wer zuständig ist — Team Nord, Team Süd. Ein Standort hat höchstens eine Kategorie, aber beliebig viele Gruppen: gehört er zweien, wird die Nadel der Länge nach geteilt und trägt beide Farben. Keine Gruppe ist die Hauptgruppe.',
  },
  {
    nummer: '3',
    titel: 'Zeiten hinterlegen',
    text:
      'Je Standort die Aufenthaltsdauer und die Öffnungszeiten, getrennt nach Wochentag. Wer erst ab 13 Uhr aufmacht, wird nicht um 9 eingeplant.',
  },
  {
    nummer: '4',
    titel: 'Tour bauen',
    text:
      'Stopps von Hand ordnen oder die Reihenfolge rechnen lassen. Der Fahrplan nennt Ankunft und Abfahrt je Stopp. Woher eine Fahrzeit stammt, steht dabei: gerechnete Strecke oder — wenn der Routendienst nicht antwortet — Luftlinie, dann sichtbar als "geschätzt".',
  },
  {
    nummer: '5',
    titel: 'Lage prüfen',
    text:
      'Sperrungen und Baustellen aller 108 Bundesautobahnen, alle zehn Minuten frisch. Dazu die zweistelligen PLZ-Leitregionen als Umriss, wenn Gebiete zwischen Teams aufgeteilt sind.',
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
      'Die Grenzen der 95 Leitregionen stammen aus OpenStreetMap (ODbL) und liegen fertig aufbereitet in der Anwendung. Sie werden erst geladen, wenn die Ebene eingeschaltet wird.',
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
      'Sperrungen und Baustellen liegen auf der Karte. In die Berechnung der Fahrzeiten fliessen sie nicht ein — die Tour ist nach freier Strecke geplant.',
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

export default function LandingPage({ onAnmelden }: { onAnmelden: () => void }) {
  const fehlt = offenePunkte()

  return (
    <div className="lp">
      <header className="lp-kopf">
        <span className="lp-marke">
          <BrandMark size={22} />
          mapper
        </span>
        <nav className="lp-kopf-nav">
          <a className="lp-link" href="#herkunft">
            Woher die Daten kommen
          </a>
          <a className="lp-link" href="#grenzen">
            Was fehlt
          </a>
          <button type="button" className="btn btn-primary" onClick={onAnmelden}>
            Anmelden
          </button>
        </nav>
      </header>

      <main>
        <section className="lp-held">
          <h1>
            Deine Standorte auf einer Karte,
            <br />
            die du nachprüfen kannst.
          </h1>
          <p className="lp-lead">
            mapper hält feste Standorte nach Kategorie und Gruppe auf der Karte und plant daraus
            Touren. Woher die Karte kommt, woher die Adressen kommen und wo die Daten liegen, steht
            weiter unten — und im offenen Quelltext an der Stelle, die es umsetzt.
          </p>

          <div className="lp-knoepfe">
            {ANGABEN.registrierungOffen ? (
              <button type="button" className="btn btn-primary lp-knopf-gross" onClick={onAnmelden}>
                Konto anlegen
              </button>
            ) : (
              <button type="button" className="btn btn-primary lp-knopf-gross" onClick={onAnmelden}>
                Anmelden
              </button>
            )}
            {ANGABEN.quelltext && (
              <a
                className="btn lp-knopf-gross"
                href={ANGABEN.quelltext}
                target="_blank"
                rel="noreferrer"
              >
                Quelltext ansehen
              </a>
            )}
          </div>

          {!ANGABEN.registrierungOffen && (
            /* Kein Knopf, der ins Leere fuehrt: solange die Bestaetigungsmail
               nicht ankommt, kommt auch niemand hinein, der sich neu anmeldet.
               Das gehört dorthin, wo sonst "jetzt loslegen" stünde. */
            <p className="lp-hinweis" role="note">
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

          <figure className="lp-bild">
            <img
              src={`${import.meta.env.BASE_URL}karte.webp`}
              alt="Kartenausschnitt zwischen Hannover und Braunschweig: zwölf Standortnadeln in den Farben zweier Gruppen, zwei davon zweifarbig geteilt, dazu eine Tour mit sechs nummerierten Stopps als durchgezogene Linie entlang der Autobahn."
              width={1920}
              height={1013}
              loading="lazy"
            />
            <figcaption className="lp-bildtext">
              Nadeln in den Farben ihrer Gruppen. Wer zu zweien gehört, trägt beide.
            </figcaption>
          </figure>
        </section>

        <section className="lp-abschnitt">
          <h2>Ein Arbeitstag</h2>
          <ol className="lp-schritte">
            {ARBEITSTAG.map((s) => (
              <li key={s.nummer}>
                <span className="lp-nummer" aria-hidden="true">
                  {s.nummer}
                </span>
                <div>
                  <h3>{s.titel}</h3>
                  <p>{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-abschnitt lp-abschnitt-getoent" id="herkunft">
          <h2>Woher die Daten kommen</h2>
          <p className="lp-abschnitt-lead">
            Das ist der Teil, den die meisten Anbieter ins Kleingedruckte schreiben. Hier steht er
            oben, weil er der Grund ist, mapper zu nehmen und nicht etwas anderes.
          </p>
          <dl className="lp-herkunft">
            {HERKUNFT.map((h) => (
              <div key={h.was}>
                <dt>{h.was}</dt>
                <dd>{h.woher}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="lp-abschnitt" id="grenzen">
          <h2>Was mapper nicht kann</h2>
          <p className="lp-abschnitt-lead">
            Vier Dinge, die man vorher wissen sollte. Wer sie braucht, ist hier falsch — und soll
            das erfahren, bevor er seinen Bestand eintippt.
          </p>
          <ul className="lp-grenzen">
            {GRENZEN.map((g) => (
              <li key={g.was}>
                <h3>{g.was}</h3>
                <p>{g.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-abschnitt lp-abschnitt-getoent">
          <h2>Fragen, die du jetzt hast</h2>
          <dl className="lp-fragen">
            <div>
              <dt>Was kostet das?</dt>
              <dd>
                {ANGABEN.preis || (
                  <em className="lp-offen">
                    Noch nicht entschieden. Solange hier nichts steht, entstehen auch keine Kosten.
                  </em>
                )}
              </dd>
            </div>
            <div>
              <dt>Wer steckt dahinter?</dt>
              <dd>
                {ANGABEN.betreiber ? (
                  <>
                    {ANGABEN.betreiber}. Die vollständigen Angaben stehen im{' '}
                    <a href={`${import.meta.env.BASE_URL}impressum.html`}>Impressum</a>.
                  </>
                ) : (
                  <em className="lp-offen">
                    Steht noch nicht fest — siehe{' '}
                    <a href={`${import.meta.env.BASE_URL}impressum.html`}>Impressum</a>.
                  </em>
                )}
              </dd>
            </div>
            <div>
              <dt>Was passiert mit meinen Standortdaten?</dt>
              <dd>
                Sie werden gespeichert, damit du sie wiederfindest — sonst nichts. Sie werden nicht
                verkauft, nicht ausgewertet und nicht an Dritte weitergegeben. Was genau wohin
                geht, steht in der{' '}
                <a href={`${import.meta.env.BASE_URL}datenschutz.html`}>Datenschutzerklärung</a>.
              </dd>
            </div>
            <div>
              <dt>Komme ich wieder raus?</dt>
              <dd>
                Jederzeit. Der Bestand lässt sich als GeoJSON oder CSV herunterladen, vollständig
                und ohne Nachfrage. Was hineingeht, kommt auch wieder heraus.
              </dd>
            </div>
          </dl>
        </section>

        {fehlt.length > 0 && (
          /* Sichtbar und nicht versteckt: eine halbfertige Seite soll man
             ansehen können, ohne sie versehentlich für fertig zu halten.
             Verschwindet von allein, sobald angaben.ts ausgefüllt ist. */
          <section className="lp-abschnitt">
            <div className="lp-baustelle" role="note">
              <strong>Diese Seite ist noch nicht fertig.</strong> Vor der Veröffentlichung fehlen:{' '}
              {fehlt.join(', ')}. Einzutragen in <code>src/features/landing/angaben.ts</code>.
            </div>
          </section>
        )}
      </main>

      <footer className="lp-fuss">
        <span className="lp-marke">
          <BrandMark size={18} />
          mapper
        </span>
        <nav className="lp-fuss-nav">
          <a href={`${import.meta.env.BASE_URL}impressum.html`}>Impressum</a>
          <a href={`${import.meta.env.BASE_URL}datenschutz.html`}>Datenschutz</a>
          {ANGABEN.quelltext && (
            <a href={ANGABEN.quelltext} target="_blank" rel="noreferrer">
              Quelltext
            </a>
          )}
        </nav>
        <span className="lp-fuss-quellen">
          Karten: OpenStreetMap-Mitwirkende, Esri · Verkehr: Autobahn GmbH des Bundes (dl-de/by-2-0)
        </span>
      </footer>
    </div>
  )
}
