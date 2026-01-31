# 1492 Scenario Geo Pack

This folder contains scenario-specific boundaries for the 1492 start date.

- Source base: Natural Earth admin-0 (`apps/web/public/data/geo/ne_110m_admin_0_countries.geojson`).
- Transform: `node scripts/build-1492-geo-pack.js`.
- Polity mapping: `scripts/data/1492-polity-map.json`.
- Split overlays (approximate historical borders): `scripts/data/1492-split-bboxes.json`.

The build script:
- Moves Northern Ireland into Ireland.
- Assigns each modern admin-0 feature a 1492-era polity label (`ADMIN_1492`).
- Adds `nation_id` so the map can still bind to world-state stats.
- Adds overlay polygons for select historical splits (e.g., Scotland, Aragon, Granada, Papal States).

This is intentionally approximate; it prioritizes broad historical plausibility and gameplay readability over exact borders.
