import { Action as ActionSchema } from "@thecourt/shared";
import type { Action } from "@thecourt/shared";
import type {
  ApplyResult,
  EngineContext,
  WorldState,
  ActionEffect,
  NationState,
  RelationEdge,
  Operation,
  TrajectoryModifier,
  AppointmentState,
  DebtInstrument
} from "./state";
import { mulberry32, rngInt } from "./rng";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function getRelation(relations: RelationEdge[], from: string, to: string): RelationEdge {
  const existing = relations.find((r) => r.from_nation_id === from && r.to_nation_id === to);
  if (existing) return existing;
  const created: RelationEdge = { from_nation_id: from, to_nation_id: to, value: 0, treaties: [], at_war: false };
  relations.push(created);
  return created;
}

function patchNation(n: NationState, changes: Partial<NationState>): NationState {
  return { ...n, ...changes };
}

function addOperation(state: WorldState, op: Operation): WorldState {
  return { ...state, operations: [...state.operations, op] };
}

export function applyActionBundle(state: WorldState, actions: Action[], ctx: EngineContext): ApplyResult {
  let next = structuredClone(state) as WorldState;
  const effects: ActionEffect[] = [];
  const applied: Action[] = [];

  for (const a of actions) {
    const parsed = ActionSchema.parse(a);
    const res = applySingleAction(next, parsed, ctx);
    next = res.next_state;
    effects.push(...res.effects);
    applied.push(parsed);
  }

  return { next_state: next, effects, applied_actions: applied };
}

