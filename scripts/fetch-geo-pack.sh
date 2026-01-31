#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/apps/web/public/data/geo"

LAND_URL="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson"
COASTLINE_URL="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_coastline.geojson"
ADMIN1_URL="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_1_states_provinces.geojson"
ADMIN0_URL="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson"

mkdir -p "$OUT_DIR"

curl -L "$LAND_URL" -o "$OUT_DIR/ne_110m_land.geojson"
curl -L "$COASTLINE_URL" -o "$OUT_DIR/ne_110m_coastline.geojson"
curl -L "$ADMIN1_URL" -o "$OUT_DIR/ne_110m_admin_1_states_provinces.geojson"
curl -L "$ADMIN0_URL" -o "$OUT_DIR/ne_110m_admin_0_countries.geojson"

echo "Geo pack files downloaded to $OUT_DIR"
