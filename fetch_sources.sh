#!/usr/bin/env bash
# Lädt die externen Quellen für build_explorer_data.py nach cache/ (nicht eingecheckt).
# curl statt Python: das System-Python dieses Rechners hat keinen funktionierenden SSL-Zertifikatsspeicher.
# Ausführung: ./fetch_sources.sh
set -euo pipefail

CACHE_DIR="cache"
CORDIS_PROGRAMMES=("HORIZON" "h2020")
CORDIS_URL="https://cordis.europa.eu/data/cordis-%sprojects-csv.zip"
GEOJSON_URL="https://raw.githubusercontent.com/ginseng666/GeoJSON-TopoJSON-Austria/master/2017/simplified-99.5/laender_995_geo.json"

mkdir -p "$CACHE_DIR/cordis" "$CACHE_DIR/geo"

for p in "${CORDIS_PROGRAMMES[@]}"; do
  url=$(printf "$CORDIS_URL" "$p")
  echo "CORDIS $p ← $url"
  # Erst in eine neue Datei laden, dann verschieben: ein abgebrochener Download
  # hinterlässt so kein halbes Zip im Cache.
  curl -sSfL -o "$CACHE_DIR/cordis/$p.zip.part" "$url"
  mv -f "$CACHE_DIR/cordis/$p.zip.part" "$CACHE_DIR/cordis/$p.zip"
  # Stand der Daten festhalten — landet in data/meta.json
  curl -sSfIL "$url" | grep -i '^last-modified' | tail -1 | cut -d' ' -f2- | tr -d '\r' > "$CACHE_DIR/cordis/$p.last-modified"
  rm -rf "$CACHE_DIR/cordis/$p"
  unzip -q "$CACHE_DIR/cordis/$p.zip" -d "$CACHE_DIR/cordis/$p"
done

echo "Bundesländer-GeoJSON ← $GEOJSON_URL"
curl -sSfL -o "$CACHE_DIR/geo/laender.json.part" "$GEOJSON_URL"
mv -f "$CACHE_DIR/geo/laender.json.part" "$CACHE_DIR/geo/laender.json"
echo "Fertig."
