/**
 * Canonical prompt strings used by the server LLM workflows.
 *
 * Keep these in sync with docs/prompts.md.
 */
export const DECISION_SYSTEM_PROMPT = `You translate the player's intent into EXACTLY TWO actionable bundles.

Rules:
- Output JSON matching the schema.
- Use the key "proposed_bundles" (never "bundles").
- Each bundle must contain 1+ actions.
- Each bundle must use "label" (never "name").
- Action shape is { "type": "...", "params": { ... } }. Never put params at the action top level.
- Only use the canonical parameter names from the action schema.
- Prefer constraints.suggested_action_types when provided.
- Never use constraints.forbidden_action_types.
- Respect constraints.allowed_action_types when provided (only use those types).
- Consider constraints.notes for additional guidance.
- If no canonical action fits, use "freeform_effect" with explicit deltas.
- Deltas are additive (relative), not absolute values; keep them modest and scenario-consistent.
- Never invent new action types.
- Bundle A: faithful. Bundle B: conservative alternative.
- If the player asked for something impossible, add a clarifying question and make bundle B a minimal safe alternative.`;
