import { z } from "zod";

/**
 * Canonical Action Catalog (v1).
 *
 * Actions are the only legal way to change ground truth.
 */

export const RiskTolerance = z.enum(["low", "medium", "high"]);
export const Tone = z.enum(["conciliatory", "neutral", "firm", "hostile"]);
export const UUID = z.string().uuid();
export const NonEmpty = z.string().min(1);

export const ActionTypes = [
  "send_spy",
  "counterintelligence",
  "send_envoy",
  "improve_relations",
  "sign_treaty",
  "issue_ultimatum",
  "sanction",
  "recognize_claim",
  "adjust_tax_rate",
  "issue_debt",
  "cut_spending",
  "fund_project",
  "subsidize_sector",
  "appoint_official",
  "reform_law",
  "crackdown",
  "mobilize",
  "raise_levies",
  "fortify",
  "deploy_force",
  "reorganize_army",
  "fund_faction",
  "leak_story",
  "freeform_effect",
  "create_committee",
  "apply_trajectory_modifier",
] as const;

export type ActionType = (typeof ActionTypes)[number];

export const Money = z.number().int().min(0);
export const Weeks = z.number().int().min(1).max(52);
export const RelationScore = z.number().int().min(-100).max(100);
export const TrajectoryMetric = z.enum([
  "gdp_growth_decade",
  "population_growth_decade",
  "stability_drift_decade",
  "literacy_growth_decade",
]);

// --- Action parameter schemas (discriminated by `type`) ---

export const SendSpyParams = z
  .object({
    target_nation_id: UUID,
    objective: z.enum(["naval_intel", "army_intel", "economic_intel", "political_intel", "sabotage", "influence"]),
    budget: Money,
    duration_weeks: Weeks,
    risk_tolerance: RiskTolerance,
  })
  .strict();

export const CounterIntelligenceParams = z
  .object({
    budget: Money,
    focus: z.enum(["ports", "court", "frontier", "finance"]).default("court"),
    duration_weeks: Weeks,
  })
  .strict();

export const SendEnvoyParams = z
  .object({
    target_nation_id: UUID,
    message_tone: Tone,
    topic: NonEmpty,
    offer: z.string().optional(),
  })
  .strict();

export const ImproveRelationsParams = z
  .object({
    target_nation_id: UUID,
    budget: Money,
    message_tone: Tone.default("neutral"),
    duration_weeks: Weeks,
  })
  .strict();

export const SignTreatyParams = z
  .object({
    target_nation_id: UUID,
    treaty_type: z.enum(["trade", "non_aggression", "alliance", "research", "access"]),
    concessions: z.array(NonEmpty).default([]),
  })
  .strict();

export const IssueUltimatumParams = z
  .object({
    target_nation_id: UUID,
    demand: NonEmpty,
    deadline_weeks: z.number().int().min(1).max(12),
    backdown_cost_legitimacy: z.number().min(0).max(25).default(5),
  })
  .strict();

export const SanctionParams = z
  .object({
    target_nation_id: UUID,
    scope: z.enum(["trade", "finance", "naval"]),
    severity: z.number().int().min(1).max(5),
    duration_weeks: Weeks,
  })
  .strict();

export const RecognizeClaimParams = z
  .object({
    target_nation_id: UUID,
    claim: NonEmpty,
    public: z.boolean().default(true),
  })
  .strict();

export const AdjustTaxRateParams = z
  .object({
    new_tax_rate: z.number().min(0).max(0.9),
    rationale: z.string().optional(),
  })
  .strict();

export const IssueDebtParams = z
  .object({
    amount: Money,
    interest_rate_annual: z.number().min(0).max(1),
    maturity_weeks: z.number().int().min(4).max(520),
  })
  .strict();

export const CutSpendingParams = z
  .object({
    category: z.enum(["military", "administration", "court", "infrastructure", "subsidies"]),
    weekly_amount: Money,
    duration_weeks: Weeks,
  })
  .strict();

export const FundProjectParams = z
  .object({
    project_type: z.enum(["infrastructure", "fortifications", "bureaucracy", "schools", "shipyards"]),
    province_id: UUID.optional(),
    budget: Money,
    duration_weeks: Weeks,
  })
  .strict();

export const SubsidizeSectorParams = z
  .object({
    sector: z.enum(["grain", "textiles", "arms", "shipping", "mining"]),
    weekly_amount: Money,
    duration_weeks: Weeks,
  })
  .strict();

export const AppointOfficialParams = z
  .object({
    office_id: UUID,
    character_id: UUID,
  })
  .strict();

export const ReformLawParams = z
  .object({
    law_key: NonEmpty,
    change: z.enum(["enact", "repeal", "amend"]),
    political_capital_cost: z.number().int().min(0).max(100).default(10),
  })
  .strict();

export const CrackdownParams = z
  .object({
    province_id: UUID.optional(),
    intensity: z.number().int().min(1).max(5),
    duration_weeks: Weeks,
    budget: Money,
  })
  .strict();

export const MobilizeParams = z
  .object({
    scope: z.enum(["partial", "general"]),
    target_readiness: z.number().min(0).max(1).default(0.75),
  })
  .strict();

export const RaiseLeviesParams = z
  .object({
    province_id: UUID.optional(),
    manpower: z.number().int().min(0),
  })
  .strict();

export const FortifyParams = z
  .object({
    province_id: UUID,
    level_increase: z.number().int().min(1).max(3),
    budget: Money,
    duration_weeks: Weeks,
  })
  .strict();

export const DeployForceParams = z
  .object({
    from_province_id: UUID,
    to_province_id: UUID,
    units: z.number().int().min(1),
  })
  .strict();

