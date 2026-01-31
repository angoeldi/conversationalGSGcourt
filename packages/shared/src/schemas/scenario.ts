import { z } from "zod";
import { UUID, NonEmpty } from "./action";

export const GeoRegionId = UUID;
export const GeoRegionKey = NonEmpty;

export const GovernmentType = z.enum([
  "monarchy",
  "republic",
  "empire",
  "theocracy",
  "city_state",
  "tribal",
]);

export const NationSnapshot = z
  .object({
    nation_id: UUID,
    gdp: z.number().nonnegative(),
    tax_rate: z.number().min(0).max(0.9),
    tax_capacity: z.number().min(0).max(1),
    compliance: z.number().min(0).max(1),
    treasury: z.number().int(),
    debt: z.number().int().nonnegative(),
    stability: z.number().min(0).max(100),
    legitimacy: z.number().min(0).max(100),
    population: z.number().nonnegative(),
    literacy: z.number().min(0).max(1),
    admin_capacity: z.number().min(0).max(100),
    corruption: z.number().min(0).max(1),
    manpower_pool: z.number().nonnegative(),
    force_size: z.number().nonnegative(),
    readiness: z.number().min(0).max(1),
    supply: z.number().min(0).max(1),
    war_exhaustion: z.number().min(0).max(100),
    tech_level_mil: z.number().min(0).max(100),
    laws: z.array(NonEmpty).default([]),
    institutions: z.record(z.number().int().min(0).max(10)).default({}),
    culture_mix: z.record(z.number().min(0).max(1)).default({}),
    religion_mix: z.record(z.number().min(0).max(1)).default({})
  })
  .strict();

export type NationSnapshot = z.infer<typeof NationSnapshot>;

export const ProvinceSnapshot = z
  .object({
    geo_region_id: GeoRegionId, // UUID for canonical province id
    geo_region_key: GeoRegionKey.optional(), // map feature key / legacy slug
    nation_id: UUID,
    population: z.number().nonnegative(),
    productivity: z.number().min(0).max(10),
    infrastructure: z.number().min(0).max(10),
    unrest: z.number().min(0).max(100),
    compliance_local: z.number().min(0).max(1),
    garrison: z.number().min(0).max(1000000),
    resources: z.array(NonEmpty).default([]),
    culture_mix: z.record(z.number().min(0).max(1)).default({}),
    religion_mix: z.record(z.number().min(0).max(1)).default({})
  })
  .strict();

export type ProvinceSnapshot = z.infer<typeof ProvinceSnapshot>;

export const Character = z
  .object({
    character_id: UUID,
    name: NonEmpty,
    title: z.string().optional(),
    portrait_prompt: z.string().optional(),
    bio: z.string().default(""),
    traits: z.array(NonEmpty).default([]),
    skills: z
      .object({
        diplomacy: z.number().int().min(0).max(100).default(50),
        finance: z.number().int().min(0).max(100).default(50),
        war: z.number().int().min(0).max(100).default(50),
        interior: z.number().int().min(0).max(100).default(50),
        intrigue: z.number().int().min(0).max(100).default(50),
        admin: z.number().int().min(0).max(100).default(50)
      })
      .default({}),
    advisor_model: z
      .object({
        accuracy: z.number().min(0).max(1).default(0.25),
        reliability: z.number().min(0).max(1).default(0.75),
        bias: z.record(z.any()).default({}),
        scope: z.record(z.any()).default({})
      })
      .default({}),
    loyalties: z.record(z.number().min(0).max(1)).default({})
  })
  .strict();

export type Character = z.infer<typeof Character>;

export const Office = z
  .object({
    office_id: UUID,
    nation_id: UUID,
    name: NonEmpty,
    domain: z.enum(["foreign", "interior", "finance", "war", "intelligence", "chancellery"]),
    rank: z.number().int().min(1).max(10).default(5)
  })
  .strict();

