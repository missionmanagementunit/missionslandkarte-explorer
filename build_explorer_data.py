"""
Erzeugt die Daten des Explorers aus dem kuratierten Quell-Workbook und den CORDIS-Bulk-Exporten.

Eingaben (alle lokal, nichts davon wird eingecheckt):
  - SOURCE_XLSX aus .env       kuratierte Projektauswahl (1193 Projekte, je eine österreichische Organisation)
  - cache/cordis/<programm>/   CORDIS-Bulk-Exporte, geladen von ./fetch_sources.sh
  - build_inputs/city_coords.csv  Ortskoordinaten als Rückfallebene (eingecheckt)

Ausgaben (öffentlich, werden ausgeliefert):
  - data/projects.json        ein Eintrag pro Projekt
  - data/participations.json  ein Eintrag pro österreichischer Beteiligung — das sind die Punkte der Karte
  - data/abstracts.json       Kurzbeschreibung je Projekt, wird erst beim Öffnen einer Karte geladen
  - data/meta.json            Datenstand, Zählungen, Quellenangaben

Lokaler Bericht (nicht öffentlich): reports/explorer_build_report_<datum>.md

Grundsatz: Für EU-Projekte ist CORDIS die Quelle (Rollen, Förderung, Daten, Kurzbeschreibung).
Das Workbook dient dort nur der Zuordnung; Abweichungen landen im Bericht, nicht in den Daten.
Für FFG, LIFE und Sonstige gibt es nur die eine kuratierte Zeile.

Ausführung:
    .venv/bin/python build_explorer_data.py
"""

import csv
import datetime
import html
import json
import os
import re
from collections import Counter
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

from geo_utils import bundesland_at, load_bundesland_polygons

PROJECT_DIR = Path(__file__).resolve().parent
ENV_FILE = PROJECT_DIR / ".env"
CORDIS_DIR = PROJECT_DIR / "cache" / "cordis"
CITY_COORDS_FILE = PROJECT_DIR / "build_inputs" / "city_coords.csv"
OUTPUT_DIR = PROJECT_DIR / "data"
REPORT_DIR = PROJECT_DIR / "reports"

XLSX_SHEET = "Tabelle1"

# CORDIS-Ordnername -> Anzeigename des Rahmenprogramms
CORDIS_PROGRAMMES = {"HORIZON": "Horizon Europe", "h2020": "Horizon 2020"}

# project.csv von CORDIS setzt Semikolons im Feld "objective" nicht in Anführungszeichen.
# Davor stehen immer 15 Felder, danach 6 — alles dazwischen gehört zu "objective".
CORDIS_FIELDS_BEFORE_OBJECTIVE = 15
CORDIS_FIELDS_AFTER_OBJECTIVE = 6

# NUTS-2-Code (erste 4 Zeichen) -> Bundesland
NUTS2_TO_BUNDESLAND = {
    "AT11": "Burgenland",
    "AT12": "Niederösterreich",
    "AT13": "Wien",
    "AT21": "Kärnten",
    "AT22": "Steiermark",
    "AT31": "Oberösterreich",
    "AT32": "Salzburg",
    "AT33": "Tirol",
    "AT34": "Vorarlberg",
}

SOURCE_KEYS = {
    "EU FP": "eu_fp",
    "FFG": "ffg",
    "LIFE": "life",
    "Land Oberösterreich": "other",
    "LBG": "other",
}

MISSION_ALIASES = {"waters": "water"}

# Rollen der kuratierten Zeile (FFG/LIFE/Sonstige) -> Rolle im Explorer
CURATED_ROLES = {
    "Konsortialführer": "coordinator",
    "Einzelantragsteller": "sole_applicant",
    "Coordinator": "coordinator",
    "COORDINATOR": "coordinator",
    "PARTICIPANT": "participant",
}
LEAD_ROLES = {"coordinator", "sole_applicant"}

