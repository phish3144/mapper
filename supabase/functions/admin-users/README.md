# Edge Function `admin-users`

Kontenverwaltung für App-Administratoren: Konten anlegen, Passwörter setzen,
Administratorrechte vergeben und Konten löschen.

Das alles verlangt den `service_role`-Schlüssel. Der hebelt Row Level Security
vollständig aus und darf deshalb niemals ins Browser-Bündel — also läuft es
über diese Funktion, wo der Schlüssel in den Secrets liegt und den Server nie
verlässt.

## Sicherheitsmodell

Jede Anfrage durchläuft drei Stufen, bevor irgendetwas Privilegiertes passiert:

1. **Token lesen.** Ohne `Authorization: Bearer …` → `401`.
2. **Token prüfen.** Ein Client mit dem öffentlichen Schlüssel und dem
   Authorization-Header des Aufrufers ruft `auth.getUser()`. Ungültig oder
   abgelaufen → `401`.
3. **Rolle aus der Datenbank lesen.** Der `service_role`-Client prüft
   `profiles.is_app_admin` für diese Nutzer-ID. Kein Administrator → `403`.
   Was der Client über sich selbst behauptet, spielt nie eine Rolle.

`verify_jwt` bleibt eingeschaltet — die Funktion **nicht** mit
`--no-verify-jwt` ausrollen. Der OPTIONS-Preflight ist davon ausgenommen und
wird von der Funktion selbst beantwortet.

## Secrets

| Name | Herkunft |
| --- | --- |
| `SUPABASE_URL` | von Supabase automatisch gesetzt |
| `SUPABASE_SERVICE_ROLE_KEY` | von Supabase automatisch gesetzt |
| `SUPABASE_ANON_KEY` | von Supabase automatisch gesetzt |

Im gehosteten Projekt ist also nichts zu tun. Nur bei Eigenbetrieb müssen die
Werte gesetzt werden:

```bash
supabase secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=...
```

Fehlt `SUPABASE_ANON_KEY`, wird ersatzweise `SUPABASE_PUBLISHABLE_KEY` benutzt;
gibt es auch den nicht, dient der `service_role`-Schlüssel nur noch als
`apikey` für das Gateway. Die Rolle der Anfrage bestimmt in jedem Fall allein
der Authorization-Header, also das Token des Aufrufers.

Der `service_role`-Schlüssel gehört ausschließlich hierher — niemals in `.env`
oder in eine `VITE_*`-Variable.

## Ausrollen

