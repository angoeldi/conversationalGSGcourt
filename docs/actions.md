# Action catalog (v1)

This is the canonical list of action types. All effects on ground truth must be implemented as Actions.

Source of truth:
- Zod: `packages/shared/src/schemas/action.ts`
- JSON Schema: `schemas/action.schema.json`

## General rules
- Validate **params** with schema first.
- Then validate **preconditions** against ground truth (laws, institutions, capacity, geography).
- Apply deterministic effects; resolve risk using seeded RNG; log `action_effects`.
- Budgeted actions create operations and spend treasury over their duration (weekly), not all at once.

## Actions

### Diplomacy
- `send_envoy` {target_nation_id, message_tone, topic, offer?}
  - Valid if: target exists.
  - Default effects: small relation delta based on tone.

- `improve_relations` {target_nation_id, budget, message_tone, duration_weeks}
  - Valid if: treasury >= budget.
  - Effects: create `diplomacy_campaign` operation; gradual relation improvement.

- `sign_treaty` {target_nation_id, treaty_type, concessions[]}
  - Valid if: not at war unless treaty_type supports it.
  - Effects: add treaty flag; relations bump/dip; possible economic modifiers.

- `issue_ultimatum` {target_nation_id, demand, deadline_weeks, backdown_cost_legitimacy}
  - Valid if: diplomatic channel exists.
  - Effects: relations decrease; creates an ultimatum operation that may cost legitimacy on failure.

- `sanction` {target_nation_id, scope, severity, duration_weeks}
  - Valid if: trade access exists.
  - Effects: GDP/trade modifiers; relations decrease.

- `recognize_claim` {target_nation_id, claim, public}
  - Effects: relation delta with target and third parties; legitimacy among factions.

### Intrigue
- `send_spy` {target_nation_id, objective, budget, duration_weeks, risk_tolerance}
  - Valid if: treasury >= budget.
  - Effects: create `spy_operation`; on exposure relations penalty.

- `counterintelligence` {budget, focus, duration_weeks}
  - Effects: reduces exposure chance and increases intel quality.

- `fund_faction` {target_nation_id, faction, weekly_amount, duration_weeks, secrecy}
  - Effects: spawns influence operation; risk of scandal.

- `leak_story` {target, narrative, plausibility}
  - Effects: perception shocks; may affect stability/relations.

### Finance/Economy
- `adjust_tax_rate` {new_tax_rate, rationale?}
  - Effects: revenue via tick; higher rates reduce compliance/stability.

- `issue_debt` {amount, interest_rate_annual, maturity_weeks}
  - Effects: treasury up, debt up; debt service via tick.

- `cut_spending` {category, weekly_amount, duration_weeks}
  - Effects: creates a spending_cut operation with weekly savings; applies a one-time downside on completion.

- `fund_project` {project_type, province_id?, budget, duration_weeks}
  - Effects: creates operation; applies project benefits when the operation completes.

- `subsidize_sector` {sector, weekly_amount, duration_weeks}
  - Effects: creates operation; boosts GDP/stability on completion.

### Interior
- `appoint_official` {office_id, character_id}
  - Preconditions: office exists; character exists.

- `reform_law` {law_key, change, political_capital_cost}
  - Preconditions: institution constraints; IG approval.

- `crackdown` {province_id?, intensity, duration_weeks, budget}
  - Effects: immediate unrest reduction with later backlash when the operation resolves.

### Military
- `mobilize` {scope, target_readiness}
  - Effects: readiness up; stability down.

- `raise_levies` {province_id?, manpower}
  - Preconditions: manpower pool sufficient.

- `fortify` {province_id, level_increase, budget, duration_weeks}
  - Effects: defense multiplier, infrastructure.

- `deploy_force` {from_province_id, to_province_id, units}
  - Preconditions: units available; path exists.

- `reorganize_army` {focus, budget, duration_weeks}
  - Effects: readiness/supply and future combat multipliers.

### Meta
- `freeform_effect` {summary, target_nation_id?, nation_deltas{}, province_id?, province_deltas{}, relation_deltas[], limit_deltas?, note?}
  - Use when canonical actions do not fit; keep deltas modest and scenario-consistent.
  - `nation_deltas` and `province_deltas` are additive changes (relative values), not absolute sets.
  - If `limit_deltas` is true, the engine applies conservative caps to each delta.
  - Effects: applies numeric deltas to nation/province stats and relation scores (clamped to valid ranges).

- `create_committee` {topic, chair_character_id?, duration_weeks, budget}
  - Effects: improves information quality (perception) next weeks; spawns tasks.

- `apply_trajectory_modifier` {target_nation_id, metric, delta, duration_weeks, note?}
  - Valid if: target is NOT the player nation.
  - Effects: applies deterministic buffs/debuffs to a nation’s long-run trajectory (GDP/population/stability/literacy).