# Reihenfolge der Beteiligten auf der Projektkarte
ROLE_ORDER = {
    "coordinator": 0,
    "sole_applicant": 0,
    "participant": 1,
    "partner": 1,
    "thirdParty": 2,
    "associatedPartner": 3,
    "internationalPartner": 4,
    None: 5,
}

# Bundesland-Fehler im Workbook (Stadt, Bundesland_xlsx) -> korrekt; wie in missionslandkarte/build_projects_v2.py
BUNDESLAND_CORRECTIONS = {
    ("Salzburg", "Niederösterreich"): "Salzburg",
    ("Linz", "Niederösterreich"): "Oberösterreich",
    ("Wien", "Niederösterreich"): "Wien",
    ("Klagenfurt am Wörthersee", "Wien"): "Kärnten",
    ("Klagenfurt Am Wörthersee", "Wien"): "Kärnten",
    ("Niederranna", "Kärnten"): "Oberösterreich",
}
CITY_ALIASES = {"Tulln": "Tulln an der Donau", "Villach-Innere Stadt": "Villach", "Vienna": "Wien"}

# CORDIS-Standorte, bei denen schon der NUTS-Code falsch ist — die allgemeine Regel
# (Punkt liegt nicht im angegebenen Bundesland -> Ortskoordinaten) greift dort nicht.
# Geprüft am 2026-10-22 anhand von Postleitzahl und Straße. coords None = CORDIS-Punkt ist richtig.
ORG_GEO_CORRECTIONS = {
    # NIEDERRANNA 41, 4085: Punkt stimmt, NUTS AT224 (Oststeiermark) ist falsch
    "903432102": {"city": "Niederranna", "bundesland": "Oberösterreich", "coords": None},
    # BRAND 44, 3531 (Waldhausen, Bezirk Zwettl): NUTS AT341 (Vorarlberg) und Punkt (OÖ) falsch
    "879870802": {"city": "Brand", "bundesland": "Niederösterreich", "coords": (48.5403, 15.3105)},
    # BODEN 34, 6731 (Sonntag, Großes Walsertal): NUTS AT130 (Wien) und Punkt (NÖ) falsch
    "912587350": {"city": "Sonntag", "bundesland": "Vorarlberg", "coords": (47.2378, 9.8959)},
}

# CORDIS setzt Organisationen ohne verwertbare Adresse auf den Mittelpunkt Österreichs (Pongau).
# Solche Koordinaten gelten als fehlend.
AT_COUNTRY_CENTROID = (47.20003, 13.19996)

# Manuelle Vorgaben je Projekt-ID (Stand 2026-10-13, wie in der Präsentation)
NAME_OVERRIDES = {"101104368": "AMooRe"}

# Natürliche Personen (meist Einzelunternehmen) übernimmt der Explorer so, wie CORDIS sie
# veröffentlicht — mit Namen (Entscheidung 2026-10-22). Für manche unterdrückt CORDIS die Adresse
# (kein Ort, Punkt im Landesmittelpunkt); die bekommen keinen Punkt auf der Karte (geo_source "none").

COORD_DECIMALS = 5     # ~1 m — genauer sind die Quellen nicht
FUNDING_DECIMALS = 2   # Cent


# ── Einlesen ───────────────────────────────────────────────────────────────────

def load_source_xlsx_path():
    """Read SOURCE_XLSX from .env and fail clearly if it is missing."""
    load_dotenv(ENV_FILE)
    value = os.environ.get("SOURCE_XLSX")
    if not value:
        raise SystemExit(f"SOURCE_XLSX fehlt — .env.example nach {ENV_FILE.name} kopieren und Pfad eintragen.")
    path = Path(value)
    if not path.exists():
        raise SystemExit(f"SOURCE_XLSX nicht gefunden: {path}")
    return path


