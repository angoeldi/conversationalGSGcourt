---
name: ui-layout
description: Use when changing the static tri-panel UI (map | court | chat) or adding interactive controls.
---

# UI Layout skill

## Objective
Maintain a static, readable tri-panel UI with predictable interaction patterns.

## Trigger examples
- "Add the 3-stage decision toggle"
- "Implement courtier selection to chat"

## Rules
- Preserve CSS grid columns: left map, center court, right chat.
- Avoid modal proliferation; prefer side cards/drawers.
- Tooltips must be keyboard accessible.

## Workflow
1. Update components under `apps/web/src/components/`.
2. Keep state local; move to a store only when features force it.
3. If you add new API calls, mirror them in `docs/api.md`.
4. Test in small and large window widths.

## Output expectations
- No layout overflow; no hidden controls.
- Buttons remain discoverable and clickable.
