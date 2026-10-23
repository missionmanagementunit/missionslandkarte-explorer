# Entscheidungen

Warum der Explorer so gebaut ist, wie er ist. Jeder Eintrag hält fest, **was** entschieden wurde,
**warum**, und **was daraus folgt** — damit spätere Änderungen nicht unbeabsichtigt etwas zurückdrehen,
das bewusst so gewählt wurde.

Neue Entscheidungen unten anfügen (nächste Nummer, Datum, Commit). Wird eine Entscheidung später
geändert, den alten Eintrag nicht löschen, sondern mit „Ersetzt durch E…“ markieren.

---

## E01 · Eigenes Repository, ersetzt die Präsentation nicht

*2026-10-22 · Commit be787a3*

**Entscheidung:** Der Explorer lebt in einem eigenen Repository und ist ein eigenständiges Produkt.
Die Präsentation [missionslandkarte](https://github.com/missionmanagementunit/missionslandkarte)
bleibt unverändert bestehen.

**Warum:** Die Präsentation ist für einen Vortrag gebaut (Folien, Pfeiltasten, Videos), der Explorer
zum selbstständigen Erkunden. Unterschiedliche Datenbasis, unterschiedlicher Lebenszyklus.

**Folgen:** Gemeinsame Teile (Farben, Logos, Österreich-Maske) sind einmalig **kopiert**, nicht geteilt.
Änderungen an einem Projekt wirken nicht automatisch im anderen.

---

## E02 · Punkte sind Beteiligungen, die Karte zeigt das ganze Projekt

*2026-10-19 · Commit af6ae89 / e114546*

**Entscheidung:** Jeder Punkt ist **eine österreichische Organisation in einem Projekt**. Ein Klick
öffnet die Projektkarte mit Koordination und **allen** österreichischen Beteiligten.

**Warum:** Das Quell-Workbook führt pro Projekt nur eine (kuratierte) Organisation. Das stellt
Projekte falsch dar — Beispiel DANUBE4all: koordiniert von der BOKU, im Workbook aber mit dem
Amt der NÖ Landesregierung geführt, das laut CORDIS nur assoziierter Partner ist.

**Folgen:** 1.193 Projekte, 1.692 Beteiligungen. Die Präsentation zählt weiterhin Projekte —
Zahlen beider Seiten sind daher nicht direkt vergleichbar. Koordinatoren im Ausland stehen nur
**auf der Projektkarte**, nicht als Punkt.

---

## E03 · Für EU-Projekte ist CORDIS die Quelle, nicht das Workbook

*2026-10-22 · Commit af6ae89*

**Entscheidung:** Rollen, Förderbeträge, Laufzeiten und Kurzbeschreibungen von EU-Projekten kommen
aus den CORDIS-Bulk-Exporten. Das Workbook dient nur dazu, die kuratierte Organisation zuzuordnen.

**Warum:** Der Vergleich zeigte systematische Abweichungen im Workbook — 66 als „Participant“
geführte Organisationen sind laut CORDIS assoziierte Partner (47) oder verbundene Dritte (19).
Vier kuratierte Organisationen sind in CORDIS gar nicht (mehr) gelistet.

**Folgen:**
- Abweichungen werden im lokalen Bericht (`reports/`, nicht im Repo) aufgelistet, **nicht** im Explorer korrigiert.
- Die vier nicht gelisteten Organisationen bleiben sichtbar, markiert mit `cordis_listed: false` („in CORDIS nicht gelistet“).
- Für FFG, LIFE und Sonstige gibt es nur die eine kuratierte Zeile; die Karte vermerkt „Weitere Partner sind in dieser Quelle nicht erfasst“.
- CORDIS setzt Semikolons im Kurzbeschreibungsfeld nicht in Anführungszeichen; das Build-Skript repariert das über die feste Feldanzahl.

---

## E04 · Bezeichnungen für den Förderstatus

*2026-10-19 und 2026-10-22*

**Entscheidung:**

| Fall | Anzeige |
|---|---|
| Betrag vorhanden (EU, LIFE) | Euro-Betrag der Organisation |
| EU, assoziierter Partner ohne Betrag | „Assoziierter Partner – ohne EU-Förderung“ |
| EU, verbundener Dritter | „Verbundener Dritter – Förderung über Partner“ |
| FFG | „Förderung nicht öffentlich“ |
| LIFE, ausdrücklich als Sachleistung belegt | „In-kind“ |

**Warum:** Ein Betrag von 0 € bedeutet bei EU-Projekten meist „assoziierter Partner“, nicht
„Sachleistung“. Verbundene Dritte haben in CORDIS keinen eigenen Betrag.

**Folgen:** „In-kind“ wird **nie aus dem Fehlen eines Betrags geschlossen**, nur gesetzt, wenn eine
Quelle es ausdrücklich nennt. Derzeit gibt es keinen solchen Fall. LIFE ist nicht in CORDIS enthalten;
für LIFE-Partner fehlt bisher eine Quelle mit Beträgen je Organisation.

---

## E05 · Natürliche Personen erscheinen wie in CORDIS

*2026-10-22 · Commit af6ae89*

**Entscheidung:** Natürliche Personen (meist Einzelunternehmen) werden mit Namen angezeigt, so wie
CORDIS sie veröffentlicht.

**Warum:** Die Angaben sind öffentlich verfügbar. Eine zunächst gebaute Anonymisierung wurde
deshalb wieder entfernt.

**Folgen:** Für vier Personen veröffentlicht CORDIS weder Ort noch Koordinaten (Punkt im
Landesmittelpunkt). Sie stehen nur auf der Projektkarte, mit „Standort nicht veröffentlicht“,
und haben keinen Punkt auf der Karte.

---

## E06 · Koordinaten: Herkunft angeben, Fehler über das Bundesland erkennen

*2026-10-22 · Commit af6ae89*

**Entscheidung:**
- Jede Beteiligung trägt ihre Herkunft in `geo_source`: `cordis`, `org_match` (über den Namen einer CORDIS-Organisation), `city` (nur Ortsebene) oder `none`.
- Liegt ein CORDIS-Punkt **nicht im angegebenen Bundesland**, gilt er als falsch und wird durch Ortskoordinaten ersetzt.
- Wo schon der NUTS-Code falsch ist, gibt es eine geprüfte Korrektur anhand von Postleitzahl und Straße (`ORG_GEO_CORRECTIONS`).
- Der Landesmittelpunkt (47,20003 / 13,19996) gilt als fehlende Koordinate.

**Warum:** Rund 1 % der CORDIS-Koordinaten liegen im falschen Ort (z. B. Wiener Adressen in
Wiener Neustadt). Ohne Herkunftsangabe wäre nicht erkennbar, wie genau ein Punkt ist.

**Folgen:** 30 Punkte wurden ersetzt, 3 von Hand korrigiert. Fehler innerhalb desselben
Bundeslandes erkennt die Regel nicht. Die Bundesländer-Polygone müssen Löcher behalten —
Wien ist ein Loch in Niederösterreich. Punkte auf Ortsebene werden seit E13 über die Adresse verbessert.

---

## E07 · Ausgeschiedene Partner bleiben sichtbar

*2026-10-22*

**Entscheidung:** Organisationen, die laut CORDIS aus einem Projekt ausgeschieden sind, bleiben mit
dem Vermerk „ausgeschieden“ in der Liste.

**Warum:** Sie haben bis zum Ausscheiden mitgearbeitet und meist Förderung erhalten.

---

## E08 · Kein Build-Schritt, feste Bibliotheksversionen

*2026-10-22 · Commit e114546*

**Entscheidung:** Statische Seite ohne Bundler, Vanilla JavaScript, Leaflet 1.9.4 und
Leaflet.markercluster 1.5.3 von unpkg mit fester Version.

**Warum:** Wie die Präsentation — einfach zu warten, läuft auf GitHub Pages ohne Werkzeugkette.

**Folgen:** Leaflet selbst ist BSD-2-lizenziert und läuft nicht ab. Das **Risiko liegt bei den
Kartenkacheln**: Sie kommen vom schlüssellosen Esri-Dienst; Esris Nutzungsbedingungen gelten, die
zugehörige Esri-Leaflet-Ebene ist als veraltet markiert. CARTO hat 2026 bereits einen Schlüssel
verlangt. Geplant ist, die Kacheln selbst zu hosten (Protomaps-Ausschnitt Österreich).

---

## E09 · Gestaltung wie die Präsentation, aber kombinierbare Filter

*2026-10-22 · Commit fc3cbe9, a15ba9e*

**Entscheidung:** Der Explorer übernimmt das Design-System der Präsentation (dunkle Kopfzeile,
Seitenleiste mit der Legende von Folie 2, Projektkarte im Stil der Präsentationskacheln).
Abweichend davon lassen sich **eine Mission und beliebig viele Bundesländer kombinieren**.

**Warum:** Gleiches Erscheinungsbild für beide Produkte. Kombinationen („Gesunde Böden in Tirol“)
sind zum Erkunden wichtiger als in der Präsentation.

**Folgen:**
- Umschalten zwischen „Nach Mission“ und „Nach Bundesland“ löscht keinen Filter; aktive Filter stehen als entfernbare Markierungen über der Liste.
- Die Zahlen der Legende zählen Projekte und berücksichtigen die jeweils anderen Filter.
- Ist **genau ein** Bundesland gewählt, füllt es die Karte; bei keinem oder mehreren zeigt die Karte ganz Österreich.
- Beim Übernehmen fiel ein Fehler der Präsentation auf: Wien wird dort dunkel dargestellt (doppelt ausgeschnitten). Im Explorer behoben, in der Präsentation nicht.

---

## E10 · Nur Laufzeitdateien werden veröffentlicht

*2026-10-22 · Commit be787a3*

**Entscheidung:** Der Pages-Workflow kopiert nur `index.html`, `css/`, `js/`, `assets/` und
`data/*.json`. Das Quell-Workbook liegt nie im Repository; sein Pfad steht in `.env`.

**Warum:** Das Repository ist öffentlich. In der Präsentation wurden 2026 versehentlich interne
Dateien über Pages ausgeliefert und mussten aus der Git-Historie entfernt werden.

**Folgen:** Neue Laufzeitdateien müssen im Schritt „Stage site files“ des Workflows ergänzt werden.

---

## E11 · Versionsangabe aus dem Commit

*2026-10-22 · Commit 187136c*

**Entscheidung:** Die Fußzeile der Seitenleiste zeigt „Version ‹Commit› · ‹Datum›“, verlinkt auf den
Commit. Der Workflow schreibt die Angabe beim Veröffentlichen in `js/version.js`; lokal steht
„Version: lokal“.

**Warum:** So lässt sich jederzeit prüfen, welcher Stand live ist — ohne Versionsnummer, die man
von Hand pflegen und vergessen kann.

---

## E12 · Prüfungen statt Vertrauen

*2026-10-22*

**Entscheidung:** Zwei Prüfungen begleiten jede Änderung:
- `check_explorer_data.py` prüft die Daten (Vollständigkeit, eine Koordination je EU-Projekt, jeder Punkt im angegebenen Bundesland, keine internen Felder).
- `?selftest=1` prüft die echte Seite im Browser (jeder Punkt genau einmal, auch je Filter; Projektkarte; Suche; Stapel-Liste; Zoom; kein seitliches Scrollen).

**Warum:** Mehrere Fehler wurden nur durch diese Prüfungen gefunden, darunter ein still
fehlendes Projekt und falsch berechnete Kartengrößen auf dem Handy.

**Folgen:** Eine Änderung gilt erst als fertig, wenn beide Prüfungen bestehen — auch auf der
Live-Seite.

---

## E13 · Punkte auf Ortsebene über die Adresse verbessern

*2026-10-23*

**Entscheidung:** Organisationen, deren Punkt nur auf Ortsebene liegt, werden über ihre Adresse
geokodiert (OpenStreetMap/Nominatim). „Ortsebene“ heißt: als `city` markiert, **oder** ein Punkt,
den sich zwei oder mehr verschiedene Organisationen teilen — CORDIS schreibt Ortsmittelpunkte so,
als wären sie genau. Die Adresse stammt aus dem CORDIS-Eintrag der Organisation, sonst aus einer
gleichnamigen österreichischen CORDIS-Organisation, zuletzt aus einer Suche nach Name und Ort.

**Warum:** 347 Beteiligungen von 57 Organisationen lagen auf einem einzigen Punkt in der Wiener
Innenstadt (Universität Wien, AIT, MedUni Wien und weitere), dazu kleinere Stapel in anderen Städten.

**Regeln:**
- Ein Treffer zählt nur, wenn er genauer ist als der Ort und im Bundesland der Beteiligung liegt.
- Ausnahme: Stammt der Treffer aus der **eigenen** CORDIS-Adresse und bestätigt die Postleitzahl ein anderes Bundesland, ist das angegebene Bundesland falsch, nicht der Treffer. Dann wird das Bundesland korrigiert (z. B. UMIT → Tirol, SCCH Hagenberg → Oberösterreich, Danube Private University → Niederösterreich; zuvor alle als „Wien“ geführt).
- Jedes Ergebnis, auch jeder Fehlschlag, steht in `build_inputs/org_geocodes.json`; abgefragt wird nur, was dort fehlt (`geocode_orgs.py`, braucht Netz). Der Build selbst bleibt offline.

**Folgen:** 624 Beteiligungen von 151 Organisationen liegen jetzt an ihrer Adresse (`geo_source: "address"`),
19 Beteiligungen haben ein korrigiertes Bundesland, 468 statt 380 verschiedene Punkte. Große Stapel
sind jetzt jeweils **eine** Organisation an ihrer Adresse. Organisationen mit mehreren Standorten
(z. B. AIT: Wien, Seibersdorf, Tulln) erscheinen an der Adresse ihres CORDIS-Eintrags, nicht am
Standort des jeweiligen Instituts. Die Quellenangabe nennt OpenStreetMap (ODbL).

**Nichts wird verworfen:** Ersetzt die Adresse einen Punkt, bleibt der ursprüngliche in
`source_lat`, `source_lng` und `source_geo` erhalten; ein korrigiertes Bundesland behält seinen alten
Wert in `source_bundesland`. Bei allen anderen Beteiligungen sind diese Felder leer (`null`).
`check_explorer_data.py` prüft, dass jeder Adresspunkt seinen ursprünglichen Punkt mitführt.

---

## Bekannte Grenzen

- **Punkte auf Ortsebene:** 90 Beteiligungen von 62 Organisationen liegen weiterhin auf Ortsebene, vor allem FFG-Partner, für die keine Quelle eine Adresse hat — 61 davon auf dem Wiener Ortspunkt. Adressen lassen sich bei Bedarf von Hand nachtragen.
- **FFG- und LIFE-Projekte:** nur die koordinierende Organisation ist erfasst.
- **Zwei Platzhalter-IDs** im Workbook (Tumorzentrum Oberösterreich, ListenIN) erscheinen unverändert.
- **Kartenkacheln** von einem externen Dienst, siehe E08.