def read_cordis_csv(path, repair_objective):
    """Read a CORDIS bulk CSV with the csv module; optionally re-join an unquoted objective field."""
    with open(path, encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter=";")
        header = next(reader)
        rows, repaired = [], 0
        for row in reader:
            if len(row) != len(header):
                if not repair_objective:
                    raise ValueError(f"{path}: Zeile mit {len(row)} statt {len(header)} Feldern")
                cut_end = len(row) - CORDIS_FIELDS_AFTER_OBJECTIVE
                row = (row[:CORDIS_FIELDS_BEFORE_OBJECTIVE]
                       + [";".join(row[CORDIS_FIELDS_BEFORE_OBJECTIVE:cut_end])]
                       + row[cut_end:])
                repaired += 1
            rows.append(row)
    return pd.DataFrame(rows, columns=header), repaired


def load_cordis():
    """Load organisation and project tables of all CORDIS programmes plus their data dates."""
    orgs, projects, data_dates, repaired_total = [], [], {}, 0
    for folder, label in CORDIS_PROGRAMMES.items():
        org_df, _ = read_cordis_csv(CORDIS_DIR / folder / "organization.csv", repair_objective=False)
        prj_df, repaired = read_cordis_csv(CORDIS_DIR / folder / "project.csv", repair_objective=True)
        prj_df["programme_label"] = label
        orgs.append(org_df)
        projects.append(prj_df)
        repaired_total += repaired
        date_file = CORDIS_DIR / f"{folder}.last-modified"
        data_dates[folder] = date_file.read_text().strip() if date_file.exists() else ""
    return pd.concat(orgs, ignore_index=True), pd.concat(projects, ignore_index=True), data_dates, repaired_total


