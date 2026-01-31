import type {
  EngineContext,
  WorldState,
  ActionEffect,
  NationState,
  Operation,
  RelationEdge,
  NationTrajectory,
  TrajectoryModifier,
  DebtInstrument
} from "./state";
import { mulberry32, rngNormalApprox } from "./rng";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function tickWeek(state: WorldState, ctx: EngineContext): { next_state: WorldState; effects: ActionEffect[] } {
  const next = structuredClone(state) as WorldState;
  const effects: ActionEffect[] = [];
  const rng = mulberry32(ctx.turn_seed ^ ctx.turn_index);
  const playerNationId = next.player_nation_id || Object.keys(next.nations).sort()[0] || "";
  next.player_nation_id = playerNationId;
  const trajectories = next.nation_trajectories ?? {};
  const trajectoryModifiers = next.trajectory_modifiers ?? [];
  const debtInstruments = next.debt_instruments ?? [];

  const opWeeklyById = new Map<string, number>();
  const opWeeklyByNation = new Map<string, number>();
  for (const op of next.operations) {
    const spend = getOperationWeeklySpend(op);
    opWeeklyById.set(op.operation_id, spend);
    opWeeklyByNation.set(op.nation_id, (opWeeklyByNation.get(op.nation_id) ?? 0) + spend);
  }

  const debtServiceByNation = new Map<string, number>();
  for (const instrument of debtInstruments) {
    if (instrument.remaining_weeks <= 0) continue;
    const weekly = (instrument.principal * instrument.interest_rate_annual) / 52;
    debtServiceByNation.set(instrument.nation_id, (debtServiceByNation.get(instrument.nation_id) ?? 0) + weekly);
  }

  // 1) Economy + treasury
  for (const nation_id of Object.keys(next.nations).sort()) {
    const n = next.nations[nation_id];
    const revenue = Math.round((n.gdp / 52) * n.tax_rate * n.tax_capacity * n.compliance);
    const adminCost = Math.round(200 + 5 * n.admin_capacity);
    const milCost = Math.round(150 + 0.02 * n.force_size * 1000);
    const debtService = Math.round(debtServiceByNation.get(nation_id) ?? ((n.debt * 0.05) / 52));

    const opWeekly = Math.round(opWeeklyByNation.get(nation_id) ?? 0);

    const spending = adminCost + milCost + debtService + opWeekly;
    const balance = revenue - spending;

    // GDP drift (tempered by development; shocks come from actions/events)
    const development = clamp(n.literacy ?? 0, 0, 1);
    const baseGrowthAnnual = 0.004 + 0.012 * development;
    const unrestPenalty = 0.0002 * (100 - n.stability);
    const shock = rngNormalApprox(rng, 0, 0.002);
    const weeklyGrowth = (baseGrowthAnnual - unrestPenalty) / 52 + shock;

    let gdpNext = Math.max(1, n.gdp * (1 + weeklyGrowth));
    const popGrowthAnnual = 0.006 + 0.006 * (1 - development);
    const stabilityFactor = clamp(n.stability / 100, 0.4, 1);
    const weeklyPopGrowth = (popGrowthAnnual * stabilityFactor) / 52;
    let populationNext = Math.max(1, n.population * (1 + weeklyPopGrowth));
    const literacyAnnual = 0.001 + 0.003 * development;
    let literacyNext = clamp(n.literacy + literacyAnnual / 52, 0, 1);

    // Political effects of taxes/spending are simplified.
    const complianceNext = clamp(n.compliance - 0.02 * Math.max(0, n.tax_rate - 0.35), 0, 1);
    let stabilityNext = clamp(n.stability + 0.01 * Math.min(0, balance) - 0.5 * Math.max(0, n.tax_rate - 0.5), 0, 100);

    if (nation_id && nation_id !== playerNationId) {
      const baseTrajectory = trajectories[nation_id] ?? {};
      const modifierTotals = sumTrajectoryModifiers(trajectoryModifiers, nation_id);
      const hasTrajectory = hasAnyTrajectory(baseTrajectory) || hasAnyTrajectory(modifierTotals);
      if (hasTrajectory) {
        const gdpGrowthDecade = (baseTrajectory.gdp_growth_decade ?? 0) + (modifierTotals.gdp_growth_decade ?? 0);
        const populationGrowthDecade = (baseTrajectory.population_growth_decade ?? 0) + (modifierTotals.population_growth_decade ?? 0);
        const stabilityDriftDecade = (baseTrajectory.stability_drift_decade ?? 0) + (modifierTotals.stability_drift_decade ?? 0);
        const literacyGrowthDecade = (baseTrajectory.literacy_growth_decade ?? 0) + (modifierTotals.literacy_growth_decade ?? 0);

        gdpNext = Math.max(1, gdpNext * (1 + decadeRateToWeekly(gdpGrowthDecade)));
        populationNext = Math.max(1, populationNext * (1 + decadeRateToWeekly(populationGrowthDecade)));
        stabilityNext = clamp(stabilityNext + stabilityDriftDecade / 520, 0, 100);
        literacyNext = clamp(literacyNext + literacyGrowthDecade / 520, 0, 1);

        effects.push({
          effect_type: "nation.trajectory_drift",
          delta: {
            nation_id,
            gdp_growth_decade: gdpGrowthDecade,
            population_growth_decade: populationGrowthDecade,
            stability_drift_decade: stabilityDriftDecade,
            literacy_growth_decade: literacyGrowthDecade
          },
          audit: {}
        });
      }
    }

    next.nations[nation_id] = {
      ...n,
      gdp: gdpNext,
      population: populationNext,
      literacy: literacyNext,
      treasury: n.treasury + balance,
      compliance: complianceNext,
      stability: stabilityNext
    };

    effects.push({
      effect_type: "nation.weekly_finance",
      delta: { nation_id, revenue, spending, balance },
      audit: { adminCost, milCost, debtService, opWeekly, baseGrowthAnnual, unrestPenalty, shock, weeklyGrowth }
    });
  }

  // 2) Operations tick
  const remaining: Operation[] = [];
  for (const op of next.operations) {
    const weeklySpend = opWeeklyById.get(op.operation_id) ?? 0;
    let remainingBudget = op.remaining_budget;
    if (typeof remainingBudget === "number" && weeklySpend > 0) {
      remainingBudget = Math.max(0, remainingBudget - weeklySpend);
    }

    const updated = { ...op, remaining_weeks: op.remaining_weeks - 1, remaining_budget: remainingBudget };
    if (updated.remaining_weeks > 0) {
      remaining.push(updated);
      continue;
    }

    if (op.type === "spy_operation") {
      const targetNationId = op.target_nation_id;
      const counterintel = countCounterintel(next.operations, targetNationId);
      const baseChance = 0.65;
      const chance = clamp(baseChance - 0.1 * Math.min(counterintel, 2), 0.2, 0.8);
      const roll = rng();
      const success = roll < chance;
      effects.push({
        effect_type: "intrigue.spy_resolved",
        delta: { operation_id: op.operation_id, success, target_nation_id: op.target_nation_id, objective: op.meta.objective },
        audit: { risk_tolerance: op.meta.risk_tolerance, roll, chance, counterintel }
      });

      if (!success && op.target_nation_id) {
        const rel = getRelation(next.relations, op.target_nation_id, op.nation_id);
        rel.value = clamp(rel.value - 3, -100, 100);
      }
    }

    if (op.type === "counterintelligence") {
      const nation = next.nations[op.nation_id];
      if (nation) {
        const budget = typeof op.budget_total === "number" ? op.budget_total : 0;
        const chance = clamp(0.55 + Math.min(0.2, budget / 5000), 0.4, 0.85);
        const roll = rng();
        const success = roll < chance;
        const corruptionDelta = success ? -0.02 : 0.01;
        const complianceDelta = success ? 0.02 : 0;
        const stabilityDelta = success ? 1 : -0.5;

        next.nations[op.nation_id] = {
          ...nation,
          corruption: clamp(nation.corruption + corruptionDelta, 0, 1),
          compliance: clamp(nation.compliance + complianceDelta, 0, 1),
          stability: clamp(nation.stability + stabilityDelta, 0, 100)
        };

        effects.push({
          effect_type: "intrigue.counterintelligence_resolved",
          delta: { operation_id: op.operation_id, success, corruption_delta: corruptionDelta, compliance_delta: complianceDelta, stability_delta: stabilityDelta },
          audit: { roll, chance, focus: op.meta.focus ?? null }
        });
      }
    }

    if (op.type === "diplomacy_campaign") {
      const target = op.target_nation_id;
      if (target) {
        const rel = getRelation(next.relations, op.nation_id, target);
        const bump = 2;
        rel.value = clamp(rel.value + bump, -100, 100);
        effects.push({
          effect_type: "diplomacy.campaign_resolved",
          delta: { operation_id: op.operation_id, target_nation_id: target, relation_delta: bump },
          audit: {}
        });
      }
    }

    if (op.type === "fund_project") {
      const provinceId = typeof op.meta.province_id === "string" ? op.meta.province_id : undefined;
      const projectType = typeof op.meta.project_type === "string" ? op.meta.project_type : "infrastructure";
      const nation = next.nations[op.nation_id];
      const province = provinceId ? next.provinces[provinceId] : undefined;

      if (province && provinceId) {
        const infrastructureDelta = projectType === "fortifications" ? 0.8 : projectType === "shipyards" ? 0.6 : 1.0;
        const productivityDelta = projectType === "infrastructure" ? 0.4 : 0.2;
        next.provinces[provinceId] = {
          ...province,
          infrastructure: clamp(province.infrastructure + infrastructureDelta, 0, 10),
          productivity: clamp(province.productivity + productivityDelta, 0, 10)
        };
      }
      if (nation && projectType === "bureaucracy") {
        next.nations[op.nation_id] = {
          ...nation,
          admin_capacity: clamp(nation.admin_capacity + 2, 0, 100),
          corruption: clamp(nation.corruption - 0.02, 0, 1)
        };
      }
      if (nation && projectType === "schools") {
        next.nations[op.nation_id] = {
          ...nation,
          literacy: clamp(nation.literacy + 0.02, 0, 1),
          stability: clamp(nation.stability + 1, 0, 100)
        };
      }
      if (nation && projectType === "shipyards") {
        next.nations[op.nation_id] = {
          ...nation,
          readiness: clamp(nation.readiness + 0.02, 0, 1)
        };
      }

      effects.push({
        effect_type: "economy.project_completed",
        delta: { operation_id: op.operation_id, project_type: projectType, province_id: provinceId ?? null },
        audit: {}
      });
    }

    if (op.type === "fortify") {
      const provinceId = typeof op.meta.province_id === "string" ? op.meta.province_id : undefined;
      const level = typeof op.meta.level_increase === "number" ? op.meta.level_increase : 1;
      const province = provinceId ? next.provinces[provinceId] : undefined;
      if (province && provinceId) {
        next.provinces[provinceId] = {
          ...province,
          infrastructure: clamp(province.infrastructure + level * 0.6, 0, 10),
          garrison: clamp(province.garrison + level * 500, 0, 1000000)
        };
      }
      effects.push({
        effect_type: "military.fortifications_completed",
        delta: { operation_id: op.operation_id, province_id: provinceId ?? null, level_increase: level },
        audit: {}
      });
    }

    if (op.type === "reorganize_army") {
      const nation = next.nations[op.nation_id];
      const focus = typeof op.meta.focus === "string" ? op.meta.focus : "training";
      if (nation) {
        const readinessDelta = focus === "training" ? 0.05 : focus === "officer_corps" ? 0.03 : 0.02;
        const supplyDelta = focus === "logistics" ? 0.06 : 0.02;
        next.nations[op.nation_id] = {
          ...nation,
          readiness: clamp(nation.readiness + readinessDelta, 0, 1),
          supply: clamp(nation.supply + supplyDelta, 0, 1)
        };
      }
      effects.push({
        effect_type: "military.reorganization_completed",
        delta: { operation_id: op.operation_id, focus },
        audit: {}
      });
    }

    if (op.type === "sector_subsidy") {
      const nation = next.nations[op.nation_id];
      if (nation) {
        const sector = typeof op.meta.sector === "string" ? op.meta.sector : "sector";
        const boost = Math.min(nation.gdp * 0.008, (op.budget_total ?? 0) * 2);
        next.nations[op.nation_id] = {
          ...nation,
          gdp: Math.max(1, nation.gdp + boost),
          stability: clamp(nation.stability + 1, 0, 100)
        };
        effects.push({
          effect_type: "economy.subsidy_completed",
          delta: { operation_id: op.operation_id, sector, gdp_boost: Math.round(boost) },
          audit: {}
        });
      }
    }

    if (op.type === "committee") {
      const nation = next.nations[op.nation_id];
      if (nation) {
        next.nations[op.nation_id] = {
          ...nation,
          admin_capacity: clamp(nation.admin_capacity + 1, 0, 100),
          compliance: clamp(nation.compliance + 0.01, 0, 1),
          stability: clamp(nation.stability + 1, 0, 100)
        };
      }
      effects.push({
        effect_type: "governance.committee_reported",
        delta: { operation_id: op.operation_id, topic: op.meta.topic ?? null },
        audit: {}
      });
    }

    if (op.type === "fund_faction") {
      const target = typeof op.target_nation_id === "string" ? op.target_nation_id : undefined;
      const secrecy = typeof op.meta.secrecy === "string" ? op.meta.secrecy : "medium";
      const exposureChance = secrecy === "low" ? 0.25 : secrecy === "high" ? 0.08 : 0.15;
      const roll = rng();
      const exposed = roll < exposureChance;
      if (target && next.nations[target]) {
        const targetNation = next.nations[target];
        next.nations[target] = {
          ...targetNation,
          stability: clamp(targetNation.stability - 2, 0, 100),
          legitimacy: clamp(targetNation.legitimacy - 1, 0, 100)
        };
        const mod: TrajectoryModifier = {
          modifier_id: `traj_${op.operation_id}`,
          nation_id: target,
          metric: "stability_drift_decade",
          delta: -0.6,
          remaining_weeks: 12,
          source: "faction"
        };
        next.trajectory_modifiers = [...(next.trajectory_modifiers ?? []), mod];
        effects.push({
          effect_type: "trajectory.modifier_added",
          delta: { modifier: mod },
          audit: {}
        });
      }
      if (exposed && target) {
        const rel = getRelation(next.relations, op.nation_id, target);
        rel.value = clamp(rel.value - 4, -100, 100);
      }
      effects.push({
        effect_type: "intrigue.faction_resolved",
        delta: { operation_id: op.operation_id, target_nation_id: target ?? null, exposed },
        audit: { roll, chance: exposureChance, secrecy }
      });
    }

    if (op.type === "ultimatum") {
      const target = typeof op.target_nation_id === "string" ? op.target_nation_id : undefined;
      if (target && next.nations[target]) {
        const actor = next.nations[op.nation_id];
        const targetNation = next.nations[target];
        const rel = getRelation(next.relations, op.nation_id, target);
        const forceRatio = actor.force_size / Math.max(1, targetNation.force_size);
        const chance = clamp(0.45 + 0.15 * clamp(forceRatio - 1, -0.5, 0.5) + 0.1 * (rel.value / 100), 0.2, 0.8);
        const roll = rng();
        const success = roll < chance;

        if (success) {
          next.nations[op.nation_id] = {
            ...actor,
            legitimacy: clamp(actor.legitimacy + 1, 0, 100)
          };
          next.nations[target] = {
            ...targetNation,
            stability: clamp(targetNation.stability - 1, 0, 100)
          };
          rel.value = clamp(rel.value - 3, -100, 100);
        } else {
          const backdown = typeof op.meta.backdown_cost_legitimacy === "number" ? op.meta.backdown_cost_legitimacy : 2;
          next.nations[op.nation_id] = {
            ...actor,
            legitimacy: clamp(actor.legitimacy - backdown, 0, 100),
            stability: clamp(actor.stability - 1, 0, 100)
          };
          rel.value = clamp(rel.value - 6, -100, 100);
        }

        effects.push({
          effect_type: "diplomacy.ultimatum_resolved",
          delta: { operation_id: op.operation_id, target_nation_id: target, success },
          audit: { roll, chance, relation_value: rel.value }
        });
      }
    }

    if (op.type === "spending_cut") {
      const nation = next.nations[op.nation_id];
      const category = typeof op.meta.category === "string" ? op.meta.category : "administration";
      if (nation) {
        const updates: Partial<NationState> = {};
        if (category === "military") {
          updates.readiness = clamp(nation.readiness - 0.05, 0, 1);
          updates.force_size = Math.max(0, nation.force_size - 500);
        }
        if (category === "administration") {
          updates.admin_capacity = clamp(nation.admin_capacity - 2, 0, 100);
        }
        if (category === "court") {
          updates.legitimacy = clamp(nation.legitimacy - 2, 0, 100);
        }
        if (category === "infrastructure") {
          updates.stability = clamp(nation.stability - 1, 0, 100);
        }
        if (category === "subsidies") {
          updates.stability = clamp(nation.stability - 1, 0, 100);
          updates.compliance = clamp(nation.compliance - 0.02, 0, 1);
        }
        next.nations[op.nation_id] = { ...nation, ...updates };
      }
      effects.push({
        effect_type: "economy.spending_cut_resolved",
        delta: { operation_id: op.operation_id, category },
        audit: {}
      });
    }

    if (op.type === "crackdown") {
      const provinceId = typeof op.meta.province_id === "string" ? op.meta.province_id : undefined;
      const intensity = typeof op.meta.intensity === "number" ? op.meta.intensity : 1;
      const province = provinceId ? next.provinces[provinceId] : undefined;
      if (province && provinceId) {
        next.provinces[provinceId] = {
          ...province,
          unrest: clamp(province.unrest + intensity * 2, 0, 100)
        };
      }
      const nation = next.nations[op.nation_id];
      if (nation) {
        next.nations[op.nation_id] = {
          ...nation,
          stability: clamp(nation.stability - 1, 0, 100)
        };
      }
      effects.push({
        effect_type: "interior.crackdown_resolved",
        delta: { operation_id: op.operation_id, province_id: provinceId ?? null },
        audit: { intensity }
      });
    }
  }
  next.operations = remaining;

  // 3) Trajectory modifiers tick
  const updatedModifiers: TrajectoryModifier[] = [];
  for (const mod of trajectoryModifiers) {
    const remainingWeeks = mod.remaining_weeks - 1;
    if (remainingWeeks > 0) updatedModifiers.push({ ...mod, remaining_weeks: remainingWeeks });
  }
  next.trajectory_modifiers = updatedModifiers;

  // 4) Debt instruments tick
  const updatedInstruments: DebtInstrument[] = [];
  for (const instrument of debtInstruments) {
    const remainingWeeks = instrument.remaining_weeks - 1;
    if (remainingWeeks > 0) {
      updatedInstruments.push({ ...instrument, remaining_weeks: remainingWeeks });
      continue;
    }

    const nation = next.nations[instrument.nation_id];
    if (nation) {
      next.nations[instrument.nation_id] = {
        ...nation,
        debt: Math.max(0, nation.debt - instrument.principal),
        treasury: nation.treasury - instrument.principal
      };
      effects.push({
        effect_type: "nation.debt_matured",
        delta: { nation_id: instrument.nation_id, principal: instrument.principal, instrument_id: instrument.instrument_id },
        audit: {}
      });
    }
  }
  next.debt_instruments = updatedInstruments;

  // 5) Relations drift (weak)
  for (const r of next.relations) {
    r.value = clamp(Math.round(r.value * 0.995), -100, 100);
  }

  next.turn_index += 1;

  return { next_state: next, effects };
}