export type Office = z.infer<typeof Office>;

export const Appointment = z
  .object({
    office_id: UUID,
    character_id: UUID,
    start_turn: z.number().int().min(0).default(0)
  })
  .strict();

export const Succession = z
  .object({
    nation_id: UUID,
    method: NonEmpty,
    rules: z.record(z.any()).default({}),
    current: z.array(UUID).default([])
  })
  .strict();

export const NationTrajectory = z
  .object({
    gdp_growth_decade: z.number().optional(),
    population_growth_decade: z.number().optional(),
    stability_drift_decade: z.number().optional(),
    literacy_growth_decade: z.number().optional()
  })
  .strict()
  .default({});

export const NationProfile = z
  .object({
    nation_id: UUID,
    summary: z.string().min(1),
    map_aliases: z.array(NonEmpty).default([]),
    trajectory: NationTrajectory
  })
  .strict();

export const InitialTask = z
  .object({
    task_type: z.enum([
      "diplomacy",
      "war",
      "finance",
      "interior",
      "intrigue",
      "appointment",
      "petition",
      "crisis"
    ]),
    owner_character_id: UUID.optional(),
    urgency: z.enum(["low", "medium", "high"]).default("medium"),
    prompt: z.string().min(1),
    context_overrides: z.record(z.any()).default({})
  })
  .strict();

const ScenarioNation = z
  .object({
    nation_id: UUID,
    name: NonEmpty,
    tag: z.string().min(1).max(8),
    government_type: GovernmentType,
    capital_geo_region_id: GeoRegionId
  })
  .strict();

const ScenarioRegionAssignment = z
  .object({
    geo_region_id: GeoRegionId,
    geo_region_key: GeoRegionKey.optional(),
    nation_id: UUID
  })
  .strict();

export const Scenario = z
  .object({
    scenario_id: UUID,
    name: NonEmpty,
    start_date: NonEmpty, // ISO date string
    calendar: z.enum(["gregorian", "julian", "mixed"]).default("gregorian"),
    geo_pack: z
      .object({
        id: NonEmpty,
        version: NonEmpty
      })
      .strict(),

    player_nation_id: UUID,

    nations: z.array(ScenarioNation).min(1),

    relations: z
      .array(
        z
          .object({
            from_nation_id: UUID,
            to_nation_id: UUID,
            value: z.number().int().min(-100).max(100),
            treaties: z.array(NonEmpty).default([]),
            at_war: z.boolean().default(false)
          })
          .strict()
      )
      .default([]),

    region_assignments: z.array(ScenarioRegionAssignment).min(1),

    nation_snapshots: z.array(NationSnapshot).min(1),
    province_snapshots: z.array(ProvinceSnapshot).min(1),
    nation_profiles: z.array(NationProfile).default([]),

    characters: z.array(Character).min(1),
    offices: z.array(Office).min(1),
    appointments: z.array(Appointment).min(1),
    succession: z.array(Succession).default([]),

    initial_tasks: z.array(InitialTask).default([]),

    wiki_sources: z
      .array(
        z
          .object({
            title: NonEmpty,
            url: NonEmpty,
            excerpt: z.string().default("")
          })
          .strict()
      )
      .default([]),

    uncertainty_notes: z.array(z.string()).default([])
  })
  .strict();

export type Scenario = z.infer<typeof Scenario>;

export const ScenarioDraft = Scenario.extend({
  nations: z.array(
    ScenarioNation.extend({
      capital_geo_region_id: GeoRegionKey
    })
  ).min(1),
  region_assignments: z.array(
    ScenarioRegionAssignment.extend({
      geo_region_id: GeoRegionKey
    })
  ).min(1),
  province_snapshots: z.array(
    ProvinceSnapshot.extend({
      geo_region_id: GeoRegionKey
    })
  ).min(1)
});

export type ScenarioDraft = z.infer<typeof ScenarioDraft>;