def load_city_coords():
    """Load the fallback table (city, bundesland) -> (lat, lng)."""
    table = {}
    with open(CITY_COORDS_FILE, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            table[(row["city"], row["bundesland"])] = (float(row["lat"]), float(row["lng"]))
    return table


# ── Hilfsfunktionen ────────────────────────────────────────────────────────────

def normalise_name(name):
    """Fold an organisation name to a comparison key (case, umlauts, punctuation, bracketed suffixes)."""
    s = html.unescape(str(name)).upper()
    s = re.sub(r"\(.*?\)", " ", s)
    for a, b in (("Ä", "AE"), ("Ö", "OE"), ("Ü", "UE"), ("ß", "SS")):
        s = s.replace(a, b)
    # CORDIS schreibt Umlaute mal als "UE", mal als "U" — beides auf "U" bringen.
    for a, b in (("AE", "A"), ("OE", "O"), ("UE", "U")):
        s = s.replace(a, b)
    return re.sub(r"[^A-Z0-9]", "", s)


def parse_geolocation(value):
    """Parse CORDIS 'lat,lng' into a rounded tuple, or None when empty or set to the country centroid."""
    if not value or "," not in value:
        return None
    lat, lng = value.split(",", 1)
    coords = round(float(lat), COORD_DECIMALS), round(float(lng), COORD_DECIMALS)
    return None if coords == AT_COUNTRY_CENTROID else coords


def bundesland_from_nuts(code):
    """Map a NUTS code to its Bundesland, or None."""
    return NUTS2_TO_BUNDESLAND.get((code or "")[:4])


def display_city(city):
    """Title-case all-caps CORDIS city names ('WIEN' -> 'Wien') and apply CITY_ALIASES."""
    city = (city or "").strip()
    city = city.title() if city.isupper() else city
    return CITY_ALIASES.get(city, city)


def iso_date(value):
    """Return an ISO date string, a bare year, or '' for empty values."""
    if value is None or (isinstance(value, float) and pd.isna(value)) or value == "":
        return ""
    if isinstance(value, (datetime.date, datetime.datetime, pd.Timestamp)):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if re.fullmatch(r"\d{4}(\.0)?", text):
        return text[:4]
    return text[:10]


def clean_text(value):
    """Collapse whitespace; return '' for missing values."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return re.sub(r"\s+", " ", html.unescape(str(value))).strip()


def to_amount(value):
    """Parse a funding value into a rounded float, or None when empty or zero."""
    if value is None or value == "" or (isinstance(value, float) and pd.isna(value)):
        return None
    amount = round(float(value), FUNDING_DECIMALS)
    return amount if amount > 0 else None


def eu_funding(role, ec_contribution):
    """Return (funding_eur, funding_status) for a CORDIS participation."""
    if role == "thirdParty":
        # Verbundene Dritte haben keinen eigenen Betrag; ihre Förderung läuft über den Partner.
        return None, "third_party"
    amount = to_amount(ec_contribution)
    if amount is not None:
        return amount, "amount"
    return None, "no_eu_funding"


def city_coords_for(city, bundesland, city_table):
    """Look up fallback coordinates by (city, bundesland), then by city alone if unambiguous."""
    city = CITY_ALIASES.get(city, city)
    if (city, bundesland) in city_table:
        return city_table[(city, bundesland)]
    candidates = [v for (c, _), v in city_table.items() if c.lower() == city.lower()]
    return candidates[0] if len(candidates) == 1 else None


def corrected_bundesland(city, bundesland):
    """Apply the known Bundesland corrections of the workbook."""
    return BUNDESLAND_CORRECTIONS.get((city, bundesland), bundesland)


def mission_key(value):
    """Normalise the mission key ('waters' -> 'water')."""
    value = str(value).strip()
    return MISSION_ALIASES.get(value, value)


# ── EU-Projekte (CORDIS) ───────────────────────────────────────────────────────

def match_curated_row(curated, at_orgs):
    """Find the CORDIS row of the curated organisation: by name, then by identical amount. Returns (index, how)."""
    key = normalise_name(curated["organisation"])
    by_name = at_orgs[at_orgs["name"].map(normalise_name) == key]
    if len(by_name) == 1:
        return by_name.index[0], "name"
    amount = to_amount(curated["foerderung_eur"])
    if amount is not None:
        by_amount = at_orgs[at_orgs["ecContribution"].map(to_amount) == amount]
        if len(by_amount) == 1:
            return by_amount.index[0], "amount"
    return None, None


def build_eu_projects(curated_eu, orgs, cordis_projects, city_table, polygons, report, missing_coords):
    """Build project, participation and abstract records for all curated EU projects."""
    projects, participations, abstracts = [], [], {}
    orgs_by_project = {pid: grp for pid, grp in orgs.groupby("projectID")}
    cordis_by_id = cordis_projects.drop_duplicates("id").set_index("id")

    for _, cur in curated_eu.iterrows():
        pid = cur["id"]
        if pid not in cordis_by_id.index or pid not in orgs_by_project:
            raise SystemExit(f"EU-Projekt {pid} ({cur['name']}) fehlt in den CORDIS-Exporten — ./fetch_sources.sh ausführen?")
        cp = cordis_by_id.loc[pid]
        all_orgs = orgs_by_project[pid]
        coordinators = all_orgs[all_orgs["role"] == "coordinator"]
        if len(coordinators) != 1:
            raise SystemExit(f"EU-Projekt {pid}: {len(coordinators)} Koordinatoren in CORDIS statt genau einem")
        coord = coordinators.iloc[0]
        at_orgs = all_orgs[all_orgs["country"] == "AT"]

        curated_idx, how = match_curated_row(cur, at_orgs)
        if curated_idx is None:
            report["curated_not_in_cordis"].append((pid, cur["name"], clean_text(cur["organisation"]), cur["foerderung_eur"]))
        else:
            row = at_orgs.loc[curated_idx]
            if how == "amount":
                # Umbenennung, andere Schreibweise oder im Workbook anonymisierte Person
                report["curated_renamed"].append((pid, cur["name"], clean_text(cur["organisation"]), row["name"]))
            cordis_amount, curated_amount = to_amount(row["ecContribution"]), to_amount(cur["foerderung_eur"])
            if cordis_amount != curated_amount:
                report["amount_differs"].append((pid, cur["name"], row["name"], curated_amount, cordis_amount))
            curated_role = CURATED_ROLES.get(cur["Pariticpant Type"])
            if curated_role and curated_role != row["role"]:
                report["role_differs"].append((pid, cur["name"], row["name"], cur["Pariticpant Type"], row["role"]))

        for idx, org in at_orgs.iterrows():
            bundesland = bundesland_from_nuts(org["nutsCode"])
            city = display_city(org["city"])
            if not city and idx == curated_idx:
                # CORDIS ohne Ort (unterdrückte Adresse) — der Ort aus dem Workbook ist dann die beste Angabe.
                city = CITY_ALIASES.get(cur["city"], cur["city"])
                bundesland = bundesland or corrected_bundesland(cur["city"], cur["bundesland"])
            coords, geo_source = parse_geolocation(org["geolocation"]), "cordis"
            if org["organisationID"] in ORG_GEO_CORRECTIONS:
                fix = ORG_GEO_CORRECTIONS[org["organisationID"]]
                city, bundesland = fix["city"], fix["bundesland"]
                if fix["coords"] is not None:
                    coords, geo_source = fix["coords"], "city"
                report["geo_corrected"].append((pid, cur["name"], org["name"], city, bundesland))
            elif coords is None and not city:
                # CORDIS veröffentlicht weder Punkt noch Ort (so bei manchen Einzelunternehmen) — kein Punkt.
                geo_source = "none"
                report["unlocatable"].append((pid, cur["name"], org["name"], org["role"]))
            elif coords is None:
                coords, geo_source = city_coords_for(city, bundesland, city_table) if bundesland else None, "city"
            elif bundesland and bundesland_at(coords[0], coords[1], polygons) != bundesland:
                # CORDIS hat die Adresse im falschen Ort gefunden (z. B. "Wien…" in Wiener Neustadt).
                report["coords_replaced"].append((pid, cur["name"], org["name"], coords,
                                                  bundesland_at(coords[0], coords[1], polygons), bundesland))
                coords, geo_source = city_coords_for(city, bundesland, city_table), "city"
            if coords is None and geo_source != "none":
                missing_coords.append((pid, cur["name"], org["name"], city, bundesland))
                continue
            if bundesland is None and coords is not None:
                bundesland = bundesland_at(coords[0], coords[1], polygons)
                report["bundesland_from_point"].append((pid, cur["name"], org["name"], org["nutsCode"], bundesland))

            funding_eur, funding_status = eu_funding(org["role"], org["ecContribution"])
            participations.append({
                "project_id": pid,
                "org_id": org["organisationID"],
                "name": clean_text(org["name"]),
                "short_name": clean_text(org["shortName"]) or None,
                "role": org["role"],
                "city": city,
                "bundesland": bundesland,
                "lat": coords[0] if coords else None,
                "lng": coords[1] if coords else None,
                "geo_source": geo_source,
                "funding_eur": funding_eur,
                "funding_status": funding_status,
                "ended": org["endOfParticipation"] == "true",
                "cordis_listed": True,
            })

        if curated_idx is None:
            participations.append(curated_only_participation(cur, city_table))

        projects.append({
            "id": pid,
            "acronym": NAME_OVERRIDES.get(pid, clean_text(cur["name"])),
            "title": clean_text(cp["title"]),
            "mission": mission_key(cur["mission"]),
            "source": "eu_fp",
            "programme": cp["programme_label"],
            "start": cp["startDate"][:10],
            "end": cp["endDate"][:10],
            "link": f"https://cordis.europa.eu/project/id/{pid}",
            "coordinator": {"name": clean_text(coord["name"]), "country": coord["country"]},
            "partners_complete": True,
        })
        abstracts[pid] = {"lang": "en", "text": clean_text(cp["objective"])}

    return projects, participations, abstracts


def curated_only_participation(cur, city_table):
    """Participation for a curated EU organisation that CORDIS no longer lists — kept, but flagged."""
    city = CITY_ALIASES.get(cur["city"], cur["city"])
    bundesland = corrected_bundesland(cur["city"], cur["bundesland"])
    coords = city_coords_for(city, bundesland, city_table)
    if coords is None:
        raise SystemExit(f"Keine Ortskoordinaten für {city} ({bundesland}) — build_inputs/city_coords.csv ergänzen")
    return {
        "project_id": cur["id"],
        "org_id": None,
        "name": clean_text(cur["organisation"]),
        "short_name": None,
        "role": CURATED_ROLES.get(cur["Pariticpant Type"]),
        "city": city,
        "bundesland": bundesland,
        "lat": coords[0],
        "lng": coords[1],
        "geo_source": "city",
        "funding_eur": None,
        "funding_status": "unknown",
        "ended": False,
        "cordis_listed": False,
    }


# ── FFG, LIFE, Sonstige (nur die kuratierte Zeile) ─────────────────────────────

def build_org_index(orgs):
    """Index all Austrian CORDIS organisations by normalised name -> (org_id, most common coordinates, short name)."""
    at = orgs[(orgs["country"] == "AT") & (orgs["geolocation"] != "")]
    index = {}
    for key, grp in at.groupby(at["name"].map(normalise_name)):
        coords = Counter(parse_geolocation(g) for g in grp["geolocation"]).most_common(1)[0][0]
        org_id = grp["organisationID"].mode().iloc[0]
        short_names = grp["shortName"][grp["shortName"] != ""]
        short_name = clean_text(short_names.mode().iloc[0]) if len(short_names) else None
        index[key] = (org_id, coords, short_name)
    return index


def build_other_projects(curated_other, org_index, city_table, polygons, report, missing_coords):
    """Build records for FFG, LIFE and other projects from their single curated row."""
    projects, participations, abstracts = [], [], {}
    for _, cur in curated_other.iterrows():
        pid = cur["id"]
        source = SOURCE_KEYS[cur["Source"]]
        role = CURATED_ROLES.get(cur["Pariticpant Type"])
        city = CITY_ALIASES.get(cur["city"], cur["city"])
        bundesland = corrected_bundesland(cur["city"], cur["bundesland"])
        org_name = clean_text(cur["organisation"])

        match = org_index.get(normalise_name(org_name))
        if match and bundesland_at(match[1][0], match[1][1], polygons) != bundesland:
            # Gleicher Name, aber CORDIS-Punkt im falschen Bundesland — Ortskoordinaten sind sicherer.
            report["coords_replaced"].append((pid, cur["name"], org_name, match[1],
                                              bundesland_at(match[1][0], match[1][1], polygons), bundesland))
            match = None
        if match:
            org_id, coords, short_name = match
            geo_source = "org_match"
        else:
            org_id, coords, short_name = None, city_coords_for(city, bundesland, city_table), None
            geo_source = "city"
            if coords is None:
                missing_coords.append((pid, cur["name"], org_name, city, bundesland))
                continue  # main() bricht ab, sobald missing_coords nicht leer ist

        if source == "ffg":
            funding_eur, funding_status = None, "not_public"
        elif source == "life":
            funding_eur = to_amount(cur["foerderung_eur"])
            funding_status = "amount" if funding_eur is not None else "unknown"
        else:
            funding_eur, funding_status = None, "unknown"

        participations.append({
            "project_id": pid,
            "org_id": org_id,
            "name": org_name,
            "short_name": short_name,
            "role": role,
            "city": city,
            "bundesland": bundesland,
            "lat": coords[0],
            "lng": coords[1],
            "geo_source": geo_source,
            "funding_eur": funding_eur,
            "funding_status": funding_status,
            "ended": False,
            "cordis_listed": False,
        })
        projects.append({
            "id": pid,
            "acronym": NAME_OVERRIDES.get(pid, clean_text(cur["name"])),
            "title": clean_text(cur["long title"]) or clean_text(cur["name"]),
            "mission": mission_key(cur["mission"]),
            "source": source,
            "programme": clean_text(cur["Program"]) or ("LIFE" if source == "life" else ""),
            "start": iso_date(cur["Project Start Date"]),
            "end": iso_date(cur["Project End Date"]),
            "link": clean_text(cur["link"]),
            "coordinator": {"name": org_name, "country": "AT"} if role in LEAD_ROLES else None,
            "partners_complete": False,
        })
        text_de, text_en = clean_text(cur["Abstract DE"]), clean_text(cur["Abstract EN"])
        if text_de or text_en:
            abstracts[pid] = {"lang": "de" if text_de else "en", "text": text_de or text_en}
        else:
            report["missing_abstract"].append((pid, cur["name"]))
    return projects, participations, abstracts


# ── Ausgabe ────────────────────────────────────────────────────────────────────

def write_json_lines(path, records):
    """Write a JSON array with one record per line, so git diffs stay readable."""
    with open(path, "w", encoding="utf-8") as f:
        f.write("[\n")
        f.write(",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in records))
        f.write("\n]\n")


def write_report(path, report, counts):
    """Write the local build report as Markdown (contains internal comparisons, stays out of git)."""
    sections = [
        ("curated_not_in_cordis", "Kuratierte Organisation in CORDIS nicht (mehr) gelistet — behalten, cordis_listed=false",
         ["Projekt-ID", "Projekt", "Organisation (Workbook)", "Betrag (Workbook)"]),
        ("curated_renamed", "Kuratierte Organisation über gleichen Betrag zugeordnet (Umbenennung/Schreibweise)",
         ["Projekt-ID", "Projekt", "Workbook", "CORDIS"]),
        ("amount_differs", "Betrag Workbook ≠ CORDIS (Explorer zeigt CORDIS)",
         ["Projekt-ID", "Projekt", "Organisation", "Workbook", "CORDIS"]),
        ("role_differs", "Rolle Workbook ≠ CORDIS (Explorer zeigt CORDIS)",
         ["Projekt-ID", "Projekt", "Organisation", "Workbook", "CORDIS"]),
        ("unlocatable", "Ohne Punkt — CORDIS veröffentlicht weder Koordinaten noch Ort",
         ["Projekt-ID", "Projekt", "Organisation", "Rolle"]),
        ("bundesland_from_point", "Bundesland aus Koordinaten bestimmt (kein NUTS-Code)",
         ["Projekt-ID", "Projekt", "Organisation", "NUTS", "Bundesland"]),
        ("coords_replaced", "CORDIS-Punkt im falschen Bundesland — durch Ortskoordinaten ersetzt",
         ["Projekt-ID", "Projekt", "Organisation", "CORDIS-Punkt", "liegt in", "angegeben"]),
        ("geo_corrected", "Von Hand korrigierte Standorte (ORG_GEO_CORRECTIONS)",
         ["Projekt-ID", "Projekt", "Organisation", "Ort", "Bundesland"]),
        ("missing_abstract", "Ohne Kurzbeschreibung", ["Projekt-ID", "Projekt"]),
    ]
    lines = [f"# Explorer-Build {datetime.date.today().isoformat()}", "", "## Zählungen", ""]
    lines += [f"- {k}: {v}" for k, v in counts.items()]
    for key, title, header in sections:
        rows = report[key]
        lines += ["", f"## {title} ({len(rows)})", ""]
        if rows:
            lines.append("| " + " | ".join(header) + " |")
            lines.append("|" + "---|" * len(header))
            lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    """Run the full build: read sources, build records, write outputs and the report."""
    xlsx_path = load_source_xlsx_path()
    curated = pd.read_excel(xlsx_path, sheet_name=XLSX_SHEET, dtype={"id": str})
    print(f"Workbook: {curated.shape[0]} Zeilen, {curated.shape[1]} Spalten")
    print(curated[["Source", "type"]].value_counts().to_string())
    unknown_sources = set(curated["Source"]) - set(SOURCE_KEYS)
    if unknown_sources:
        raise SystemExit(f"Unbekannte Quellen im Workbook: {unknown_sources}")
    if curated["id"].duplicated().any():
        raise SystemExit("Doppelte Projekt-IDs im Workbook")

    orgs, cordis_projects, data_dates, repaired = load_cordis()
    print(f"CORDIS: {len(orgs)} Beteiligungen, {len(cordis_projects)} Projekte, {repaired} Zeilen mit Semikolon im Abstract repariert")
    city_table = load_city_coords()
    polygons = load_bundesland_polygons()

    report = {k: [] for k in ("curated_not_in_cordis", "curated_renamed", "amount_differs", "role_differs",
                              "unlocatable", "bundesland_from_point",
                              "coords_replaced", "geo_corrected", "missing_abstract")}
    missing_coords = []   # nicht leer -> Abbruch; nichts wird stillschweigend weggelassen

    is_eu = curated["Source"] == "EU FP"
    eu_projects, eu_parts, eu_abstracts = build_eu_projects(
        curated[is_eu], orgs, cordis_projects, city_table, polygons, report, missing_coords)
    other_projects, other_parts, other_abstracts = build_other_projects(
        curated[~is_eu], build_org_index(orgs), city_table, polygons, report, missing_coords)

    if missing_coords:
        lines = "\n".join(f"  {pid} {name}: {org} — {city} ({bl})" for pid, name, org, city, bl in missing_coords)
        raise SystemExit(f"{len(missing_coords)} Beteiligungen ohne Koordinaten — "
                         f"build_inputs/city_coords.csv oder CITY_ALIASES ergänzen:\n{lines}")

    projects = sorted(eu_projects + other_projects, key=lambda p: p["id"])
    participations = sorted(eu_parts + other_parts,
                            key=lambda p: (p["project_id"], ROLE_ORDER.get(p["role"], 5), p["name"]))
    abstracts = {**eu_abstracts, **other_abstracts}

    source_by_project = {p["id"]: p["source"] for p in projects}
    counts = {
        "projects": len(projects),
        "projects_by_source": dict(Counter(p["source"] for p in projects)),
        "participations": len(participations),
        "participations_by_source": dict(Counter(source_by_project[p["project_id"]] for p in participations)),
        "participations_by_role": dict(Counter(str(p["role"]) for p in participations)),
        "funding_status": dict(Counter(p["funding_status"] for p in participations)),
        "geo_source": dict(Counter(p["geo_source"] for p in participations)),
        "abstracts": len(abstracts),
    }

    OUTPUT_DIR.mkdir(exist_ok=True)
    write_json_lines(OUTPUT_DIR / "projects.json", projects)
    write_json_lines(OUTPUT_DIR / "participations.json", participations)
    with open(OUTPUT_DIR / "abstracts.json", "w", encoding="utf-8") as f:
        json.dump(abstracts, f, ensure_ascii=False, separators=(",", ":"))
    meta = {
        "built": datetime.date.today().isoformat(),
        "cordis_data_dates": data_dates,
        "counts": counts,
        "attribution": "Daten: CORDIS, Europäische Kommission (CC BY 4.0); LIFE-Projektdatenbank; FFG-Projektdatenbank.",
    }
    (OUTPUT_DIR / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    REPORT_DIR.mkdir(exist_ok=True)
    report_path = REPORT_DIR / f"explorer_build_report_{datetime.date.today().isoformat()}.md"
    write_report(report_path, report, counts)

    print(json.dumps(counts, ensure_ascii=False, indent=2))
    for key, rows in report.items():
        print(f"{key}: {len(rows)}")
    print(f"Bericht: {report_path}")


if __name__ == "__main__":
    main()