export function applySingleAction(state: WorldState, action: Action, ctx: EngineContext): { next_state: WorldState; effects: ActionEffect[] } {
  const rng = mulberry32(hashSeed(ctx.turn_seed, ctx.turn_index, stableActionKey(action)));
  const effects: ActionEffect[] = [];
  const playerNationId = state.player_nation_id ?? inferPlayerNationId(state);
  const n0 = state.nations;

  const reject = (reason: string, delta: Record<string, unknown> = {}) => {
    effects.push({
      effect_type: "action.rejected",
      delta: { type: action.type, reason, ...delta },
      audit: {}
    });
    return { next_state: state, effects };
  };

  const requireNation = (nationId: string | undefined, reason = "nation_not_found") => {
    if (!nationId) return reject(reason);
    if (!state.nations[nationId]) return reject(reason, { target_nation_id: nationId });
    return null;
  };

  const requireTreasury = (nation: NationState, amount: number) => {
    if (nation.treasury < amount) {
      return reject("insufficient_treasury", { required: amount, treasury: nation.treasury });
    }
    return null;
  };

  switch (action.type) {
    case "adjust_tax_rate": {
      const { new_tax_rate } = action.params;
      const n = n0[playerNationId];
      const before = n.tax_rate;
      state.nations[playerNationId] = patchNation(n, { tax_rate: new_tax_rate });
      effects.push({
        effect_type: "nation.tax_rate",
        delta: { nation_id: playerNationId, from: before, to: new_tax_rate },
        audit: { rationale: action.params.rationale ?? null }
      });
      return { next_state: state, effects };
    }

    case "issue_debt": {
      const n = n0[playerNationId];
      const instrument: DebtInstrument = {
        instrument_id: cryptoRandomId(rng),
        nation_id: playerNationId,
        principal: action.params.amount,
        interest_rate_annual: action.params.interest_rate_annual,
        remaining_weeks: action.params.maturity_weeks,
        issued_turn: ctx.turn_index
      };
      state.debt_instruments = [...(state.debt_instruments ?? []), instrument];
      state.nations[playerNationId] = patchNation(n, {
        treasury: n.treasury + action.params.amount,
        debt: n.debt + action.params.amount
      });
      effects.push({
        effect_type: "nation.debt_issued",
        delta: {
          nation_id: playerNationId,
          amount: action.params.amount,
          interest_rate_annual: action.params.interest_rate_annual,
          maturity_weeks: action.params.maturity_weeks,
          instrument_id: instrument.instrument_id
        },
        audit: {}
      });
      return { next_state: state, effects };
    }

    case "send_spy": {
      const actor = n0[playerNationId];
      const budget = action.params.budget;
      const rejectResult = requireTreasury(actor, budget);
      if (rejectResult) return rejectResult;

      const op = buildBudgetedOperation(rng, {
        type: "spy_operation",
        nation_id: playerNationId,
        target_nation_id: action.params.target_nation_id,
        remaining_weeks: action.params.duration_weeks,
        budget_total: budget,
        meta: { objective: action.params.objective, risk_tolerance: action.params.risk_tolerance }
      });
      state = addOperation(state, op);

      const exposureRoll = rngInt(rng, 1, 100);
      const exposureChance = action.params.risk_tolerance === "high" ? 10 : action.params.risk_tolerance === "medium" ? 6 : 3;
      const exposed = exposureRoll <= exposureChance;
      if (exposed) {
        const rel = getRelation(state.relations, action.params.target_nation_id, playerNationId);
        rel.value = clamp(rel.value - 5, -100, 100);
        effects.push({
          effect_type: "intrigue.spy_exposed",
          delta: { target_nation_id: action.params.target_nation_id },
          audit: { roll: exposureRoll, chance: exposureChance }
        });
      }

      effects.push({
        effect_type: "operation.created",
        delta: { operation: op },
        audit: { budget_total: budget }
      });

      return { next_state: state, effects };
    }

    case "counterintelligence": {
      const actor = n0[playerNationId];
      const budget = action.params.budget;
      const rejectResult = requireTreasury(actor, budget);
      if (rejectResult) return rejectResult;

      const op = buildBudgetedOperation(rng, {
        type: "counterintelligence",
        nation_id: playerNationId,
        remaining_weeks: action.params.duration_weeks,
        budget_total: budget,
        meta: { focus: action.params.focus }
      });
      state = addOperation(state, op);
      effects.push({
        effect_type: "operation.created",
        delta: { operation: op },
        audit: {}
      });
      return { next_state: state, effects };
    }

    case "send_envoy": {
      const target = action.params.target_nation_id;
      const missing = requireNation(target);
      if (missing) return missing;

      const rel = getRelation(state.relations, playerNationId, target);
      const toneDelta = action.params.message_tone === "conciliatory"
        ? 3
        : action.params.message_tone === "firm"
          ? 1
          : action.params.message_tone === "hostile"
            ? -4
            : 2;
      rel.value = clamp(rel.value + toneDelta, -100, 100);

      effects.push({
        effect_type: "diplomacy.envoy_sent",
        delta: { from_nation_id: playerNationId, target_nation_id: target, relation_delta: toneDelta, topic: action.params.topic },
        audit: { offer: action.params.offer ?? null }
      });

      return { next_state: state, effects };
    }

    case "improve_relations": {
      const target = action.params.target_nation_id;
      const missing = requireNation(target);
      if (missing) return missing;

      const actor = n0[playerNationId];
      const budget = action.params.budget;
      const rejectResult = requireTreasury(actor, budget);
      if (rejectResult) return rejectResult;

      const op = buildBudgetedOperation(rng, {
        type: "diplomacy_campaign",
        nation_id: playerNationId,
        target_nation_id: target,
        remaining_weeks: action.params.duration_weeks,
        budget_total: budget,
        meta: { message_tone: action.params.message_tone }
      });
      state = addOperation(state, op);

      effects.push({ effect_type: "operation.created", delta: { operation: op }, audit: {} });
      return { next_state: state, effects };
    }

    case "sign_treaty": {
      const target = action.params.target_nation_id;
      const missing = requireNation(target);
      if (missing) return missing;

      const relA = getRelation(state.relations, playerNationId, target);
      const relB = getRelation(state.relations, target, playerNationId);
      const atWar = relA.at_war || relB.at_war;
      const allowDuringWar = new Set(["non_aggression", "alliance"]);
      if (atWar && !allowDuringWar.has(action.params.treaty_type)) {
        return reject("treaty_not_valid_during_war", { target_nation_id: target, treaty_type: action.params.treaty_type });
      }

      const baseDelta = TREATY_RELATION_DELTA[action.params.treaty_type] ?? 3;
      const delta = atWar ? baseDelta + 2 : baseDelta;

      relA.value = clamp(relA.value + delta, -100, 100);
      relB.value = clamp(relB.value + delta, -100, 100);
      relA.treaties = mergeTreaty(relA.treaties, action.params.treaty_type, action.params.concessions);
      relB.treaties = mergeTreaty(relB.treaties, action.params.treaty_type, action.params.concessions);
      if (atWar) {
        relA.at_war = false;
        relB.at_war = false;
      }

      effects.push({
        effect_type: "diplomacy.treaty_signed",
        delta: { from_nation_id: playerNationId, target_nation_id: target, treaty_type: action.params.treaty_type, relation_delta: delta },
        audit: { concessions: action.params.concessions }
      });

      return { next_state: state, effects };
    }

    case "issue_ultimatum": {
      const target = action.params.target_nation_id;
      const missing = requireNation(target);
      if (missing) return missing;

      const rel = getRelation(state.relations, playerNationId, target);
      rel.value = clamp(rel.value - 8, -100, 100);

      const op: Operation = {
        operation_id: cryptoRandomId(rng),
        type: "ultimatum",
        nation_id: playerNationId,
        target_nation_id: target,
        remaining_weeks: action.params.deadline_weeks,
        meta: { demand: action.params.demand, backdown_cost_legitimacy: action.params.backdown_cost_legitimacy }
      };
      state = addOperation(state, op);

      effects.push({
        effect_type: "diplomacy.ultimatum_issued",
        delta: { target_nation_id: target, relation_delta: -8, deadline_weeks: action.params.deadline_weeks },
        audit: { demand: action.params.demand }
      });

      return { next_state: state, effects };
    }

    case "sanction": {
      const target = action.params.target_nation_id;
      const missing = requireNation(target);
      if (missing) return missing;
      if (target === playerNationId) {
        return reject("target_is_player", { target_nation_id: target });
      }

      const rel = getRelation(state.relations, playerNationId, target);
      const relationDelta = -2 * action.params.severity;
      rel.value = clamp(rel.value + relationDelta, -100, 100);

      const gdpMod: TrajectoryModifier = {
        modifier_id: cryptoRandomId(rng),
        nation_id: target,
        metric: "gdp_growth_decade",
        delta: -0.015 * action.params.severity,
        remaining_weeks: action.params.duration_weeks,
        source: "sanction"
      };
      const stabilityMod: TrajectoryModifier = {
        modifier_id: cryptoRandomId(rng),
        nation_id: target,
        metric: "stability_drift_decade",
        delta: -0.3 * action.params.severity,
        remaining_weeks: action.params.duration_weeks,
        source: "sanction"
      };
      state.trajectory_modifiers = [...(state.trajectory_modifiers ?? []), gdpMod, stabilityMod];

      effects.push({
        effect_type: "diplomacy.sanctioned",
        delta: { target_nation_id: target, relation_delta: relationDelta, severity: action.params.severity },
        audit: { scope: action.params.scope, duration_weeks: action.params.duration_weeks }
      });
      effects.push({
        effect_type: "trajectory.modifier_added",
        delta: { modifier: gdpMod },
        audit: {}
      });
      effects.push({
        effect_type: "trajectory.modifier_added",
        delta: { modifier: stabilityMod },
        audit: {}
      });
      return { next_state: state, effects };
    }

    case "recognize_claim": {
      const target = action.params.target_nation_id;
      const missing = requireNation(target);
      if (missing) return missing;

      const rel = getRelation(state.relations, playerNationId, target);
      const delta = action.params.public ? 4 : 2;
      rel.value = clamp(rel.value + delta, -100, 100);

      effects.push({
        effect_type: "diplomacy.claim_recognized",
        delta: { target_nation_id: target, relation_delta: delta, public: action.params.public },
        audit: { claim: action.params.claim }
      });

      return { next_state: state, effects };
    }

    case "cut_spending": {
      const op: Operation = {
        operation_id: cryptoRandomId(rng),
        type: "spending_cut",
        nation_id: playerNationId,
        remaining_weeks: action.params.duration_weeks,
        meta: { category: action.params.category, weekly_amount: action.params.weekly_amount }
      };
      state = addOperation(state, op);
      effects.push({
        effect_type: "economy.spending_cut_started",
        delta: { category: action.params.category, weekly_amount: action.params.weekly_amount, duration_weeks: action.params.duration_weeks },
        audit: {}
      });
      return { next_state: state, effects };
    }

    case "fund_project": {
      const actor = n0[playerNationId];
      const rejectResult = requireTreasury(actor, action.params.budget);
      if (rejectResult) return rejectResult;

      const provinceId = resolveProvinceId(state, playerNationId, action.params.province_id);
      if (!provinceId) return reject("province_not_found");

      const op = buildBudgetedOperation(rng, {
        type: "fund_project",
        nation_id: playerNationId,
        remaining_weeks: action.params.duration_weeks,
        budget_total: action.params.budget,
        meta: { project_type: action.params.project_type, province_id: provinceId }
      });
      state = addOperation(state, op);

      effects.push({
        effect_type: "operation.created",
        delta: { operation: op },
        audit: { project_type: action.params.project_type, province_id: provinceId }
      });

      return { next_state: state, effects };
    }

    case "subsidize_sector": {
      const actor = n0[playerNationId];
      const total = action.params.weekly_amount * action.params.duration_weeks;
      const rejectResult = requireTreasury(actor, total);
      if (rejectResult) return rejectResult;

      const op = buildBudgetedOperation(rng, {
        type: "sector_subsidy",
        nation_id: playerNationId,
        remaining_weeks: action.params.duration_weeks,
        budget_total: total,
        meta: { sector: action.params.sector, weekly_amount: action.params.weekly_amount }
      });
      state = addOperation(state, op);
      effects.push({
        effect_type: "operation.created",
        delta: { operation: op },
        audit: { sector: action.params.sector, weekly_amount: action.params.weekly_amount }
      });
      return { next_state: state, effects };
    }

    case "appoint_official": {
      const appointments: AppointmentState[] = [...(state.appointments ?? [])];
      const existing = appointments.find((entry) => entry.office_id === action.params.office_id);
      if (existing) {
        existing.character_id = action.params.character_id;
        existing.start_turn = ctx.turn_index;
      } else {
        appointments.push({
          office_id: action.params.office_id,
          character_id: action.params.character_id,
          start_turn: ctx.turn_index
        });
      }
      state.appointments = appointments;

      effects.push({
        effect_type: "court.appointment_made",
        delta: { office_id: action.params.office_id, character_id: action.params.character_id },
        audit: { start_turn: ctx.turn_index }
      });
      return { next_state: state, effects };
    }

    case "reform_law": {
      const n = n0[playerNationId];
      const laws = new Set(n.laws ?? []);
      if (action.params.change === "repeal") {
        laws.delete(action.params.law_key);
      } else {
        laws.add(action.params.law_key);
      }
      const legitDelta = -Math.min(5, Math.max(0, action.params.political_capital_cost) / 5);
      state.nations[playerNationId] = patchNation(n, {
        laws: Array.from(laws.values()),
        legitimacy: clamp(n.legitimacy + legitDelta, 0, 100)
      });
      effects.push({
        effect_type: "law.reformed",
        delta: { law_key: action.params.law_key, change: action.params.change, legitimacy_delta: legitDelta },
        audit: { political_capital_cost: action.params.political_capital_cost }
      });
      return { next_state: state, effects };
    }

    case "crackdown": {
      const actor = n0[playerNationId];
      const rejectResult = requireTreasury(actor, action.params.budget);
      if (rejectResult) return rejectResult;

      const provinceId = resolveProvinceId(state, playerNationId, action.params.province_id);
      if (!provinceId) return reject("province_not_found");

      const province = state.provinces[provinceId];
      const unrestDelta = -5 * action.params.intensity;
      const complianceDelta = -0.02 * action.params.intensity;
      const stabilityDelta = -0.6 * action.params.intensity;
      state.provinces[provinceId] = {
        ...province,
        unrest: clamp(province.unrest + unrestDelta, 0, 100),
        compliance_local: clamp(province.compliance_local + complianceDelta, 0, 1)
      };
      state.nations[playerNationId] = patchNation(actor, {
        stability: clamp(actor.stability + stabilityDelta, 0, 100)
      });

      const op: Operation = {
        operation_id: cryptoRandomId(rng),
        type: "crackdown",
        nation_id: playerNationId,
        remaining_weeks: action.params.duration_weeks,
        meta: { intensity: action.params.intensity, province_id: provinceId }
      };
      state = addOperation(state, op);

      effects.push({
        effect_type: "interior.crackdown",
        delta: { province_id: provinceId, unrest_delta: unrestDelta, compliance_delta: complianceDelta, stability_delta: stabilityDelta },
        audit: { intensity: action.params.intensity, duration_weeks: action.params.duration_weeks }
      });

      return { next_state: state, effects };
    }

    case "mobilize": {
      const n = n0[playerNationId];
      const readinessBump = action.params.scope === "general" ? 0.12 : 0.07;
      state.nations[playerNationId] = patchNation(n, {
        readiness: clamp(Math.max(n.readiness, action.params.target_readiness) + readinessBump, 0, 1),
        stability: clamp(n.stability - (action.params.scope === "general" ? 1.5 : 0.8), 0, 100)
      });
      effects.push({ effect_type: "military.mobilized", delta: { scope: action.params.scope }, audit: {} });
      return { next_state: state, effects };
    }

    case "raise_levies": {
      const n = n0[playerNationId];
      const manpower = action.params.manpower;
      if (n.manpower_pool < manpower) {
        return reject("insufficient_manpower", { required: manpower, available: n.manpower_pool });
      }
      const stabilityDelta = -Math.min(5, manpower / 1000);
      state.nations[playerNationId] = patchNation(n, {
        manpower_pool: Math.max(0, n.manpower_pool - manpower),
        force_size: n.force_size + manpower,
        stability: clamp(n.stability + stabilityDelta, 0, 100)
      });
      effects.push({
        effect_type: "military.levies_raised",
        delta: { manpower, stability_delta: stabilityDelta },
        audit: { province_id: action.params.province_id ?? null }
      });
      return { next_state: state, effects };
    }

    case "fortify": {
      const actor = n0[playerNationId];
      const rejectResult = requireTreasury(actor, action.params.budget);
      if (rejectResult) return rejectResult;

      const provinceId = resolveProvinceId(state, playerNationId, action.params.province_id);
      if (!provinceId) return reject("province_not_found");

      const op = buildBudgetedOperation(rng, {
        type: "fortify",
        nation_id: playerNationId,
        remaining_weeks: action.params.duration_weeks,
        budget_total: action.params.budget,
        meta: { province_id: provinceId, level_increase: action.params.level_increase }
      });
      state = addOperation(state, op);
      effects.push({
        effect_type: "operation.created",
        delta: { operation: op },
        audit: { province_id: provinceId, level_increase: action.params.level_increase }
      });
      return { next_state: state, effects };
    }

    case "deploy_force": {
      const fromId = action.params.from_province_id;
      const toId = action.params.to_province_id;
      if (!state.provinces[fromId] || !state.provinces[toId]) {
        return reject("province_not_found", { from_province_id: fromId, to_province_id: toId });
      }
      const from = state.provinces[fromId];
      if (from.nation_id !== playerNationId) {
        return reject("province_not_owned", { province_id: fromId });
      }
      const to = state.provinces[toId];
      const move = Math.min(action.params.units, from.garrison);
      if (move <= 0) return reject("insufficient_garrison", { province_id: fromId });

      state.provinces[fromId] = { ...from, garrison: from.garrison - move };
      state.provinces[toId] = { ...to, garrison: to.garrison + move };

      effects.push({
        effect_type: "military.force_deployed",
        delta: { from_province_id: fromId, to_province_id: toId, units: move },
        audit: {}
      });
      return { next_state: state, effects };
    }

    case "reorganize_army": {
      const actor = n0[playerNationId];
      const rejectResult = requireTreasury(actor, action.params.budget);
      if (rejectResult) return rejectResult;

      const op = buildBudgetedOperation(rng, {
        type: "reorganize_army",
        nation_id: playerNationId,
        remaining_weeks: action.params.duration_weeks,
        budget_total: action.params.budget,
        meta: { focus: action.params.focus }
      });
      state = addOperation(state, op);
      effects.push({
        effect_type: "operation.created",
        delta: { operation: op },
        audit: { focus: action.params.focus }
      });
      return { next_state: state, effects };
    }

    case "fund_faction": {
      const target = action.params.target_nation_id;
      const missing = requireNation(target);
      if (missing) return missing;

      const total = action.params.weekly_amount * action.params.duration_weeks;
      const actor = n0[playerNationId];
      const rejectResult = requireTreasury(actor, total);
      if (rejectResult) return rejectResult;

      const op = buildBudgetedOperation(rng, {
        type: "fund_faction",
        nation_id: playerNationId,
        target_nation_id: target,
        remaining_weeks: action.params.duration_weeks,
        budget_total: total,
        meta: { faction: action.params.faction, secrecy: action.params.secrecy, weekly_amount: action.params.weekly_amount }
      });
      state = addOperation(state, op);
      effects.push({
        effect_type: "intrigue.faction_funded",
        delta: { target_nation_id: target, faction: action.params.faction },
        audit: { secrecy: action.params.secrecy, weekly_amount: action.params.weekly_amount }
      });
      return { next_state: state, effects };
    }

    case "leak_story": {
      const target = action.params.target;
      const targetNation = state.nations[target];
      if (targetNation) {
        const delta = -Math.max(1, Math.round(3 * (1 - action.params.plausibility)));
        state.nations[target] = patchNation(targetNation, {
          stability: clamp(targetNation.stability + delta, 0, 100)
        });
        const rel = getRelation(state.relations, playerNationId, target);
        rel.value = clamp(rel.value + delta, -100, 100);
        effects.push({
          effect_type: "intrigue.story_leaked",
          delta: { target_nation_id: target, stability_delta: delta, relation_delta: delta },
          audit: { narrative: action.params.narrative, plausibility: action.params.plausibility }
        });
        return { next_state: state, effects };
      }

      effects.push({
        effect_type: "intrigue.story_leaked",
        delta: { target, stability_delta: 0, relation_delta: 0 },
        audit: { narrative: action.params.narrative, plausibility: action.params.plausibility }
      });
      return { next_state: state, effects };
    }

    case "create_committee": {
      const actor = n0[playerNationId];
      const rejectResult = requireTreasury(actor, action.params.budget);
      if (rejectResult) return rejectResult;

      const op = buildBudgetedOperation(rng, {
        type: "committee",
        nation_id: playerNationId,
        remaining_weeks: action.params.duration_weeks,
        budget_total: action.params.budget,
        meta: { topic: action.params.topic, chair_character_id: action.params.chair_character_id ?? null }
      });
      state = addOperation(state, op);
      effects.push({
        effect_type: "operation.created",
        delta: { operation: op },
        audit: { topic: action.params.topic, chair_character_id: action.params.chair_character_id ?? null }
      });
      return { next_state: state, effects };
    }

    case "apply_trajectory_modifier": {
      if (action.params.target_nation_id === playerNationId) {
        effects.push({
          effect_type: "action.rejected",
          delta: { type: action.type, reason: "target_is_player", target_nation_id: action.params.target_nation_id },
          audit: {}
        });
        return { next_state: state, effects };
      }
      const mod: TrajectoryModifier = {
        modifier_id: cryptoRandomId(rng),
        nation_id: action.params.target_nation_id,
        metric: action.params.metric,
        delta: action.params.delta,
        remaining_weeks: action.params.duration_weeks,
        source: "llm",
        note: action.params.note ?? undefined
      };
      state.trajectory_modifiers = [...(state.trajectory_modifiers ?? []), mod];
      effects.push({
        effect_type: "trajectory.modifier_added",
        delta: { modifier: mod },
        audit: {}
      });
      return { next_state: state, effects };
    }

    case "freeform_effect": {
      const limitDeltas = Boolean(action.params.limit_deltas);
      const requestedNationId = action.params.target_nation_id;
      const targetNationId = requestedNationId && state.nations[requestedNationId] ? requestedNationId : playerNationId;
      const nation = state.nations[targetNationId];
      const appliedNation = nation
        ? applyNumericDeltas(nation, action.params.nation_deltas ?? {}, NATION_DELTA_RULES, limitDeltas)
        : null;

      if (appliedNation?.updated) {
        state.nations[targetNationId] = appliedNation.updated;
      }

      const provinceId = action.params.province_id ?? inferProvinceIdForNation(state, targetNationId);
      const province = provinceId ? state.provinces[provinceId] : undefined;
      const appliedProvince = province
        ? applyNumericDeltas(province, action.params.province_deltas ?? {}, PROVINCE_DELTA_RULES, limitDeltas)
        : null;

      if (appliedProvince?.updated && provinceId) {
        state.provinces[provinceId] = appliedProvince.updated;
      }

      const appliedRelations: Array<Record<string, unknown>> = [];
      for (const delta of action.params.relation_deltas ?? []) {
        const from = delta.from_nation_id ?? playerNationId;
        const to = delta.target_nation_id;
        if (!state.nations[from] || !state.nations[to]) continue;
        const rel = getRelation(state.relations, from, to);
        const before = rel.value;
        const cappedDelta = limitDeltas
          ? clamp(delta.delta, -FREEFORM_RELATION_DELTA_LIMIT, FREEFORM_RELATION_DELTA_LIMIT)
          : delta.delta;
        rel.value = clamp(rel.value + cappedDelta, -100, 100);
        if (typeof delta.set_at_war === "boolean") rel.at_war = delta.set_at_war;
        if (delta.add_treaties?.length) {
          const merged = new Set([...rel.treaties, ...delta.add_treaties]);
          rel.treaties = Array.from(merged.values());
        }
        if (delta.remove_treaties?.length) {
          const remove = new Set(delta.remove_treaties);
          rel.treaties = rel.treaties.filter((t) => !remove.has(t));
        }
        appliedRelations.push({
          from_nation_id: from,
          target_nation_id: to,
          from: before,
          to: rel.value,
          delta: cappedDelta,
          set_at_war: typeof delta.set_at_war === "boolean" ? delta.set_at_war : undefined,
          add_treaties: delta.add_treaties ?? [],
          remove_treaties: delta.remove_treaties ?? []
        });
      }

      const hasNationChanges = Boolean(appliedNation && Object.keys(appliedNation.applied).length > 0);
      const hasProvinceChanges = Boolean(appliedProvince && Object.keys(appliedProvince.applied).length > 0);
      const hasRelationChanges = appliedRelations.length > 0;

      if (!hasNationChanges && !hasProvinceChanges && !hasRelationChanges) {
        effects.push({
          effect_type: "action.noop",
          delta: { type: action.type },
          audit: { note: "No freeform deltas applied." }
        });
        return { next_state: state, effects };
      }

      effects.push({
        effect_type: "action.freeform_effect",
        delta: {
          summary: action.params.summary,
          target_nation_id: targetNationId,
          nation_changes: appliedNation?.applied ?? {},
          province_id: provinceId ?? null,
          province_changes: appliedProvince?.applied ?? {},
          relation_changes: appliedRelations
        },
        audit: { note: action.params.note ?? null }
      });

      return { next_state: state, effects };
    }

    default: {
      const actionType = (action as { type: string }).type;
      effects.push({
        effect_type: "action.noop",
        delta: { type: actionType },
        audit: { note: "No engine effect implemented yet for this action type." }
      });
      return { next_state: state, effects };
    }
  }
}

