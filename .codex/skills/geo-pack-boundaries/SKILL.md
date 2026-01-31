---
name: geo-pack-boundaries
description: Manage map boundary datasets (geo packs) and scenario region mappings. Use when adding or swapping boundary sources, aligning scenario.geo_pack with map layers, or remapping region_assignments to a new boundary dataset.
---

# Geo pack boundaries

## Quick workflow
1) Pick the boundary dataset and decide whether to vendor locally.
2) Register the dataset in `apps/web/src/components/MapPanel.tsx` under `GEO_PACKS`.
3) Update the scenario `geo_pack` and `region_assignments` to match the dataset’s feature IDs.
4) Validate political mode renders expected ownership shading.

## Register a geo pack (MapPanel)
- Add a `GEO_PACKS` entry with:
  - `id`: matches `scenario.geo_pack.id`.
  - `boundariesLocalPath`: local path to GeoJSON.
  - `boundariesRemoteUrl`: remote URL to GeoJSON.
  - `featureIdProperty`: the feature field used as the region identifier (e.g., `name`).
  - `ownerProperty`: the feature field used for fallback political shading (e.g., `admin`).
- Keep `DEFAULT_GEO_PACK` pointing to a stable dataset.

## Scenario update recipe (per start scenario)
1) Set `scenario.geo_pack.id` + `scenario.geo_pack.version` for the scenario.
2) Update `scenario.region_assignments[].geo_region_id` to **exactly** match `featureIdProperty` values from the dataset.
3) Keep `scenario.region_assignments[].nation_id` as the nation owner.
4) If you changed `geo_pack` for an existing save, re-run any server seeding that depends on regions.

### Align borders for a new start scenario
- Use admin-0 if you only need country borders. Use admin-1 only if you have region-level assignments.
- For admin-0: `featureIdProperty` and `ownerProperty` should both be `ADMIN` (country name).
- For admin-1: use `name` for feature ids and keep province-level `region_assignments`.
- Ensure scenario nation names match the dataset’s country names if you rely on treaty/war coloring.

## Legacy ids fallback
MapPanel supports a fallback match when `region_assignments` use legacy ids (e.g., `england-cornwall`):
- It lowercases the id and also tries a trimmed version without the prefix (e.g., `cornwall`).
- This is a convenience only. Prefer exact dataset ids for stability.

## Local vs remote datasets
- **Local**: store GeoJSON under `apps/web/public/data/geo/` and use `/data/geo/...` paths.
- **Remote**: use `boundariesRemoteUrl` directly. Good for prototyping but not production.
- Optional helper: `scripts/fetch-geo-pack.sh` downloads the Natural Earth admin-0/admin-1 + land/coastline files into the public folder.

## Natural Earth notes
- For admin-1 boundaries, load `references/ne-admin1.md`.
- For admin-0 country outlines, use `ne_110m_admin_0_countries.geojson` (included in the fetch script).

## Country catalog (admin-0 map shading)
To shade all admin-0 countries and provide hover info:
1) Ensure `apps/web/public/data/geo/ne_110m_admin_0_countries.geojson` exists (run `scripts/fetch-geo-pack.sh`).
2) Run `node scripts/build-country-catalog.js` to regenerate `apps/server/data/country_catalog.json`.
3) Server loads the catalog via `apps/server/src/lib/countryCatalog.ts` and exposes `nation_directory` from `/api/game/state`.
4) The client uses `nation_directory` to build map names + hover summaries.

## Historical country hover info (recipe)
Goal: show non-player countries’ historical context without letting the LLM mutate their state.

Recommended approach:
1) Add a CPU-side “trajectory” model (e.g., linear per decade) to world state or a sidecar table.
2) Store baseline metrics for each nation at scenario start (GDP, population, stability, etc.).
3) Define deterministic deltas per decade and apply them each tick on the engine side.
4) Let the LLM only output **buff/debuff modifiers** to the trajectory inputs (never direct state).
5) Surface hover cards by combining:
   - current simulated snapshot (from engine/world state)
   - short historical notes (scenario metadata)
   - relation status (treaties, war)

If you persist new JSONB (trajectory model), add schema + Zod mirror.

## 1492 baseline stats overrides
The 1492 scenario seeds GDP/pop from `apps/server/data/world_1492_overrides.json`.
- Keep overrides aligned with `scenario.geo_pack` ids (nation_id).
- Update the file when recalibrating historical stats or adjusting the 1492 geo pack.
- Example generator: `node scripts/build-world-1492-overrides.mjs --out apps/server/data/world_1492_overrides.json`.

## Scenario-specific historical borders (lightweight split overlay)
When modern admin-0 borders are close but need historical tweaks (e.g., 1492), use a split overlay instead of replacing the whole dataset.

Recipe:
1) Keep the base admin-0 GeoJSON (modern borders) under `apps/web/public/data/geo/scenarios/<year>/admin0.geojson`.
2) Define split regions as **bounding boxes** in `scripts/data/<year>-split-bboxes.json`.
3) Run `node scripts/build-<year>-geo-pack.js` to generate overlay features:
   - Clipped polygons are tagged with `overlay: true` and a scenario-specific field (e.g., `ADMIN_1492`).
   - This is additive only (no geometry union), so it’s safe and dependency-free.
4) In `MapPanel`, prefer the scenario-specific field for political coloring (e.g., `ADMIN_1492`).

Notes:
- Bbox clip is intentionally simple (no polygon union). Use it to **add** historical regions (e.g., Brittany, Granada).
- If you need to **subtract** a region, add an overlay for the remainder area instead.
- Keep overlays small and localized so coastlines remain credible.
- Document each split with a short note in the scenario README.
