"""
Prüft die Ausgaben von build_explorer_data.py — unabhängig davon, wie sie entstanden sind.
Bricht mit Exit-Code 1 ab, sobald ein Prüfpunkt scheitert. Hinweise (WARN) brechen nicht ab.

Ausführung:
    .venv/bin/python check_explorer_data.py
"""

import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

from geo_utils import bundesland_at, load_bundesland_polygons

PROJECT_DIR = Path(__file__).resolve().parent
ENV_FILE = PROJECT_DIR / ".env"
DATA_DIR = PROJECT_DIR / "data"
XLSX_SHEET = "Tabelle1"

MISSIONS = {"climate", "cities", "cancer", "soil", "water"}
SOURCES = {"eu_fp", "ffg", "life", "other"}
ROLES = {"coordinator", "sole_applicant", "participant", "partner", "thirdParty",
         "associatedPartner", "internationalPartner", None}
FUNDING_STATUSES = {"amount", "no_eu_funding", "third_party", "not_public", "in_kind", "unknown"}
GEO_SOURCES = {"cordis", "org_match", "city", "none"}
BUNDESLAENDER = {"Burgenland", "Kärnten", "Niederösterreich", "Oberösterreich", "Salzburg",
                 "Steiermark", "Tirol", "Vorarlberg", "Wien"}

PROJECT_KEYS = {"id", "acronym", "title", "mission", "source", "programme", "start", "end",
                "link", "coordinator", "partners_complete"}
PARTICIPATION_KEYS = {"project_id", "org_id", "name", "role", "city", "bundesland", "lat", "lng",
                      "geo_source", "funding_eur", "funding_status", "ended", "cordis_listed"}

# Interne Spalten des Workbooks dürfen nie als Feld auftauchen. Als Text-Suche wären sie
# unbrauchbar — "confidence" und "Auswahl" sind auch normale Wörter in Kurzbeschreibungen.
FORBIDDEN_KEYS = {"Confidence", "Betrag_Quelle", "Auswahl", "Organisation Type", "Pariticpant Type"}
# Platzhalter des Workbooks für natürliche Personen — im Explorer steht stattdessen der CORDIS-Name.
FORBIDDEN_TEXT = ["NATURAL PERSON", "PERSONNE PRIVEE"]

# Prüffall aus der Planung: Danube4All wird von der BOKU koordiniert,
# die kuratierte Organisation (Amt der NÖ Landesregierung) ist assoziierter Partner.
DANUBE4ALL_ID = "101093985"

# Punkte, deren Bundesland laut Polygon vom angegebenen abweichen darf — mit Begründung.
BUNDESLAND_MISMATCH_ALLOWED = {}

failures, warnings = [], []


def fail(message):
    """Record a failed check."""
    failures.append(message)


def warn(message):
    """Record a non-blocking note."""
    warnings.append(message)


def load_outputs():
    """Load the four output files."""
    projects = json.loads((DATA_DIR / "projects.json").read_text(encoding="utf-8"))
    participations = json.loads((DATA_DIR / "participations.json").read_text(encoding="utf-8"))
    abstracts = json.loads((DATA_DIR / "abstracts.json").read_text(encoding="utf-8"))
    meta = json.loads((DATA_DIR / "meta.json").read_text(encoding="utf-8"))
    return projects, participations, abstracts, meta


def check_schema(projects, participations):
    """Every record has exactly the expected keys and only allowed enumeration values."""
    for p in projects:
        if set(p) != PROJECT_KEYS:
            fail(f"Projekt {p.get('id')}: Felder {sorted(set(p) ^ PROJECT_KEYS)} weichen ab")
        if p["mission"] not in MISSIONS:
            fail(f"Projekt {p['id']}: unbekannte Mission {p['mission']!r}")
        if p["source"] not in SOURCES:
            fail(f"Projekt {p['id']}: unbekannte Quelle {p['source']!r}")
        if not p["acronym"] or not p["title"] or not p["link"]:
            fail(f"Projekt {p['id']}: Kürzel, Titel oder Link leer")
    for x in participations:
        if set(x) != PARTICIPATION_KEYS:
            fail(f"Beteiligung {x.get('project_id')}/{x.get('name')}: Felder weichen ab")
        if x["role"] not in ROLES:
            fail(f"Beteiligung {x['project_id']}/{x['name']}: unbekannte Rolle {x['role']!r}")
        if x["funding_status"] not in FUNDING_STATUSES:
            fail(f"Beteiligung {x['project_id']}/{x['name']}: unbekannter Förderstatus {x['funding_status']!r}")
        if x["geo_source"] not in GEO_SOURCES:
            fail(f"Beteiligung {x['project_id']}/{x['name']}: unbekannte Geo-Quelle {x['geo_source']!r}")
        if x["bundesland"] is not None and x["bundesland"] not in BUNDESLAENDER:
            fail(f"Beteiligung {x['project_id']}/{x['name']}: unbekanntes Bundesland {x['bundesland']!r}")