export const ReorganizeArmyParams = z
  .object({
    focus: z.enum(["training", "logistics", "officer_corps", "standardization"]),
    budget: Money,
    duration_weeks: Weeks,
  })
  .strict();

export const FundFactionParams = z
  .object({
    target_nation_id: UUID,
    faction: NonEmpty,
    weekly_amount: Money,
    duration_weeks: Weeks,
    secrecy: z.enum(["low", "medium", "high"]).default("high"),
  })
  .strict();

export const LeakStoryParams = z
  .object({
    target: NonEmpty,
    narrative: NonEmpty,
    plausibility: z.number().min(0).max(1).default(0.6),
  })
  .strict();

export const FreeformNationDeltas = z
  .object({
    gdp: z.number(),
    tax_rate: z.number(),
    tax_capacity: z.number(),
    compliance: z.number(),
    treasury: z.number(),
    debt: z.number(),
    stability: z.number(),
    legitimacy: z.number(),
    population: z.number(),
    literacy: z.number(),
    admin_capacity: z.number(),
    corruption: z.number(),
    manpower_pool: z.number(),
    force_size: z.number(),
    readiness: z.number(),
    supply: z.number(),
    war_exhaustion: z.number(),
    tech_level_mil: z.number(),
  })
  .partial()
  .strict();

export const FreeformProvinceDeltas = z
  .object({
    population: z.number(),
    productivity: z.number(),
    infrastructure: z.number(),
    unrest: z.number(),
    compliance_local: z.number(),
    garrison: z.number(),
  })
  .partial()
  .strict();

export const FreeformRelationDelta = z
  .object({
    from_nation_id: UUID.optional(),
    target_nation_id: UUID,
    delta: z.number().min(-100).max(100),
    set_at_war: z.boolean().optional(),
    add_treaties: z.array(NonEmpty).default([]),
    remove_treaties: z.array(NonEmpty).default([]),
  })
  .strict();

export const FreeformEffectParams = z
  .object({
    summary: NonEmpty,
    target_nation_id: UUID.optional(),
    nation_deltas: FreeformNationDeltas.default({}),
    province_id: UUID.optional(),
    province_deltas: FreeformProvinceDeltas.default({}),
    relation_deltas: z.array(FreeformRelationDelta).default([]),
    limit_deltas: z.boolean().optional(),
    note: z.string().optional(),
  })
  .strict();

export const CreateCommitteeParams = z
  .object({
    topic: NonEmpty,
    chair_character_id: UUID.optional(),
    duration_weeks: Weeks,
    budget: Money,
  })
  .strict();

export const ApplyTrajectoryModifierParams = z
  .object({
    target_nation_id: UUID,
    metric: TrajectoryMetric,
    delta: z.number(),
    duration_weeks: Weeks,
    note: z.string().optional(),
  })
  .strict();

export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("send_spy"), params: SendSpyParams }).strict(),
  z.object({ type: z.literal("counterintelligence"), params: CounterIntelligenceParams }).strict(),
  z.object({ type: z.literal("send_envoy"), params: SendEnvoyParams }).strict(),
  z.object({ type: z.literal("improve_relations"), params: ImproveRelationsParams }).strict(),
  z.object({ type: z.literal("sign_treaty"), params: SignTreatyParams }).strict(),
  z.object({ type: z.literal("issue_ultimatum"), params: IssueUltimatumParams }).strict(),
  z.object({ type: z.literal("sanction"), params: SanctionParams }).strict(),
  z.object({ type: z.literal("recognize_claim"), params: RecognizeClaimParams }).strict(),
  z.object({ type: z.literal("adjust_tax_rate"), params: AdjustTaxRateParams }).strict(),
  z.object({ type: z.literal("issue_debt"), params: IssueDebtParams }).strict(),
  z.object({ type: z.literal("cut_spending"), params: CutSpendingParams }).strict(),
  z.object({ type: z.literal("fund_project"), params: FundProjectParams }).strict(),
  z.object({ type: z.literal("subsidize_sector"), params: SubsidizeSectorParams }).strict(),
  z.object({ type: z.literal("appoint_official"), params: AppointOfficialParams }).strict(),
  z.object({ type: z.literal("reform_law"), params: ReformLawParams }).strict(),
  z.object({ type: z.literal("crackdown"), params: CrackdownParams }).strict(),
  z.object({ type: z.literal("mobilize"), params: MobilizeParams }).strict(),
  z.object({ type: z.literal("raise_levies"), params: RaiseLeviesParams }).strict(),
  z.object({ type: z.literal("fortify"), params: FortifyParams }).strict(),
  z.object({ type: z.literal("deploy_force"), params: DeployForceParams }).strict(),
  z.object({ type: z.literal("reorganize_army"), params: ReorganizeArmyParams }).strict(),
  z.object({ type: z.literal("fund_faction"), params: FundFactionParams }).strict(),
  z.object({ type: z.literal("leak_story"), params: LeakStoryParams }).strict(),
  z.object({ type: z.literal("freeform_effect"), params: FreeformEffectParams }).strict(),
  z.object({ type: z.literal("create_committee"), params: CreateCommitteeParams }).strict(),
  z.object({ type: z.literal("apply_trajectory_modifier"), params: ApplyTrajectoryModifierParams }).strict(),
]);

export type Action = z.infer<typeof Action>;

export const ActionBundle = z
  .object({
    label: NonEmpty,
    actions: z.array(Action).min(1),
    tradeoffs: z.array(z.string()).default([]),
  })
  .strict();

export type ActionBundle = z.infer<typeof ActionBundle>;
