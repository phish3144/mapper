# geocode — Bote für die Adresssuche

## Warum

Der Browser fragte die Geocoder bisher unmittelbar. In manchen Netzen ist
`nominatim.openstreetmap.org` gesperrt — Werbeblocker, DNS-Filter, Firewall.
Von außen lässt sich das weder erkennen noch beheben. Über diese Funktion
spricht der Browser nur noch mit der Supabase-Adresse, die er ohnehin erreicht.

Drei Dinge kommen hinzu, die im Browser unmöglich sind:

1. **Ein Zwischenspeicher, den alle Nutzer teilen** (`public.geocode_cache`).
   Die zweite Suche nach derselben Straße braucht keinen Anruf nach draußen.
2. **Eine ehrliche Kennung** (`User-Agent`). Nominatims Nutzungsrichtlinie
   verlangt sie; Browser verbieten es, diesen Kopf zu setzen.
3. **Eine gemeinsame Bremse** (`public.geocode_throttle`). Sobald der Server
   fragt, teilen sich alle Nutzer eine Kennung — ohne Absprache überschritten
   schon drei gleichzeitige Suchen Nominatims Grenze von einer Anfrage je
   Sekunde und brächten die ganze Anwendung in die Sperre.

## Was sie nicht tut

Sie wertet die Antworten **nicht** aus, sondern reicht den Rohtext des Dienstes
durch. Die Auswertung bleibt damit an einer Stelle — im Client, wo sie getestet
ist — statt in zwei Sprachen doppelt zu existieren.

## Aufruf

```http
POST /functions/v1/geocode
Authorization: Bearer <Sitzungstoken einer angemeldeten Person>

{ "q": "Horstwiesen 14, 29336 Nienhagen", "limit": 8 }
{ "q": "Hauptstraße 1", "limit": 8, "countryCodes": "de,at,ch" }
{ "structured": { "street": "Horstwiesen 14", "postalcode": "29336" }, "limit": 8 }
{ "q": "Nienhagen", "provider": "photon" }
```

`countryCodes` schränkt auf Länder ein (nur Nominatim, nur die freie Suche —
genau wie auf dem Direktweg) und geht in den Cache-Schlüssel ein: dieselbe
Anfrage liefert mit und ohne Einschränkung andere Treffer. Nicht anerkannte
Werte werden stillschweigend verworfen, es muss aus genau zwei Buchstaben
bestehen.

Antwort:

```json
{ "data": { "provider": "nominatim", "body": [ ... ], "cached": true } }
```

`provider` ist `auto` (Vorgabe), `nominatim` oder `photon`. Bei `auto` wird
Nominatim bevorzugt; ist es gerade gebremst, geht die Anfrage sofort an Photon,
statt zu warten — Warten wäre genau die Verzögerung, die diese Funktion
beseitigen soll.

## Sicherheit

`verify_jwt` ist an, und die Funktion prüft zusätzlich, dass der Token ein
**Subjekt** trägt und die Rolle `authenticated` hat. Grund: Der Gateway
akzeptiert jeden für das Projekt gültigen Token — auch den öffentlichen
`anon`-Schlüssel. Ohne diese Zusatzprüfung wäre der Bote ein offener
Geocoding-Dienst für jedermann.

## Ausrollen

```bash
supabase functions deploy geocode --project-ref iisiaoexusvoecytznwg
```

Die Migrationen `0009_geocode_cache_and_throttle.sql` und
`0010_geocode_read_and_throttle_fix.sql` müssen eingespielt sein. Weitere
Secrets sind nicht nötig: `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` setzt
Supabase selbst.

Die Funktion spricht die Tabellen nicht unmittelbar an, sondern über drei
`SECURITY DEFINER`-Funktionen, auf die nur `service_role` Ausführungsrecht hat:

| Funktion | Aufgabe |
| --- | --- |
| `geocode_cache_read(key)` | Liest den Eintrag, prüft den Ablauf und zählt den Treffer — in einer einzigen Abfrage. |
| `geocode_may_call(provider, min_ms)` | Fragt und vermerkt den Ruf in einem Zug. Das bedingte `UPDATE` ist der Kern: zwei gleichzeitige Aufrufe können nicht beide `true` bekommen. |
| `geocode_cache_sweep()` | Räumt abgelaufene Einträge ab. |

## Abschalten

`VITE_GEOCODE_PROXY=off` im Frontend. Der Client fragt dann wieder unmittelbar.
Dasselbe geschieht selbsttätig, wenn die Funktion nicht erreichbar ist: Nach
dem ersten Fehlschlag wird für den Rest der Sitzung der Direktweg genommen —
ein fehlender Bote darf die Suche nicht verhindern. Eine Anmeldung setzt diese
Abschaltung zurück: Wer vor dem Anmelden gesucht hat, bekam zwangsläufig eine
Abfuhr, und die soll nicht die ganze Sitzung nachwirken.
