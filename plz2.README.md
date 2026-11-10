# plz2.geojson — die 95 zweistelligen Leitregionen

Umrisse der deutschen PLZ-Leitregionen (01 … 99), also die erste Ebene der
Postleitzahl. NICHT die einzelnen fünfstelligen Gebiete: davon gibt es rund
8.200, roh über 100 MB, und für eine Gebietsübersicht sind sie zu fein.

## Herkunft

OpenStreetMap, über <https://github.com/kibotu/umriss> (`data/plz-boundaries-2d.geojson`,
dort aus <https://github.com/tdudek/de-plz-geojson> aufgelöst).
**Lizenz: ODbL** — die Nennung von OpenStreetMap in der Kartenfußzeile deckt das ab.

## Was daran verändert wurde

Die Quelle hat 48.001 Stützpunkte in 853 KB. Für Umrisse auf Übersichtszoom ist
das weit mehr, als man sehen kann. Aufbereitet wurde mit
`scripts/build-plz2.mjs`:

- Douglas-Peucker mit 0,001° Toleranz (bei 51° Nord rund 80 m quer, 110 m hoch)
- Koordinaten auf 4 Nachkommastellen (~11 m) gerundet
- Ringe unter 2 km² verworfen — das waren 490 von 620, überwiegend Splitter,
  die als kurze Striche mitten in den Flächen sichtbar waren. Übrig bleiben
  130 Ringe: Außengrenzen, echte Inseln, echte Enklaven.

Ergebnis: 95 Flächen, 20.544 Punkte, 356 KB (~100 KB gzip). Alle 95 Regionen
sind erhalten — es wurde nur ausgedünnt, nie eine Region entfernt.

## Neu bauen

    node scripts/build-plz2.mjs

Lädt die Quelle, wendet dieselben Schritte an und schreibt `public/plz2.geojson`.