function inferPlayerNationId(state: WorldState): string {
  const ids = Object.keys(state.nations).sort();
  if (ids.length === 0) throw new Error("No nations in state");
  return ids[0];
}

function resolveProvinceId(state: WorldState, nationId: string, provided?: string): string | undefined {
  if (provided && state.provinces[provided]) return provided;
  const owned = Object.values(state.provinces).find((p) => p.nation_id === nationId);
  return owned?.geo_region_id;
}

function inferProvinceIdForNation(state: WorldState, nationId: string): string | undefined {
  const owned = Object.values(state.provinces).find((p) => p.nation_id === nationId);
  return owned?.geo_region_id;
}

function stableActionKey(action: Action): string {
  return `${action.type}:${JSON.stringify(action.params)}`;
}

function hashSeed(turnSeed: number, turnIndex: number, s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h ^ turnSeed ^ turnIndex) >>> 0;
}

function cryptoRandomId(rng: () => number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "op_";
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

type ClampRule = { lo?: number; hi?: number; min?: number; max_delta?: number; max_delta_ratio?: number };

const NATION_DELTA_RULES: Record<string, ClampRule> = {
  gdp: { min: 1, max_delta_ratio: 0.1 },
  tax_rate: { lo: 0, hi: 0.9, max_delta: 0.05 },
  tax_capacity: { lo: 0, hi: 1, max_delta: 0.05 },
  compliance: { lo: 0, hi: 1, max_delta: 0.05 },
  treasury: { max_delta_ratio: 0.2, max_delta: 5000 },
  debt: { min: 0, max_delta_ratio: 0.2, max_delta: 5000 },
  stability: { lo: 0, hi: 100, max_delta: 5 },
  legitimacy: { lo: 0, hi: 100, max_delta: 5 },
  population: { min: 1, max_delta_ratio: 0.05 },
  literacy: { lo: 0, hi: 1, max_delta: 0.05 },
  admin_capacity: { lo: 0, hi: 100, max_delta: 5 },
  corruption: { lo: 0, hi: 1, max_delta: 0.05 },
  manpower_pool: { min: 0, max_delta_ratio: 0.2, max_delta: 5000 },
  force_size: { min: 0, max_delta_ratio: 0.2, max_delta: 2000 },
  readiness: { lo: 0, hi: 1, max_delta: 0.05 },
  supply: { lo: 0, hi: 1, max_delta: 0.05 },
  war_exhaustion: { lo: 0, hi: 100, max_delta: 5 },
  tech_level_mil: { lo: 0, hi: 100, max_delta: 5 }
};

const PROVINCE_DELTA_RULES: Record<string, ClampRule> = {
  population: { min: 1, max_delta_ratio: 0.1, max_delta: 5000 },
  productivity: { lo: 0, hi: 10, max_delta: 1 },
  infrastructure: { lo: 0, hi: 10, max_delta: 1 },
  unrest: { lo: 0, hi: 100, max_delta: 10 },
  compliance_local: { lo: 0, hi: 1, max_delta: 0.05 },
  garrison: { lo: 0, hi: 1000000, max_delta_ratio: 0.25, max_delta: 500 }
};

const FREEFORM_RELATION_DELTA_LIMIT = 10;

const TREATY_RELATION_DELTA: Record<string, number> = {
  trade: 4,
  non_aggression: 6,
  alliance: 8,
  research: 3,
  access: 2
};

function mergeTreaty(base: string[], treatyType: string, concessions: string[]): string[] {
  const merged = new Set(base);
  merged.add(treatyType);
  for (const c of concessions ?? []) merged.add(c);
  return Array.from(merged.values());
}

function buildBudgetedOperation(
  rng: () => number,
  input: {
    type: string;
    nation_id: string;
    target_nation_id?: string;
    remaining_weeks: number;
    budget_total: number;
    meta: Record<string, unknown>;
  }
): Operation {
  const weekly = Math.ceil(input.budget_total / Math.max(1, input.remaining_weeks));
  return {
    operation_id: cryptoRandomId(rng),
    type: input.type,
    nation_id: input.nation_id,
    target_nation_id: input.target_nation_id,
    remaining_weeks: input.remaining_weeks,
    budget_total: input.budget_total,
    remaining_budget: input.budget_total,
    budget_weekly: weekly,
    meta: input.meta
  };
}

function applyNumericDeltas<T extends Record<string, any>>(
  base: T,
  deltas: Record<string, unknown>,
  rules: Record<string, ClampRule>,
  limitDeltas = false
): { updated: T; applied: Record<string, { from: number; to: number; delta: number }> } {
  const updated = { ...base };
  const applied: Record<string, { from: number; to: number; delta: number }> = {};

  for (const [key, delta] of Object.entries(deltas)) {
    if (typeof delta !== "number") continue;
    if (!(key in rules)) continue;
    const from = (updated as Record<string, any>)[key];
    if (typeof from !== "number") continue;
    const rule = rules[key] ?? {};
    let effectiveDelta = delta;
    if (limitDeltas && (rule.max_delta !== undefined || rule.max_delta_ratio !== undefined)) {
      const ratioCap = rule.max_delta_ratio !== undefined ? Math.abs(from) * rule.max_delta_ratio : 0;
      const absoluteCap = rule.max_delta ?? 0;
      const maxAbs = Math.max(ratioCap, absoluteCap);
      if (maxAbs > 0) {
        effectiveDelta = clamp(effectiveDelta, -maxAbs, maxAbs);
      }
    }

    let to = from + effectiveDelta;
    if (rule.min !== undefined) to = Math.max(rule.min, to);
    if (rule.lo !== undefined || rule.hi !== undefined) {
      to = clamp(to, rule.lo ?? -Infinity, rule.hi ?? Infinity);
    }
    (updated as Record<string, any>)[key] = to;
    applied[key] = { from, to, delta: effectiveDelta };
  }

  return { updated, applied };
}
