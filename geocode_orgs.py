"""
Geokodiert Organisationen, deren Punkt nur auf Ortsebene liegt, über ihre Adresse.

CORDIS setzt viele Organisationen auf den Ortsmittelpunkt (z. B. Universität Wien, AIT und MedUni Wien
alle auf denselben Punkt in der Wiener Innenstadt), obwohl die Straßenadresse in den Daten steht.
Dieses Skript sucht diese Adressen bei OpenStreetMap (Nominatim) und speichert jedes Ergebnis —
auch Fehlschläge — in build_inputs/org_geocodes.json. build_explorer_data.py übernimmt die Treffer.

Reihenfolge je Organisation:
  1. Adresse aus CORDIS (über die organisationID der Beteiligung)
  2. sonst Adresse einer gleichnamigen österreichischen CORDIS-Organisation
  3. sonst Suche nach Name und Ort (strengere Prüfung)

Ein Treffer zählt nur, wenn er im Bundesland der Beteiligung liegt und genauer ist als der Ort selbst.

Ausführung (braucht Netz, ~1 Anfrage pro Sekunde laut Nominatim-Nutzungsrichtlinie):
    .venv/bin/python geocode_orgs.py            # nur noch nicht abgefragte Organisationen
    .venv/bin/python geocode_orgs.py --retry    # auch frühere Fehlschläge erneut abfragen
"""

import datetime
import json
import re
import subprocess
import sys
import time
import urllib.parse
from collections import Counter
from pathlib import Path

import pandas as pd

from build_explorer_data import CORDIS_DIR, CORDIS_PROGRAMMES, normalise_name, read_cordis_csv
from geo_utils import bundesland_at, city_level_participations, load_bundesland_polygons, org_key

PROJECT_DIR = Path(__file__).resolve().parent
PARTICIPATIONS_FILE = PROJECT_DIR / "data" / "participations.json"
CACHE_FILE = PROJECT_DIR / "build_inputs" / "org_geocodes.json"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Identifizierender User-Agent laut Nominatim-Richtlinie — bewusst ohne persönliche Kontaktdaten
USER_AGENT = "missionslandkarte-explorer data build (github.com/missionmanagementunit/missionslandkarte-explorer)"
REQUEST_INTERVAL_S = 1.1
REQUEST_TIMEOUT_S = 30

# Nominatim-Ergebnistypen, die nicht genauer sind als der Ort — damit wäre nichts gewonnen
TOO_COARSE = {"country", "state", "region", "province", "county", "district", "municipality",
              "city", "town", "village", "hamlet", "suburb", "city_district", "borough",
              "quarter", "neighbourhood", "postcode", "island", "isolated_dwelling"}
# Bei einer Suche nur nach Name: nur echte Einrichtungen zulassen, keine Straßen gleichen Namens
NAME_SEARCH_CLASSES = {"amenity", "office", "building", "tourism", "healthcare", "craft",
                       "man_made", "leisure", "historic", "shop", "industrial", "landuse"}


def nominatim(params):
    """Query Nominatim via curl (this machine's Python has no working SSL store); returns the first hit or None."""
    query = urllib.parse.urlencode({**params, "format": "jsonv2", "limit": 1, "addressdetails": 0})
    result = subprocess.run(
        ["curl", "-sS", "--max-time", str(REQUEST_TIMEOUT_S), "-A", USER_AGENT, f"{NOMINATIM_URL}?{query}"],
        capture_output=True, text=True, check=True)
    hits = json.loads(result.stdout)
    return hits[0] if hits else None


def load_cordis_addresses():
    """Austrian CORDIS organisations: address by organisationID and by normalised name (most common)."""
    orgs = pd.concat([read_cordis_csv(CORDIS_DIR / p / "organization.csv", repair_objective=False)[0]
                      for p in CORDIS_PROGRAMMES])
    at = orgs[(orgs["country"] == "AT") & (orgs["street"] != "")]
    by_id, by_name = {}, {}
    for oid, grp in at.groupby("organisationID"):
        by_id[oid] = Counter(zip(grp["street"], grp["postCode"], grp["city"])).most_common(1)[0][0]
    for key, grp in at.groupby(at["name"].map(normalise_name)):
        by_name[key] = Counter(zip(grp["street"], grp["postCode"], grp["city"])).most_common(1)[0][0]
    return by_id, by_name


def clean_street(street):
    """Reduce to street name + first house number ('GRUNBERGSTRASSE 15, STIEGE 1, 5 STOCK' -> 'GRUNBERGSTRASSE 15')."""
    street = re.sub(r"\(.*?\)", " ", street)              # "(VBC6)"
    street = street.split(",")[0].split("/")[0]             # ", Top 314", "/2/7"
    match = re.match(r"^\s*(.*?\d+\s?[a-zA-Z]?)(?:\b|$)", street)
    return (match.group(1) if match else street).strip()