def check_completeness(projects, participations, source_ids):
    """Gate 1+2: all workbook projects present exactly once, every project has participants and a dot."""
    ids = [p["id"] for p in projects]
    if len(ids) != len(set(ids)):
        fail(f"Doppelte Projekt-IDs: {[i for i, c in Counter(ids).items() if c > 1]}")
    if set(ids) != source_ids:
        fail(f"Projekt-IDs ≠ Workbook: fehlen {sorted(source_ids - set(ids))[:10]}, "
             f"zusätzlich {sorted(set(ids) - source_ids)[:10]}")
    by_project = defaultdict(list)
    for x in participations:
        by_project[x["project_id"]].append(x)
    orphans = set(by_project) - set(ids)
    if orphans:
        fail(f"Beteiligungen ohne Projekt: {sorted(orphans)[:10]}")
    no_parts = [i for i in ids if i not in by_project]
    if no_parts:
        fail(f"{len(no_parts)} Projekte ohne Beteiligung: {no_parts[:10]}")
    no_dot = [i for i in ids if i in by_project and not any(x["lat"] is not None for x in by_project[i])]
    if no_dot:
        warn(f"{len(no_dot)} Projekte ohne Punkt auf der Karte (nur über die Suche erreichbar): {no_dot}")
    keys = Counter((x["project_id"], x["org_id"]) for x in participations if x["org_id"])
    dups = [k for k, c in keys.items() if c > 1]
    if dups:
        fail(f"{len(dups)} Organisationen doppelt im selben Projekt: {dups[:5]}")
    return by_project


def check_coordinators(projects, by_project):
    """Gate 3: every EU project names exactly one coordinator; an Austrian one appears once among participants."""
    for p in projects:
        parts = by_project.get(p["id"], [])
        leads = [x for x in parts if x["role"] in ("coordinator", "sole_applicant")]
        if len(leads) > 1:
            fail(f"Projekt {p['id']} {p['acronym']}: {len(leads)} koordinierende Beteiligungen")
        if p["source"] != "eu_fp":
            continue
        c = p["coordinator"]
        if not c or not c.get("name") or not c.get("country"):
            fail(f"EU-Projekt {p['id']} {p['acronym']}: keine Koordination")
            continue
        if c["country"] == "AT" and len(leads) != 1:
            fail(f"EU-Projekt {p['id']} {p['acronym']}: österreichische Koordination, aber {len(leads)} Einträge mit Rolle coordinator")
        if c["country"] != "AT" and leads:
            fail(f"EU-Projekt {p['id']} {p['acronym']}: Koordination {c['country']}, aber österreichischer Eintrag mit Rolle coordinator")
        if not p["partners_complete"]:
            fail(f"EU-Projekt {p['id']}: partners_complete sollte true sein")


def check_danube4all(projects, by_project):
    """Gate 4: the planning test case."""
    p = next((p for p in projects if p["id"] == DANUBE4ALL_ID), None)
    if p is None:
        fail("Danube4All fehlt")
        return
    if "BODENKULTUR" not in p["coordinator"]["name"].upper():
        fail(f"Danube4All: Koordination ist {p['coordinator']['name']!r}, erwartet BOKU")
    amt = [x for x in by_project[DANUBE4ALL_ID] if x["name"].startswith("Amt der Niederösterreichischen Landesregierung")]
    if len(amt) != 1 or amt[0]["role"] != "associatedPartner" or amt[0]["funding_status"] != "no_eu_funding":
        fail(f"Danube4All: Amt der NÖ Landesregierung nicht als assoziierter Partner ohne EU-Förderung: {amt}")
    boku = [x for x in by_project[DANUBE4ALL_ID] if "BODENKULTUR" in x["name"].upper()]
    if len(boku) != 1 or boku[0]["role"] != "coordinator":
        fail(f"Danube4All: BOKU-Beteiligung fehlt oder ist nicht coordinator: {boku}")


