import { z } from "zod";
import { UUID, TrajectoryMetric } from "./action";
import { NationSnapshot, ProvinceSnapshot, NationTrajectory } from "./scenario";

export const RelationEdge = z
  .object({
    from_nation_id: UUID,
    to_nation_id: UUID,
    value: z.number().int().min(-100).max(100),
    treaties: z.array(z.string()).default([]),
    at_war: z.boolean().default(false)
  })
  .strict();

export const Operation = z
  .object({
    operation_id: z.string().min(1),
    type: z.string().min(1),
    nation_id: UUID,
    target_nation_id: UUID.optional(),
    remaining_weeks: z.number().int().min(0),
    budget_weekly: z.number().optional(),
    budget_total: z.number().optional(),
    remaining_budget: z.number().optional(),
    meta: z.record(z.any()).default({})
  })
  .strict();

export const TrajectoryModifier = z
  .object({
    modifier_id: z.string().min(1),
    nation_id: UUID,
    metric: TrajectoryMetric,
    delta: z.number(),
    remaining_weeks: z.number().int().min(0),
    source: z.string().optional(),
    note: z.string().optional()
  })
  .strict();

export const AppointmentState = z
  .object({
    office_id: UUID,
    character_id: UUID,
    start_turn: z.number().int().min(0)
  })
  .strict();

export const DebtInstrument = z
  .object({
    instrument_id: z.string().min(1),
    nation_id: UUID,
    principal: z.number().min(0),
    interest_rate_annual: z.number().min(0),
    remaining_weeks: z.number().int().min(0),
    issued_turn: z.number().int().min(0)
  })
  .strict();

export const WorldState = z
  .object({
    turn_index: z.number().int().min(0),
    turn_seed: z.number().int(),
    player_nation_id: UUID,
    nations: z.record(NationSnapshot),
    provinces: z.record(ProvinceSnapshot),
    relations: z.array(RelationEdge).default([]),
    operations: z.array(Operation).default([]),
    nation_trajectories: z.record(NationTrajectory).default({}),
    trajectory_modifiers: z.array(TrajectoryModifier).default([]),
    appointments: z.array(AppointmentState).default([]),
    debt_instruments: z.array(DebtInstrument).default([])
  })
  .strict();

export type WorldState = z.infer<typeof WorldState>;
