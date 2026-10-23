# Missionslandkarte Explorer

**Alle Projekte der EU-Missionen in Österreich — durchsuchbar und anklickbar**

Entwickelt von der FFG (Österreichische Forschungsförderungsgesellschaft).

---

⚠️ **Work in Progress** — Dieses Projekt befindet sich im Aufbau.
Inhalte und Daten sind vorläufig und nicht als finale Aussagen der FFG zu verstehen.

---

## Was ist das?

Eine eigenständige Karte zum Erkunden: Jeder Punkt ist eine österreichische
Organisation in einem Projekt. Ein Klick öffnet die Projektkarte mit
Kurzbeschreibung, Koordination, allen österreichischen Beteiligten und deren Förderung.

Der Explorer ist **unabhängig von der Präsentation**
[missionslandkarte](https://github.com/missionmanagementunit/missionslandkarte)
und ersetzt sie nicht. Die Präsentation zählt Projekte, der Explorer zeigt Beteiligungen.

## Daten erzeugen

Die Karte liest `data/*.json`. Diese Dateien entstehen aus dem kuratierten Quell-Workbook
(liegt lokal, nicht im Repo) und den CORDIS-Bulk-Exporten:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env              # Pfad zum Workbook eintragen
./fetch_sources.sh                # CORDIS + Bundesländer-Grenzen nach cache/
.venv/bin/python build_explorer_data.py   # -> data/*.json, Bericht in reports/
.venv/bin/python geocode_orgs.py          # Adressen für Punkte auf Ortsebene (Netz, nur Neues)
.venv/bin/python build_explorer_data.py   # nochmals, damit die Adresspunkte übernommen werden
.venv/bin/python check_explorer_data.py   # Prüfungen, Exit-Code 1 bei Fehlern
```

Für EU-Projekte ist CORDIS die Quelle (Rollen, Förderung, Daten, Kurzbeschreibung).
Natürliche Personen (meist Einzelunternehmen) erscheinen so, wie CORDIS sie veröffentlicht.

## Lokal ansehen und prüfen

```bash
.venv/bin/python -m http.server 8765    # dann http://127.0.0.1:8765/ öffnen
```

`http://127.0.0.1:8765/?selftest=1` prüft im Browser, dass jede Beteiligung genau einmal als
Punkt erscheint (auch je Filter), dass Suche, Stapel-Liste und Deep Links funktionieren, und
schreibt das Ergebnis unten in die Seite. `#p=<Projekt-ID>` öffnet direkt eine Projektkarte.

## Entscheidungen

Warum der Explorer so gebaut ist — Datenquellen, Darstellung, bewusste Abweichungen von der
Präsentation — steht in [docs/ENTSCHEIDUNGEN.md](docs/ENTSCHEIDUNGEN.md).

## Datenquellen

- [CORDIS](https://cordis.europa.eu/) — Horizon 2020 / Horizon Europe (CC BY 4.0)
- [LIFE-Projektdatenbank](https://webgate.ec.europa.eu/life/publicWebsite/)
- [FFG-Projektdatenbank](https://projekte.ffg.at/)

Für Rückfragen: [ffg.at](https://www.ffg.at)