def check_geography(participations, polygons):
    """Gate 5: every dot lies in Austria and in the polygon of its stated Bundesland."""
    outside, mismatched = [], []
    for x in participations:
        if x["lat"] is None:
            if x["geo_source"] != "none":
                fail(f"{x['project_id']}/{x['name']}: keine Koordinaten, aber geo_source={x['geo_source']}")
            continue
        found = bundesland_at(x["lat"], x["lng"], polygons)
        if found is None:
            outside.append((x["project_id"], x["name"], x["city"], x["lat"], x["lng"]))
        elif found != x["bundesland"]:
            key = (x["project_id"], x["org_id"] or x["name"])
            if key not in BUNDESLAND_MISMATCH_ALLOWED:
                mismatched.append((x["project_id"], x["name"], x["city"], x["bundesland"], found, x["geo_source"]))
    for row in outside:
        fail(f"Punkt außerhalb Österreichs: {row}")
    for row in mismatched:
        fail(f"Bundesland ≠ Polygon: {row}")


def check_funding(projects, participations):
    """Gate 6: funding status agrees with amount, role and source."""
    source_by_id = {p["id"]: p["source"] for p in projects}
    for x in participations:
        has_amount = x["funding_eur"] is not None and x["funding_eur"] > 0
        if (x["funding_status"] == "amount") != has_amount:
            fail(f"{x['project_id']}/{x['name']}: Status {x['funding_status']} passt nicht zu Betrag {x['funding_eur']}")
        source = source_by_id[x["project_id"]]
        if source == "ffg" and x["funding_status"] != "not_public":
            fail(f"{x['project_id']}/{x['name']}: FFG-Projekt mit Status {x['funding_status']}")
        if x["role"] == "thirdParty" and x["funding_status"] != "third_party":
            fail(f"{x['project_id']}/{x['name']}: thirdParty mit Status {x['funding_status']}")
        if x["funding_status"] == "in_kind":
            fail(f"{x['project_id']}/{x['name']}: in_kind ohne belegte Quelle (siehe Entscheidung 2026-10-19)")


def check_internal_content(raw_texts):
    """Gate 7: no internal workbook fields and no workbook placeholders anywhere in the outputs."""
    for name, text in raw_texts.items():
        for key in _all_keys(json.loads(text)) & FORBIDDEN_KEYS:
            fail(f"Internes Feld {key!r} in {name}")
        for term in FORBIDDEN_TEXT:
            if term in text.upper():
                fail(f"Interner Begriff {term!r} steht in {name}")


def _all_keys(obj):
    """Collect every dict key in a nested JSON structure."""
    if isinstance(obj, dict):
        return set(obj) | set().union(*(_all_keys(v) for v in obj.values()))
    if isinstance(obj, list):
        return set().union(*(_all_keys(v) for v in obj)) if obj else set()
    return set()


def check_abstracts(projects, abstracts):
    """Gate 8: abstracts belong to known projects and are non-empty."""
    ids = {p["id"] for p in projects}
    stray = set(abstracts) - ids
    if stray:
        fail(f"Kurzbeschreibungen ohne Projekt: {sorted(stray)[:5]}")
    for pid, a in abstracts.items():
        if a.get("lang") not in ("de", "en") or not a.get("text"):
            fail(f"Kurzbeschreibung {pid}: leer oder ohne Sprache")
    missing = sorted(ids - set(abstracts))
    if missing:
        warn(f"{len(missing)} Projekte ohne Kurzbeschreibung: {missing}")


def main():
    """Run all checks and exit non-zero on any failure."""
    load_dotenv(ENV_FILE)
    curated = pd.read_excel(os.environ["SOURCE_XLSX"], sheet_name=XLSX_SHEET, dtype={"id": str})
    projects, participations, abstracts, meta = load_outputs()
    raw_texts = {f.name: f.read_text(encoding="utf-8") for f in DATA_DIR.glob("*.json")}

    check_schema(projects, participations)
    by_project = check_completeness(projects, participations, set(curated["id"]))
    check_coordinators(projects, by_project)
    check_danube4all(projects, by_project)
    check_geography(participations, load_bundesland_polygons())
    check_funding(projects, participations)
    check_internal_content(raw_texts)
    check_abstracts(projects, abstracts)

    mapped = sum(1 for x in participations if x["lat"] is not None)
    distinct = len({(x["lat"], x["lng"]) for x in participations if x["lat"] is not None})
    print(f"Projekte {len(projects)} | Beteiligungen {len(participations)} | davon auf der Karte {mapped} "
          f"an {distinct} verschiedenen Koordinaten")
    no_dot = sum(1 for x in participations if x["geo_source"] == "none")
    print(f"Ohne Punkt (CORDIS ohne Standort) {no_dot} | Kurzbeschreibungen {len(abstracts)}")
    print(f"Datenstand CORDIS: {meta['cordis_data_dates']}")
    for w in warnings:
        print("WARN ", w)
    for f in failures:
        print("FAIL ", f)
    print(f"\n{'NICHT BESTANDEN' if failures else 'BESTANDEN'}: {len(failures)} Fehler, {len(warnings)} Hinweise")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
