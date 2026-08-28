# mapper

**Live: https://mapper-jet.vercel.app**
(Zweitausgabe auf GitHub Pages: https://phish3144.github.io/mapper/)

Web-Anwendung, um feste Standorte nach Kategorie auf einer Karte zu pflegen, sie
frei zu gruppieren und daraus Routen zu planen — manuell wie regelbasiert.

> **Zwei Einstellungen im Supabase-Dashboard.**
> 1. **Authentication → URL Configuration → Site URL** steht ab Werk auf
>    `http://localhost:3000`. Sie bestimmt, wohin Bestätigungs- und
>    Passwort-Links weiterleiten — deshalb landen sie sonst im Leeren.
>    Auf `https://mapper-jet.vercel.app` setzen und dieselbe Adresse unter
>    *Redirect URLs* eintragen (wer die Pages-Ausgabe ebenfalls nutzt, traegt
>    `https://phish3144.github.io/mapper/` zusaetzlich dort ein). (Die Bestätigung selbst funktioniert auch
>    ohne das: Supabase bestätigt das Konto, *bevor* es weiterleitet — nur die
>    Landeseite danach ist tot.)
> 2. Optional, aber empfohlen — siehe unten.
>
> **Zur E-Mail-Bestätigung.**
> Im Supabase-Projekt ist die E-Mail-Bestätigung aktiv (`mailer_autoconfirm: false`).
> Der eingebaute Mailversand des Free Tiers ist hart limitiert, die Bestätigungsmail
> kommt also in aller Regel nicht an — und ohne sie ist keine Anmeldung möglich.
> Abhilfe, einmalig: Supabase-Dashboard → **Authentication → Sign In / Providers →
> Email → „Confirm email" ausschalten**. Danach ist die Registrierung sofort nutzbar.
> Diese Einstellung liegt in GoTrue und lässt sich nicht per SQL oder Migration setzen.
>
> Das **erste** registrierte Konto wird automatisch App-Administrator und kann
> anschließend alle weiteren Konten selbst anlegen — dafür ist dann keine E-Mail
> mehr im Spiel, weil die Kontenverwaltung die Adressen direkt bestätigt.

## Was sie kann

**Standorte**
- Anlegen per Kartenklick, Adresssuche oder Import (GeoJSON, CSV)
- Genau eine Kategorie je Standort (Farbe und Symbol auf der Karte)
- Beliebig viele Gruppen je Standort (n:m) — Gruppen sind Sichten, keine Ordner
- Freie Schlagwörter, Notizen, Aktiv-Kennzeichen
- Aufenthaltsdauer und Öffnungszeiten als Zeitfenster je Wochentag

**Routen**
- Stopps von Hand zusammenstellen und per Ziehen und Ablegen umsortieren
- Reihenfolge automatisch optimieren (Rundreiseproblem), Start und Ziel fixierbar,
  Rundtour oder offene Route
- Regelbasiert füllen: „alle Standorte der Kategorie X in Gruppe Y im Umkreis von
  20 km" — ändert sich der Datenbestand, ändert sich die Route
- Zeitfenster und Aufenthaltsdauern gehen in die Ankunftszeiten ein; Verletzungen
  werden markiert. Die Optimierung minimiert **zuerst** Verletzungen und erst
  danach die Fahrzeit

**Zusammenarbeit**
- Arbeitsbereiche mit den Rollen Leser, Bearbeiter und Eigentümer
- Einladung per E-Mail-Adresse, ohne das Nutzerverzeichnis offenzulegen
- Sichtbarkeit je Objekt: für alle im Bereich, nur für Ausgewählte, oder privat
- App-Administratoren können Konten anlegen und verwalten

## Veröffentlichung

### Vercel — die Hauptausgabe

Projekt `mapper` im Team `phish3144's projects`, verknüpft mit diesem
Repository. Produktions-Branch ist `claude/standorte-routen-karte-ifidfy`
(zugleich der Standard-Branch); jeder Push dorthin löst ein neues
Produktions-Deployment aus.

Die Konfiguration steht in `vercel.json`: Build, Ausgabeordner, SPA-Rewrite,
unveränderliche Cache-Regeln für `/assets/*` und die Supabase-Werte als
Build-Variablen. Im Dashboard gesetzte Variablen haben Vorrang — dort gehört
auch `VITE_ORS_API_KEY` hin, falls echte Rad- und Fußprofile gewünscht sind.

Gegenüber GitHub Pages liegt die Anwendung hier im Wurzelpfad statt unter
`/mapper/`, weshalb `VITE_BASE` ungesetzt bleibt.

### GitHub Pages

Die Seite liegt auf GitHub Pages und wird vom Workflow `.github/workflows/deploy.yml`
bei jedem Push gebaut und in den Branch `gh-pages` geschrieben. Typecheck und Tests
laufen vorher; schlägt eines davon fehl, wird nichts veröffentlicht.

Der naheliegendere Weg über `actions/deploy-pages` funktioniert hier nicht: der
Actions-Token darf die Pages-Seite nicht selbst anlegen (`Resource not accessible by
integration`). Den Branch `gh-pages` bedient GitHub dagegen von sich aus.

## Einrichtung

```bash
pnpm install
cp .env.example .env      # enthält bereits die Werte des Projekts
pnpm dev
```

Die Anwendung läuft dann auf http://localhost:5173.

### Umgebungsvariablen

| Variable | Zweck |
|---|---|
| `VITE_SUPABASE_URL` | Projekt-URL. Öffentlich. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-Schlüssel. Öffentlich, abgesichert allein durch Row Level Security. |
| `VITE_OSRM_BASE_URL` | Routing-Server. Vorgabe: öffentlicher OSRM-Demoserver. |
| `VITE_ORS_API_KEY` | Optional. Schaltet OpenRouteService frei — nötig für **echte** Rad- und Fußprofile. |
| `VITE_NOMINATIM_BASE_URL` | Adresssuche. Vorgabe: öffentliches Nominatim. |

Der `service_role`-Schlüssel gehört **niemals** in eine dieser Variablen. Er lebt
ausschließlich in den Secrets der Edge Function.

## Wichtige Einschränkung beim Routing

Der öffentliche OSRM-Demoserver hat nur das **Fahrprofil** geladen. Die Profile
Rad und Fuß liefern dort nachweislich identische Werte:

```
driving -> 388.6 s / 3800.9 m
bike    -> 388.6 s / 3800.9 m
foot    -> 388.6 s / 3800.9 m
```

Die Anwendung weist im Routeneditor darauf hin, statt eine Genauigkeit
vorzutäuschen, die es nicht gibt. Für echte Profile gibt es zwei Wege:

1. `VITE_ORS_API_KEY` setzen (OpenRouteService, kostenlos, 2000 Anfragen/Tag)
2. Eine eigene OSRM-Instanz betreiben und `VITE_OSRM_BASE_URL` darauf zeigen

Beide Dienste sind Gemeingut mit begrenzter Kapazität — für den Dauerbetrieb mit
vielen Nutzern gehört eine eigene Instanz dazu.

## Aufbau

```
src/
  types/domain.ts      Fachliche Typen, Spiegel des Datenbankschemas
  lib/
    supabase.ts        Client und Übersetzung der Datenbankfehler
    db.ts              Datenzugriff, eine Funktion je Absicht
    store.ts           Datenspeicher (zustand)
    uiStore.ts         Oberflächenzustand: Auswahl, Filter, Kartenausschnitt
    geo.ts             Haversine, Hüllrechteck, Schwerpunkt
    routing/           OSRM- und ORS-Anbieter, Polyline, Matrix, Zwischenspeicher
    planner/           Reihenfolgeoptimierung und Zeitfensterrechnung (rein)
    rules.ts           Regel-Engine für dynamische Routen
    io/                GeoJSON- und CSV-Aus- und -Eingabe
    geocode.ts         Adresssuche über Nominatim
  features/            Oberfläche, nach Fachlichkeit geschnitten
supabase/
  migrations/          Versioniertes Datenbankschema
  functions/           Edge Function für die Kontenverwaltung
```

Die Aufteilung folgt einer Regel: alles unter `lib/planner`, `lib/rules.ts` und
`lib/io` ist **rein** — keine Netzwerkzugriffe, keine React-Abhängigkeit, keine
Datenbank. Genau diese Teile tragen die Logik, die schwer richtig zu bekommen
ist, und genau sie sind deshalb vollständig testbar.

## Tests

```bash
pnpm test        # vitest
pnpm typecheck   # tsc
pnpm build       # Produktionsbündel
```

## Datenbank

Das Schema liegt versioniert unter `supabase/migrations/` und ist auf das
Projekt bereits angewandt. Für ein neues Projekt genügt es, die Dateien in
aufsteigender Reihenfolge einzuspielen.

Zwei Eigenheiten sind bewusst so gebaut und in den Migrationen begründet:

- **Arbeitsbereiche werden über `create_workspace()` angelegt**, nicht per
  `INSERT`. Ein `INSERT .. RETURNING` zieht zusätzlich die `SELECT`-Policy heran,
  und die verlangt eine Mitgliedschaft, die erst der `AFTER INSERT`-Trigger
  anlegt — zum Prüfzeitpunkt gibt es sie noch nicht.
- **Die Rechteprüfung läuft über `SECURITY DEFINER`-Funktionen.** Läsen die
  Policies von `workspaces` und `workspace_members` direkt voneinander, riefen
  sie sich gegenseitig auf und Postgres bräche mit „infinite recursion detected
  in policy" ab.

Die Positionen der Routenstopps tragen eine `DEFERRABLE`-Eindeutigkeit, weil
Umsortieren zwangsläufig durch Zwischenzustände mit doppelten Positionen läuft.
Das Umsortieren selbst erledigt `reorder_route_stops()` in einem Statement —
`supabase-js` kann keine mehrteiligen Transaktionen fahren.

## Konten anlegen

Das erste registrierte Konto wird automatisch App-Administrator. Weitere Konten
legt es über die Kontenverwaltung an. Dahinter steht eine Edge Function, weil
das Anlegen von Konten den `service_role`-Schlüssel erfordert — der darf nicht
ins Browser-Bündel.

```bash
supabase functions deploy admin-users --project-ref iisiaoexusvoecytznwg
```

Siehe `supabase/functions/admin-users/README.md`.

## Karten- und Datenquellen

Die Kartendaten stammen von OpenStreetMap und seinen Mitwirkenden (ODbL). Die
Namensnennung ist in der Karte eingeblendet und darf nicht entfernt werden.

**Ausgeliefert werden die Kacheln bewusst nicht von `tile.openstreetmap.org`.**
Diese Server werden ehrenamtlich betrieben und sind laut
[Nutzungsrichtlinie](https://operations.osmfoundation.org/policies/tiles/) nicht
für fremde Anwendungen gedacht. Sie beantworten Anfragen dieser App mit einer
Kachel „403 Access blocked" — die Karte bleibt dann grau. Stattdessen:

| Ebene | Anbieter | Ausweichanbieter |
|---|---|---|
| Karte | CARTO Voyager | Esri World Street Map |
| Gelände | OpenTopoMap | Esri World Topo Map |
| Satellit | Esri World Imagery | — |

Liefert ein Anbieter nach vier Versuchen keine einzige Kachel, wechselt die
Karte selbsttätig auf den nächsten und sagt es in einer Meldung. Damit zeigt
sie auch dann etwas, wenn ein Netz oder ein Gerät einen der Dienste blockiert.

Nominatim erlaubt höchstens eine Anfrage pro Sekunde; die Adresssuche hält
diesen Abstand selbsttätig ein.