def geocode_one(participation, by_id, by_name, polygons):
    """Find coordinates for one organisation; returns a cache record (lat None on failure)."""
    record = {"name": participation["name"], "bundesland": participation["bundesland"],
              "queried": datetime.date.today().isoformat()}
    address = by_id.get(participation["org_id"]) if participation["org_id"] else None
    how = "cordis_id"
    if address is None:
        address = by_name.get(normalise_name(participation["name"]))
        how = "cordis_name"

    if address:
        street, postcode, city = address
        params = {"street": clean_street(street), "postalcode": postcode, "city": city, "country": "Austria"}
        record.update(method=how, query=" | ".join([street, postcode, city]))
        hit = nominatim(params)
        if hit is None or hit.get("addresstype") in TOO_COARSE:
            # zweiter Versuch als Freitext — fängt Schreibweisen ab, an denen die strukturierte Suche scheitert
            time.sleep(REQUEST_INTERVAL_S)
            hit = nominatim({"q": f"{clean_street(street)}, {postcode} {city}", "countrycodes": "at"}) or hit
        accept = hit is not None and hit.get("addresstype") not in TOO_COARSE
    else:
        params = {"q": f"{participation['name']}, {participation['city']}", "countrycodes": "at"}
        record.update(method="name_search", query=params["q"])
        hit = nominatim(params)
        accept = hit is not None and hit.get("category") in NAME_SEARCH_CLASSES

    if hit is None:
        record.update(lat=None, lng=None, reason="kein Treffer")
        return record
    lat, lng = round(float(hit["lat"]), 5), round(float(hit["lon"]), 5)
    record.update(found=hit.get("display_name"), addresstype=hit.get("addresstype"), category=hit.get("category"))
    if not accept:
        record.update(lat=None, lng=None, reason=f"zu ungenau ({hit.get('addresstype')}/{hit.get('category')})")
    elif bundesland_at(lat, lng, polygons) != participation["bundesland"]:
        found_bl = bundesland_at(lat, lng, polygons)
        postcode_matches = bool(address) and f", {address[1]}," in f"{hit.get('display_name', '')},"
        if how == "cordis_id" and postcode_matches and found_bl:
            # Eigene CORDIS-Adresse der Organisation, Postleitzahl bestätigt: dann ist das angegebene
            # Bundesland falsch (z. B. Hagenberg oder Hall in Tirol als "Wien" geführt), nicht der Treffer.
            record.update(lat=lat, lng=lng, bundesland_corrected=found_bl)
        else:
            record.update(lat=None, lng=None, reason=f"liegt in {found_bl}, nicht in {participation['bundesland']}")
    else:
        record.update(lat=lat, lng=lng)
    return record


def main():
    """Geocode all city-level organisations that are not cached yet (or failed, with --retry)."""
    retry = "--retry" in sys.argv
    participations = json.loads(PARTICIPATIONS_FILE.read_text(encoding="utf-8"))
    cache = json.loads(CACHE_FILE.read_text(encoding="utf-8")) if CACHE_FILE.exists() else {}

    targets = {}
    for p in city_level_participations(participations):
        targets.setdefault(org_key(p), p)
    todo = [k for k in targets if k not in cache or (retry and cache[k].get("lat") is None)]
    print(f"{len(targets)} Organisationen auf Ortsebene, davon {len(todo)} abzufragen "
          f"(~{round(len(todo) * REQUEST_INTERVAL_S / 60, 1)} min)")
    if not todo:
        return

    by_id, by_name = load_cordis_addresses()
    polygons = load_bundesland_polygons()
    for i, key in enumerate(todo, 1):
        cache[key] = geocode_one(targets[key], by_id, by_name, polygons)
        status = "ok" if cache[key]["lat"] is not None else cache[key]["reason"]
        print(f"[{i}/{len(todo)}] {targets[key]['name'][:50]:50} {status}")
        # nach jeder Anfrage speichern — ein Abbruch verliert keine Ergebnisse
        CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        time.sleep(REQUEST_INTERVAL_S)

    found = sum(1 for k in targets if cache.get(k, {}).get("lat") is not None)
    print(f"Fertig: {found} von {len(targets)} Organisationen mit Adresskoordinaten")
    print("Gründe für Fehlschläge:", Counter(cache[k].get("reason") for k in targets if cache[k].get("lat") is None))


if __name__ == "__main__":
    main()
