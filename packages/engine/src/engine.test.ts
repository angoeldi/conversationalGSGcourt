import { describe, it, expect } from "vitest";
import { applyActionBundle } from "./apply";
import { tickWeek } from "./tick";
import type { WorldState } from "./state";

function mkState(): WorldState {
  return {
    turn_index: 0,
    turn_seed: 123,
    player_nation_id: "11111111-1111-1111-1111-111111111111",
    nations: {
      "11111111-1111-1111-1111-111111111111": {
        nation_id: "11111111-1111-1111-1111-111111111111",
        gdp: 5200000,
        tax_rate: 0.35,
        tax_capacity: 0.65,
        compliance: 0.8,
        treasury: 100000,
        debt: 200000,
        stability: 70,
        legitimacy: 75,
        population: 5000000,
        literacy: 0.3,
        admin_capacity: 40,
        corruption: 0.2,
        manpower_pool: 50000,
        force_size: 20000,
        readiness: 0.4,
        supply: 0.7,
        war_exhaustion: 5,
        tech_level_mil: 30,
        laws: [],
        institutions: {},
        culture_mix: {},
        religion_mix: {},
      },
      "22222222-2222-2222-2222-222222222222": {
        nation_id: "22222222-2222-2222-2222-222222222222",
        gdp: 4000000,
        tax_rate: 0.3,
        tax_capacity: 0.6,
        compliance: 0.7,
        treasury: 80000,
        debt: 100000,
        stability: 55,
        legitimacy: 50,
        population: 3000000,
        literacy: 0.25,
        admin_capacity: 30,
        corruption: 0.3,
        manpower_pool: 30000,
        force_size: 12000,
        readiness: 0.35,
        supply: 0.6,
        war_exhaustion: 8,
        tech_level_mil: 25,
        laws: [],
        institutions: {},
        culture_mix: {},
        religion_mix: {},
      },
    },
    provinces: {
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": {
        geo_region_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        nation_id: "11111111-1111-1111-1111-111111111111",
        population: 100000,
        productivity: 1.0,
        infrastructure: 1.0,
        unrest: 5,
        compliance_local: 0.8,
        garrison: 200,
        resources: [],
        culture_mix: {},
        religion_mix: {},
      },
    },
    relations: [],
    operations: [],
    nation_trajectories: {
      "22222222-2222-2222-2222-222222222222": {
        gdp_growth_decade: 0.1,
        population_growth_decade: 0.08,
        stability_drift_decade: 0.5,
        literacy_growth_decade: 0.04,
      },
    },
    trajectory_modifiers: [],
  };
}

