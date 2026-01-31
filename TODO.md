# TODO

## Urgent
- Fix 401 auth failures from LLM providers: `{"statusCode":401,"code":"invalid_api_key","error":"Unauthorized","message":"401 Invalid API Key"}`.

## Visual + Map
- Unrest mode: replace full-country shading with points-of-interest overlays (cities/hotspots), and clarify how unrest intensity is visualized.

## UX + Tutorial

## UX + Content

## Systems

## Confirm
- Replace the placeholder map with a real world map (coastlines + landmasses) using a locally stored tileset or GeoJSON, then layer ownership/region data via DB-driven queries.
- Add portrait rendering (ideally generative) with caching and fallbacks; wire into Court panel portraits.
- Guided tutorial popups (1 of X) that highlight each major UI element in sequence.
- Include a "Don't show again" option; auto-run on first tick only.
- Add an always-available info button (upper right) to restart the tutorial.
- Persist chat transcripts and decisions to the DB; queue decisions for processing on the next tick.
- Simulate non-player nation trajectories on the engine (per-decade linear drift); LLM can only add buffs/debuffs to the trajectory inputs.
- Seed a nation directory from the admin-0 catalog so the political map can shade all countries.
- Avoid truncated petition content; Wikipedia context should not live in hover tooltips and should be presented outside the petition message body.
- Introduce an immersive court backdrop (SVG/illustration/parallax layers) inspired by AoE/Stronghold/EU.
- Economic/Military/Unrest map modes: improve shading contrast and verify metric mapping across all polities.
- Make selected polity borders much more pronounced vs. internal borders (e.g. Delhi vs. modern Pakistan split).
- Reposition the tutorial (i) and action-log (A) controls so they don't feel awkward or overlap content.
- Align the background pattern to the panels so it reads as an intentional motif across all three panes.