Voraussetzung: [Supabase CLI](https://supabase.com/docs/guides/cli) und
`supabase login`.

```bash
# im Projektordner
supabase functions deploy admin-users --project-ref iisiaoexusvoecytznwg
```

Nach einem `supabase link --project-ref iisiaoexusvoecytznwg` genügt
`supabase functions deploy admin-users`.

Prüfen und Fehler suchen:

```bash
supabase functions list --project-ref iisiaoexusvoecytznwg
supabase functions logs admin-users --project-ref iisiaoexusvoecytznwg
```

Solange die Funktion nicht ausgerollt ist, zeigt die Kontenverwaltung in der
App genau diesen Deploy-Befehl an, statt einen Netzwerkfehler zu melden.

## Der erste Administrator

Er entsteht von selbst: Der Trigger `handle_new_user`
(`supabase/migrations/0005_admin_bootstrap_and_route_visibility.sql`) setzt beim
**ersten** registrierten Konto `is_app_admin = true`. Ohne diesen Bootstrap gäbe
es niemanden, der jemals einen weiteren Administrator ernennen könnte.

Alle weiteren Konten legt dieses Konto über die Kontenverwaltung in der App an
(Nutzermenü → Kontenverwaltung) — eine Registrierung durch die Person selbst ist
nicht vorgesehen.

Ist der Bootstrap verpasst worden (z. B. weil `profiles` schon Zeilen hatte),
hilft der SQL-Editor. Der Trigger `profiles_guard_admin_flag` verlangt, dass
`auth.uid()` bereits Administrator ist — im SQL-Editor gibt es kein `auth.uid()`,
deshalb muss er kurz aus dem Weg:

```sql
alter table public.profiles disable trigger profiles_guard_admin_flag;
update public.profiles set is_app_admin = true where lower(email) = 'admin@example.org';
alter table public.profiles enable trigger profiles_guard_admin_flag;
```

## Aufrufe

Ein `POST` mit JSON `{ action, ... }`. Die Antwort ist immer entweder
`{ "data": … }` oder `{ "error": "deutsche Meldung" }`.

| `action` | Rumpf | Antwort |
| --- | --- | --- |
| `list` | — | Liste aller Profile: `id`, `email`, `display_name`, `is_app_admin`, `created_at`, `workspace_count` |
| `create` | `email`, `password`, `display_name?`, `is_app_admin?`, `workspace_id?`, `role?` | das angelegte Konto in derselben Form |
| `reset-password` | `user_id`, `password` | `{ "ok": true }` |
| `set-admin` | `user_id`, `is_app_admin` | `{ "ok": true }` |
| `delete` | `user_id` | `{ "ok": true }` |

Statuscodes: `400` fehlerhafte Eingabe, `401` nicht angemeldet, `403` kein
App-Administrator, `404` unbekanntes Konto bzw. unbekannter Arbeitsbereich,
`405` andere Methode als POST, `409` die Operation würde etwas Unrettbares
anrichten (letzter Administrator, letzter Eigentümer), `500` Serverfehler.
Lehnt die Auth-API selbst ab, wird ihr Status durchgereicht — bei einer bereits
vergebenen E-Mail-Adresse ist das `422`. Ein Rumpf mit `error` gehört in jedem
Fall dazu, auch bei diesen Codes; die App zeigt daraus immer die Meldung an
und niemals den Statuscode.

### Beispiele mit curl

Zuerst ein Zugangstoken eines App-Administrators besorgen:

```bash
BASE=https://iisiaoexusvoecytznwg.supabase.co
KEY=sb_publishable_…                 # entspricht VITE_SUPABASE_PUBLISHABLE_KEY aus .env
FN=$BASE/functions/v1/admin-users

TOKEN=$(curl -s -X POST "$BASE/auth/v1/token?grant_type=password" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"admin@example.org","password":"geheim1234"}' | jq -r .access_token)
```

Konten auflisten:

```bash
curl -s -X POST "$FN" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"list"}'
```

Konto anlegen und gleich in einen Arbeitsbereich aufnehmen:

```bash
curl -s -X POST "$FN" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "action": "create",
        "email": "neu@example.org",
        "password": "mindestens8",
        "display_name": "Neue Person",
        "workspace_id": "00000000-0000-0000-0000-000000000000",
        "role": "editor"
      }'
```

Passwort neu setzen:

```bash
curl -s -X POST "$FN" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"reset-password","user_id":"…","password":"neuesPasswort"}'
```

Administratorrechte vergeben oder entziehen:

```bash
curl -s -X POST "$FN" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"set-admin","user_id":"…","is_app_admin":true}'
```

Konto löschen:

```bash
curl -s -X POST "$FN" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"delete","user_id":"…"}'
```

## Eigenheiten, die man kennen sollte

- **Kein Mailversand.** Konten werden mit `email_confirm: true` angelegt und
  sind sofort nutzbar; das Passwort gibt der Administrator selbst weiter. Auf
  dem Free Tier wäre der Mailversand ohnehin stark begrenzt.
- **Passwörter** brauchen mindestens 8 Zeichen — dieselbe Grenze wie im
  Formular der App.
- **`is_app_admin` läuft über `public.set_app_admin()`**, nicht über ein
  direktes `UPDATE`: Auf `profiles` liegt der Trigger `profiles_guard_admin_flag`,
  der eine Änderung des Feldes nur zulässt, wenn `auth.uid()` bereits
  Administrator ist. Das `service_role`-Token trägt keinen `sub`-Claim,
  `auth.uid()` wäre also `NULL` und das UPDATE liefe in genau diesen Trigger.
- **Der letzte App-Administrator** kann seine Rechte nicht abgeben (`409`) —
  sonst könnte nie wieder jemand einen ernennen.
- **Das eigene Konto** lässt sich hier nicht löschen (`400`).
- **Konten mit eigenen Arbeitsbereichen** lassen sich nicht löschen (`409`).
  `workspaces.created_by` hängt mit `ON DELETE CASCADE` am Konto: Der
  Arbeitsbereich würde mitsamt Kategorien, Standorten und Routen verschwinden,
  und der Trigger `guard_last_owner` bricht diese Kaskade ohnehin ab. Dasselbe
  gilt, wenn das Konto irgendwo alleiniger Eigentümer ist. Die Funktion prüft
  beides vorher und antwortet mit einer Meldung, mit der man etwas anfangen
  kann, statt mit einem rohen Datenbankfehler.
  Von der Person angelegte Standorte, Kategorien, Gruppen und Routen bleiben
  dagegen erhalten (`created_by` wird auf `NULL` gesetzt).
- **CORS-Header hängen an jeder Antwort**, auch an den Fehlern. Fehlten sie
  dort, sähe der Browser statt der eigentlichen Meldung nur einen
  undurchsichtigen CORS-Fehler. Die erlaubten Anfrage-Kopfzeilen entsprechen
  dem, was supabase-js von sich aus mitschickt (`authorization`, `apikey`,
  `x-client-info`, `content-type`, `x-region`, `x-retry-count` sowie die
  Trace-Kopfzeilen). Fehlt dort eine, scheitert bereits der Preflight.
- **Die Kontenliste wird seitenweise gelesen.** PostgREST deckelt jede Antwort
  auf die im Projekt eingestellte Zeilenzahl (Voreinstellung 1000). Ohne
  Blättern zählte `workspace_count` ab dieser Grenze stillschweigend falsch.
