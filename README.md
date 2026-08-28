# mapper

Web-Anwendung, um feste Standorte nach Kategorie auf einer Karte zu pflegen, sie
frei zu gruppieren und daraus Routen zu planen — manuell wie regelbasiert.

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

Kartenkacheln und Geodaten stammen von OpenStreetMap und seinen Mitwirkenden
(ODbL). Die Namensnennung ist in der Karte eingeblendet und darf nicht entfernt
werden. Nominatim erlaubt höchstens eine Anfrage pro Sekunde; die
Adresssuche hält diesen Abstand selbsttätig ein.
