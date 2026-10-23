"""Geometrie-Hilfen für Build und Prüfung: Punkt-in-Polygon gegen die Bundesländer-Grenzen."""

import json
from pathlib import Path

GEOJSON_FILE = Path(__file__).resolve().parent / "cache" / "geo" / "laender.json"


def load_bundesland_polygons():
    """Load the Bundesland GeoJSON as {name: [polygon, ...]}, each polygon a list of rings (outer ring first, then holes)."""
    with open(GEOJSON_FILE, encoding="utf-8") as f:
        data = json.load(f)
    polygons = {}
    for feature in data["features"]:
        geometry = feature["geometry"]
        parts = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        # Löcher behalten: Niederösterreich hat Wien als Loch — ohne sie läge Wien in NÖ.
        polygons[feature["properties"]["name"]] = parts
    return polygons


def _point_in_ring(lng, lat, ring):
    """Ray-casting test: is (lng, lat) inside the closed ring?"""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def bundesland_at(lat, lng, polygons):
    """Return the Bundesland containing the point, or None if it lies outside Austria."""
    for name, parts in polygons.items():
        for outer, *holes in parts:
            if _point_in_ring(lng, lat, outer) and not any(_point_in_ring(lng, lat, h) for h in holes):
                return name
    return None


def org_key(participation):
    """Stable key for one organisation: its CORDIS ID, or its name when there is none."""
    return participation["org_id"] or f"name:{participation['name']}"


def city_level_participations(participations):
    """
    Participations whose dot is only city-level: either marked as such (geo_source "city"),
    or on a coordinate shared by two or more different organisations — CORDIS writes
    city-centre points as if they were exact, so sharing is the reliable signal.
    """
    orgs_at_point = {}
    for p in participations:
        if p["lat"] is not None:
            orgs_at_point.setdefault((p["lat"], p["lng"]), set()).add(org_key(p))
    shared = {pt for pt, orgs in orgs_at_point.items() if len(orgs) >= 2}
    return [p for p in participations
            if p["lat"] is not None and (p["geo_source"] == "city" or (p["lat"], p["lng"]) in shared)]
