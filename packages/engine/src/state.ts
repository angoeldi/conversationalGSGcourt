import type { Action } from "@thecourt/shared";

export type NationId = string;
export type ProvinceGeoId = string;

export type NationState = {
  nation_id: NationId;
  gdp: number;
  tax_rate: number;
  tax_capacity: number;
  compliance: number;
  treasury: number;
  debt: number;
  stability: number;
  legitimacy: number;
  population: number;
  literacy: number;
  admin_capacity: number;
  corruption: number;
  manpower_pool: number;
  force_size: number;
  readiness: number;
  supply: number;
  war_exhaustion: number;
  tech_level_mil: number;
  laws: string[];
  institutions: Record<string, number>;
  culture_mix: Record<string, number>;
  religion_mix: Record<string, number>;
};

export type ProvinceState = {
  geo_region_id: ProvinceGeoId;
  geo_region_key?: string;
  nation_id: NationId;
  population: number;
  productivity: number;
  infrastructure: number;
  unrest: number;
  compliance_local: number;
  garrison: number;
  resources: string[];
  culture_mix: Record<string, number>;
  religion_mix: Record<string, number>;
};

export type RelationEdge = {
  from_nation_id: NationId;
  to_nation_id: NationId;
  value: number; // [-100,100]
  treaties: string[];
  at_war: boolean;
};

export type NationTrajectory = {
  gdp_growth_decade?: number;
  population_growth_decade?: number;
  stability_drift_decade?: number;
  literacy_growth_decade?: number;
};

export type TrajectoryModifier = {
  modifier_id: string;
  nation_id: NationId;
  metric: keyof NationTrajectory;
  delta: number;
  remaining_weeks: number;
  source?: string;
  note?: string;
};

export type Operation = {
  operation_id: string;
  type: string;
  nation_id: NationId;
  target_nation_id?: NationId;
  remaining_weeks: number;
  budget_weekly?: number;
  budget_total?: number;
  remaining_budget?: number;
  meta: Record<string, unknown>;
};

export type AppointmentState = {
  office_id: string;
  character_id: string;
  start_turn: number;
};

export type DebtInstrument = {
  instrument_id: string;
  nation_id: NationId;
  principal: number;
  interest_rate_annual: number;
  remaining_weeks: number;
  issued_turn: number;
};

export type WorldState = {
  turn_index: number;
  turn_seed: number;
  player_nation_id: NationId;
  nations: Record<NationId, NationState>;
  provinces: Record<ProvinceGeoId, ProvinceState>;
  relations: RelationEdge[];
  operations: Operation[];
  nation_trajectories: Record<NationId, NationTrajectory>;
  trajectory_modifiers: TrajectoryModifier[];
  appointments?: AppointmentState[];
  debt_instruments?: DebtInstrument[];
};

export type EngineContext = {
  turn_index: number;
  turn_seed: number;
  now: string;
};

export type ActionEffect = {
  effect_type: string;
  delta: Record<string, unknown>;
  audit: Record<string, unknown>;
};

export type ApplyResult = {
  next_state: WorldState;
  effects: ActionEffect[];
  applied_actions: Action[];
};