function hasAnyTrajectory(traj: NationTrajectory): boolean {
  return Object.values(traj).some((value) => typeof value === "number" && value !== 0);
}

function sumTrajectoryModifiers(modifiers: TrajectoryModifier[], nationId: string): NationTrajectory {
  const totals: NationTrajectory = {};
  for (const mod of modifiers) {
    if (mod.nation_id !== nationId) continue;
    const metric = mod.metric;
    totals[metric] = (totals[metric] ?? 0) + mod.delta;
  }
  return totals;
}

function decadeRateToWeekly(rate: number): number {
  const safeRate = clamp(rate, -0.95, 5);
  return Math.pow(1 + safeRate, 1 / 520) - 1;
}

function getRelation(relations: RelationEdge[], from: string, to: string): RelationEdge {
  const existing = relations.find((r) => r.from_nation_id === from && r.to_nation_id === to);
  if (existing) return existing;
  const created: RelationEdge = { from_nation_id: from, to_nation_id: to, value: 0, treaties: [], at_war: false };
  relations.push(created);
  return created;
}

function getOperationWeeklySpend(op: Operation): number {
  if (op.type === "spending_cut") {
    const weekly = typeof op.meta.weekly_amount === "number" ? op.meta.weekly_amount : 0;
    return -Math.max(0, weekly);
  }
  if (typeof op.remaining_budget === "number") {
    if (op.remaining_weeks <= 0) return 0;
    return Math.max(0, Math.ceil(op.remaining_budget / Math.max(1, op.remaining_weeks)));
  }
  if (typeof op.budget_weekly === "number") return op.budget_weekly;
  return 0;
}

function countCounterintel(ops: Operation[], targetNationId?: string): number {
  if (!targetNationId) return 0;
  return ops.filter((op) => op.type === "counterintelligence" && op.nation_id === targetNationId && op.remaining_weeks > 0).length;
}