describe("engine", () => {
  it("applies structured actions deterministically", () => {
    const state = mkState();
    const ctx = { turn_index: 0, turn_seed: 123, now: "1492-08-01" };

    const a = {
      type: "send_spy" as const,
      params: {
        target_nation_id: "22222222-2222-2222-2222-222222222222",
        objective: "naval_intel" as const,
        budget: 1200,
        duration_weeks: 4,
        risk_tolerance: "medium" as const,
      },
    };

    const { next_state, effects } = applyActionBundle(state, [a], ctx);
    expect(next_state.operations.length).toBe(1);
    expect(effects.some((e) => e.effect_type === "operation.created")).toBe(true);
  });

  it("adds trajectory modifiers via action", () => {
    const state = mkState();
    const ctx = { turn_index: 0, turn_seed: 123, now: "1492-08-01" };
    const action = {
      type: "apply_trajectory_modifier" as const,
      params: {
        target_nation_id: "22222222-2222-2222-2222-222222222222",
        metric: "gdp_growth_decade" as const,
        delta: 0.15,
        duration_weeks: 6,
        note: "trade windfall",
      },
    };
    const { next_state, effects } = applyActionBundle(state, [action], ctx);
    expect(next_state.trajectory_modifiers.length).toBe(1);
    expect(effects.some((e) => e.effect_type === "trajectory.modifier_added")).toBe(true);
  });

  it("rejects trajectory modifiers targeting the player nation", () => {
    const state = mkState();
    const ctx = { turn_index: 0, turn_seed: 123, now: "1492-08-01" };
    const action = {
      type: "apply_trajectory_modifier" as const,
      params: {
        target_nation_id: "11111111-1111-1111-1111-111111111111",
        metric: "gdp_growth_decade" as const,
        delta: 0.2,
        duration_weeks: 4,
      },
    };
    const { next_state, effects } = applyActionBundle(state, [action], ctx);
    expect(next_state.trajectory_modifiers.length).toBe(0);
    expect(effects.some((e) => e.effect_type === "action.rejected")).toBe(true);
  });

  it("applies freeform effects with clamping", () => {
    const state = mkState();
    const ctx = { turn_index: 0, turn_seed: 123, now: "1492-08-01" };
    const action = {
      type: "freeform_effect" as const,
      params: {
        summary: "Seize contraband and reinforce garrisons",
        target_nation_id: "11111111-1111-1111-1111-111111111111",
        nation_deltas: {
          treasury: 5000,
          tax_rate: 0.6
        },
        province_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        province_deltas: {
          unrest: -10,
          infrastructure: 12
        },
        relation_deltas: [
          {
            target_nation_id: "22222222-2222-2222-2222-222222222222",
            delta: -15,
            add_treaties: [],
            remove_treaties: []
          }
        ]
      }
    };
    const { next_state, effects } = applyActionBundle(state, [action], ctx);
    const player = next_state.nations["11111111-1111-1111-1111-111111111111"];
    expect(player.treasury).toBe(105000);
    expect(player.tax_rate).toBe(0.9);
    const province = next_state.provinces["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"];
    expect(province.unrest).toBe(0);
    expect(province.infrastructure).toBe(10);
    expect(next_state.relations[0]?.value).toBe(-15);
    expect(effects.some((e) => e.effect_type === "action.freeform_effect")).toBe(true);
  });

  it("limits freeform deltas when enabled", () => {
    const state = mkState();
    const ctx = { turn_index: 0, turn_seed: 123, now: "1492-08-01" };
    const action = {
      type: "freeform_effect" as const,
      params: {
        summary: "Aggressive crackdown",
        limit_deltas: true,
        nation_deltas: {
          tax_rate: 0.6,
          treasury: 50000
        },
        province_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        province_deltas: {
          infrastructure: 5,
          unrest: -40
        },
        relation_deltas: [
          {
            target_nation_id: "22222222-2222-2222-2222-222222222222",
            delta: -50,
            add_treaties: [],
            remove_treaties: []
          }
        ]
      }
    };
    const { next_state } = applyActionBundle(state, [action], ctx);
    const player = next_state.nations["11111111-1111-1111-1111-111111111111"];
    expect(player.tax_rate).toBeCloseTo(0.4);
    expect(player.treasury).toBe(120000);
    const province = next_state.provinces["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"];
    expect(province.infrastructure).toBe(2);
    expect(province.unrest).toBe(0);
    expect(next_state.relations[0]?.value).toBe(-10);
  });

  it("ticks a week without NaNs and increments turn", () => {
    const state = mkState();
    const ctx = { turn_index: 0, turn_seed: 123, now: "1492-08-01" };
    const { next_state, effects } = tickWeek(state, ctx);
    expect(next_state.turn_index).toBe(1);
    expect(effects.length).toBeGreaterThan(0);
    const n = next_state.nations["11111111-1111-1111-1111-111111111111"];
    expect(Number.isFinite(n.gdp)).toBe(true);
    expect(Number.isFinite(n.treasury)).toBe(true);
  });

  it("applies trajectory drift and expires modifiers", () => {
    const state = mkState();
    state.trajectory_modifiers.push({
      modifier_id: "mod-1",
      nation_id: "22222222-2222-2222-2222-222222222222",
      metric: "gdp_growth_decade",
      delta: 0.2,
      remaining_weeks: 1,
      source: "test",
      note: "boost",
    });
    const ctx = { turn_index: 0, turn_seed: 123, now: "1492-08-01" };
    const { next_state, effects } = tickWeek(state, ctx);
    expect(effects.some((e) => e.effect_type === "nation.trajectory_drift")).toBe(true);
    expect(next_state.trajectory_modifiers.length).toBe(0);
  });
});
