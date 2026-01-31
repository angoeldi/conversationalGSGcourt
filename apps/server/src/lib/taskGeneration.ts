import { mulberry32 } from "@thecourt/engine";
import type { WorldState } from "@thecourt/engine";
import type { ActionType, Scenario, TaskContext } from "@thecourt/shared";
import { buildTaskContext } from "./game";
import { buildTurnTaskId } from "./ids";
import { retrieveWikipediaContext, type WikiPageSummary } from "../wiki/wikipedia";

type TaskTemplate = {
  task_type: Scenario["initial_tasks"][number]["task_type"];
  domain?: "foreign" | "interior" | "finance" | "war" | "intelligence" | "chancellery";
  suggested_action_types: ActionType[];
  tags: string[];
  prompt: (ctx: TemplateContext, rng: () => number) => string;
  owner_character_id?: string | null;
  urgency?: "low" | "medium" | "high";
};

type TemplateContext = {
  playerName: string;
  rivalName: string | null;
  year: string;
  topic: string;
  wiki?: WikiPageSummary;
  realm: {
    treasury: number;
    stability: number;
    gdp: number;
    legitimacy: number;
    warExhaustion: number;
  };
  story?: StorySeed;
  tokens?: Record<string, string>;
};

type AppointmentLike = NonNullable<WorldState["appointments"]>[number];

const wikiCache = new Map<string, WikiPageSummary[]>();
const WIKI_CACHE_LIMIT = 32;

function pruneWikiCache(): void {
  if (wikiCache.size <= WIKI_CACHE_LIMIT) return;
  const overflow = wikiCache.size - WIKI_CACHE_LIMIT;
  const keys = wikiCache.keys();
  for (let i = 0; i < overflow; i += 1) {
    const next = keys.next();
    if (next.done) break;
    wikiCache.delete(next.value);
  }
}

export type GeneratedTask = {
  task_id: string;
  task_type: Scenario["initial_tasks"][number]["task_type"];
  owner_character_id: string | null;
  urgency: "low" | "medium" | "high";
  context: TaskContext;
  created_turn: number;
};

export type StorySeed = {
  story_id: string;
  title: string;
  summary: string;
  history: string[];
  last_turn: number;
  task_type: Scenario["initial_tasks"][number]["task_type"];
  domain?: TaskTemplate["domain"];
  transcripts?: Array<{
    task_id: string;
    turn_index: number;
    messages: Array<{ role: "player" | "courtier" | "system"; sender_character_id?: string; content: string }>;
  }>;
};

export type TaskGenerationOptions = {
  minPetitions?: number;
  requireQuirk?: boolean;
  continuationShare?: number;
  minContinuations?: number;
};

const DEFAULT_GENERATION_OPTIONS: Required<TaskGenerationOptions> = {
  minPetitions: 0,
  requireQuirk: false,
  continuationShare: 0,
  minContinuations: 0
};

type TemplateVariant = {
  prompt: string;
  suggested_action_types: ActionType[];
  urgency?: "low" | "medium" | "high";
  owner_character_id?: string | null;
  tags?: string[];
};

type TemplateSpec = {
  task_type: Scenario["initial_tasks"][number]["task_type"];
  domain?: TaskTemplate["domain"];
  variants: TemplateVariant[];
};

const FLAVOR_LIBRARY = {
  petitioner: [
    "a widowed innkeeper",
    "a veteran captain",
    "a coastal magistrate",
    "a river merchant",
    "a parish priest",
    "a mill owner",
    "a weaver with a small crew",
    "a grain factor",
    "a town reeve",
    "a border scout",
    "a bailiff from the marches",
    "a guild elder",
    "a minor noble house",
    "a courtier with a family petition",
    "a shipwright",
    "a master mason",
    "a market warden"
  ],
  petitioners: [
    "a delegation of millers",
    "the town elders",
    "a circle of parish priests",
    "a band of discharged soldiers",
    "the coastal merchants",
    "the valley farmers",
    "the river guilds",
    "a coalition of villages",
    "the city ward captains",
    "the guild apprentices",
    "the harbor pilots",
    "the brewers' guild"
  ],
  locality: [
    "the lower river",
    "the western marches",
    "the capital wards",
    "the salt coast",
    "the northern shires",
    "the hill country",
    "the marsh villages",
    "the frontier market",
    "the high road",
    "the eastern downs",
    "the royal forest edge"
  ],
  hardship: [
    "late frosts",
    "flooded granaries",
    "bandit tolls",
    "a spoiled harvest",
    "a market fire",
    "raids along the road",
    "a fever outbreak",
    "a collapsed bridge",
    "a shortage of coin",
    "a failed caravan",
    "a dispute over tolls"
  ],
  relief: [
    "a remission of arrears",
    "grain relief",
    "repair funds",
    "temporary tax relief",
    "a new fair charter",
    "a levy holiday",
    "a maintenance grant",
    "a price ceiling",
    "a patrol stipend",
    "a one-season subsidy"
  ],
  request: [
    "a new charter",
    "a formal hearing",
    "permission to rebuild",
    "authority to levy a maintenance fee",
    "a bridge repair writ",
    "a market license",
    "a dispute arbitration",
    "a warding decree"
  ],
  guild: [
    "the tanners' guild",
    "the weavers' guild",
    "the shipwrights' guild",
    "the smiths' guild",
    "the coopers' guild",
    "the chandlers' guild",
    "the carpenters' guild",
    "the masons' guild"
  ],
  resource: [
    "timber",
    "salt",
    "wool",
    "iron",
    "grain",
    "wine",
    "copper",
    "ship tar",
    "linen"
  ],
  relative: ["nephew", "cousin", "brother", "squire", "son-in-law"],
  offense: [
    "poaching in the royal forest",
    "smuggling",
    "a tavern brawl",
    "desertion",
    "illegal dueling",
    "seditious pamphleteering"
  ],
  festival: [
    "a tourney",
    "a harvest fair",
    "a saints' day procession",
    "a midsummer market",
    "a river regatta",
    "a winter masque"
  ],
  horse: [
    "a grey charger",
    "a black stallion",
    "a dappled courser",
    "a war-trained destrier",
    "a swift palfrey"
  ],
  suitor: [
    "Lady Beatrice",
    "Lord Edmund",
    "Sir Alaric",
    "Lady Isolde",
    "Lord Thomas",
    "Lady Margery"
  ],
  dowry: [
    "a modest dowry",
    "a tax exemption for the estate",
    "a license to import fine cloth",
    "a small pension",
    "a court office"
  ]
} as const;

function pickFrom<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) return items[0] as T;
  const idx = Math.floor(rng() * items.length);
  return items[Math.min(items.length - 1, Math.max(0, idx))];
}

function buildFlavorTokens(rng: () => number): Record<string, string> {
  return {
    petitioner: pickFrom(rng, FLAVOR_LIBRARY.petitioner),
    petitioners: pickFrom(rng, FLAVOR_LIBRARY.petitioners),
    locality: pickFrom(rng, FLAVOR_LIBRARY.locality),
    hardship: pickFrom(rng, FLAVOR_LIBRARY.hardship),
    relief: pickFrom(rng, FLAVOR_LIBRARY.relief),
    request: pickFrom(rng, FLAVOR_LIBRARY.request),
    guild: pickFrom(rng, FLAVOR_LIBRARY.guild),
    resource: pickFrom(rng, FLAVOR_LIBRARY.resource),
    relative: pickFrom(rng, FLAVOR_LIBRARY.relative),
    offense: pickFrom(rng, FLAVOR_LIBRARY.offense),
    festival: pickFrom(rng, FLAVOR_LIBRARY.festival),
    horse: pickFrom(rng, FLAVOR_LIBRARY.horse),
    suitor: pickFrom(rng, FLAVOR_LIBRARY.suitor),
    dowry: pickFrom(rng, FLAVOR_LIBRARY.dowry),
  };
}

// Prompt library: docs/prompts.md#4-petition-prompt-library
const TEMPLATE_LIBRARY: TemplateSpec[] = [
  {
    task_type: "diplomacy",
    domain: "foreign",
    variants: [
      {
        suggested_action_types: ["send_envoy", "improve_relations", "sign_treaty", "issue_ultimatum", "sanction"],
        prompt: "A foreign envoy reports tensions with {{rivalName}}. {{topic}} is cited in recent dispatches. Provide a diplomatic response."
      },
      {
        suggested_action_types: ["send_envoy", "sign_treaty", "sanction", "issue_ultimatum"],
        prompt: "Merchants report disruption linked to {{topic}}. A response toward {{rivalName}} is requested to stabilize trade routes."
      },
      {
        suggested_action_types: ["recognize_claim", "send_envoy", "sign_treaty"],
        prompt: "Allies request that {{playerName}} recognize a territorial claim tied to {{topic}}. Decide whether to endorse the claim or negotiate terms."
      },
      {
        suggested_action_types: ["send_envoy", "sign_treaty", "improve_relations"],
        prompt: "A draft treaty on {{topic}} arrives from {{rivalName}}. Decide whether to sign, seek concessions, or stall."
      },
      {
        suggested_action_types: ["send_envoy", "improve_relations", "issue_ultimatum"],
        prompt: "Border envoys seek safe passage after a skirmish over {{topic}}. Decide on a message and whether to de-escalate."
      }
    ]
  },
  {
    task_type: "finance",
    domain: "finance",
    variants: [
      {
        suggested_action_types: ["adjust_tax_rate", "issue_debt", "cut_spending", "fund_project", "subsidize_sector"],
        prompt: "{{treasuryState}} tied to {{topic}}. Decide whether to raise revenue, restructure debt, or invest in relief."
      },
      {
        suggested_action_types: ["issue_debt", "cut_spending", "fund_project"],
        prompt: "Revenue lags behind expenditures as {{topic}} unfolds. The council asks whether to tighten budgets or seek new funds."
      },
      {
        suggested_action_types: ["adjust_tax_rate", "cut_spending", "subsidize_sector", "fund_project"],
        prompt: "Collectors warn that compliance is slipping over {{topic}}. Consider tax adjustments, spending cuts, or targeted subsidies."
      },
      {
        suggested_action_types: ["issue_debt", "cut_spending", "adjust_tax_rate"],
        prompt: "Bankers propose a loan to cover {{topic}}; the terms are steep. Decide whether to borrow or tighten the purse."
      },
      {
        suggested_action_types: ["subsidize_sector", "adjust_tax_rate", "issue_debt"],
        prompt: "The mint reports shortages of coin as {{topic}} spreads. Merchants ask for relief or new credit."
      }
    ]
  },
  {
    task_type: "interior",
    domain: "interior",
    variants: [
      {
        suggested_action_types: ["reform_law", "create_committee", "crackdown", "fund_project"],
        prompt: "Local magistrates warn of {{stabilityState}} connected to {{topic}}. The council requests an internal policy response."
      },
      {
        suggested_action_types: ["reform_law", "create_committee", "fund_project"],
        prompt: "Provincial councils request guidance on {{topic}}. Will you reform policy, appoint a commission, or invest in relief?"
      },
      {
        suggested_action_types: ["reform_law", "crackdown", "create_committee"],
        prompt: "Religious leaders warn that {{topic}} is stirring unrest. Decide on reforms, committees, or enforcement."
      },
      {
        suggested_action_types: ["create_committee", "reform_law", "crackdown"],
        prompt: "Pamphlets and rumors in {{locality}} stir unease. Decide on inquiry, reform, or enforcement."
      },
      {
        suggested_action_types: ["create_committee", "reform_law", "appoint_official"],
        prompt: "A boundary dispute between {{petitioners}} near {{locality}} requires arbitration. Decide on a tribunal or decree."
      }
    ]
  },
  {
    task_type: "war",
    domain: "war",
    variants: [
      {
        suggested_action_types: ["mobilize", "raise_levies", "fortify", "deploy_force", "reorganize_army"],
        prompt: "Border scouts report drills near {{rivalName}}. {{warWeariness}} Decide on readiness, fortifications, or force deployments."
      },
      {
        suggested_action_types: ["mobilize", "fortify", "deploy_force"],
        prompt: "Scouts warn of raids tied to {{topic}}. Commanders ask for orders on fortifications and patrol deployments."
      },
      {
        suggested_action_types: ["mobilize", "raise_levies", "reorganize_army"],
        prompt: "Quartermasters report strain on supplies as {{topic}} escalates. Decide on mobilization, levies, or reorganization."
      },
      {
        suggested_action_types: ["raise_levies", "reorganize_army", "mobilize"],
        prompt: "Mercenaries threaten to quit over arrears linked to {{topic}}. Commanders ask whether to raise levies or reorganize."
      },
      {
        suggested_action_types: ["fortify", "deploy_force", "raise_levies"],
        prompt: "Fort commanders in {{locality}} request reinforcements and repairs. Decide on fortifications or patrol deployments."
      }
    ]
  },
  {
    task_type: "intrigue",
    domain: "intelligence",
    variants: [
      {
        suggested_action_types: ["send_spy", "counterintelligence", "fund_faction", "leak_story"],
        prompt: "Whispers at court mention {{topic}} and foreign agents. The spymaster requests direction on intelligence operations."
      },
      {
        suggested_action_types: ["send_spy", "counterintelligence", "leak_story"],
        prompt: "Rumors spread around {{topic}}. The spymaster proposes discreet inquiries or counterintelligence sweeps."
      },
      {
        suggested_action_types: ["fund_faction", "send_spy", "leak_story"],
        prompt: "A dissident circle linked to {{topic}} seeks patronage. Decide on covert funding, exposure, or surveillance."
      },
      {
        suggested_action_types: ["send_spy", "counterintelligence", "fund_faction"],
        prompt: "A rival courtier is accused of bribery around {{topic}}. Decide on investigations, counterintelligence, or quiet patronage."
      }
    ]
  },
  {
    task_type: "appointment",
    domain: "chancellery",
    variants: [
      {
        suggested_action_types: ["appoint_official", "create_committee"],
        prompt: "A senior post in {{playerName}}'s court is underperforming. Recommend appointments or a review committee."
      },
      {
        suggested_action_types: ["appoint_official", "create_committee"],
        prompt: "Two courtiers vie for influence over {{topic}}. Choose an appointment or commission to settle the dispute."
      },
      {
        suggested_action_types: ["appoint_official", "create_committee"],
        prompt: "A vacancy opens after a scandal in {{topic}}. Name a successor or establish a review commission."
      }
    ]
  },
  {
    task_type: "petition",
    domain: "finance",
    variants: [
      {
        suggested_action_types: ["fund_project", "subsidize_sector", "reform_law"],
        prompt: "The {{guild}} petition over tariffs on {{resource}} tied to {{topic}}. They ask for {{relief}} or a chartered exception."
      },
      {
        suggested_action_types: ["subsidize_sector", "fund_project", "issue_debt"],
        prompt: "{{petitioners}} from {{locality}} plead for {{relief}} after {{hardship}}. Decide on subsidies, relief works, or austerity."
      },
      {
        suggested_action_types: ["issue_debt", "cut_spending", "appoint_official"],
        prompt: "{{petitioner}} seeks a small pension after {{hardship}}. Consider a stipend, a post, or refusal."
      },
      {
        suggested_action_types: ["adjust_tax_rate", "cut_spending", "issue_debt"],
        prompt: "Merchants warn levies on {{resource}} are stalling commerce in {{locality}}. They seek tax relief or new credit."
      }
    ]
  },
  {
    task_type: "petition",
    domain: "interior",
    variants: [
      {
        suggested_action_types: ["reform_law", "create_committee", "crackdown"],
        prompt: "{{petitioner}} petitions for legal protection after {{hardship}} in {{locality}}. Decide on reforms, commissions, or enforcement."
      },
      {
        suggested_action_types: ["fund_project", "create_committee", "reform_law"],
        prompt: "Clerics petition to found a school or hospice in {{locality}} and ask for {{relief}}."
      },
      {
        suggested_action_types: ["create_committee", "reform_law", "appoint_official"],
        prompt: "{{petitioners}} request arbitration over a boundary dispute near {{locality}}. Decide on a tribunal or decree."
      },
      {
        suggested_action_types: ["reform_law", "fund_project", "adjust_tax_rate"],
        prompt: "Town elders ask for authority to levy a maintenance fee to repair roads in {{locality}}."
      }
    ]
  },
  {
    task_type: "petition",
    domain: "war",
    variants: [
      {
        suggested_action_types: ["fortify", "deploy_force", "raise_levies"],
        prompt: "Frontier settlers petition for protection after raids near {{locality}}. Commanders await orders to fortify or deploy."
      },
      {
        suggested_action_types: ["issue_debt", "appoint_official", "cut_spending"],
        prompt: "Veterans petition for arrears after {{topic}} and ask for land or stipends. Decide on relief or deferment."
      },
      {
        suggested_action_types: ["deploy_force", "mobilize", "reorganize_army"],
        prompt: "Border wardens report deserters and petition for tighter patrols in {{locality}}. Decide on deployments or mobilization."
      }
    ]
  },
  {
    task_type: "petition",
    domain: "chancellery",
    variants: [
      {
        suggested_action_types: ["appoint_official", "create_committee", "reform_law"],
        prompt: "Nobles petition for new offices or legal privileges connected to {{topic}}. The council asks for appointments or a formal review."
      },
      {
        suggested_action_types: ["appoint_official", "create_committee"],
        prompt: "{{petitioner}} seeks a court office to oversee {{topic}}; rival candidates object. Decide on an appointment or review."
      },
      {
        suggested_action_types: ["reform_law", "create_committee", "appoint_official"],
        prompt: "{{petitioners}} petition to restore an old charter in {{locality}}. Decide on a grant, conditions, or denial."
      },
      {
        suggested_action_types: ["create_committee", "reform_law", "appoint_official"],
        prompt: "Two courtiers contest an inheritance and ask for a ruling. Decide on a tribunal or decree."
      }
    ]
  },
  {
    task_type: "petition",
    variants: [
      {
        tags: ["quirk"],
        suggested_action_types: ["fund_project", "issue_debt", "create_committee"],
        prompt: "A courtier arrives to brag about {{horse}} and asks to stage {{festival}} in its honor, with prize money."
      },
      {
        tags: ["quirk"],
        suggested_action_types: ["freeform_effect", "reform_law", "create_committee"],
        prompt: "A judge petitions to pardon his {{relative}} convicted of {{offense}}. Decide on a pardon, a review, or refusal."
      },
      {
        tags: ["quirk"],
        suggested_action_types: ["freeform_effect", "issue_debt", "reform_law"],
        prompt: "A minor noble asks permission to marry {{suitor}} and seeks {{dowry}}."
      },
      {
        tags: ["quirk"],
        suggested_action_types: ["reform_law", "subsidize_sector", "create_committee"],
        prompt: "The palace kitchens request exclusive purchase rights for {{resource}}; local merchants protest."
      },
      {
        tags: ["quirk"],
        suggested_action_types: ["fund_project", "create_committee", "subsidize_sector"],
        prompt: "A troupe petitions to perform a morality play praising {{playerName}} and requests a small grant."
      },
      {
        tags: ["quirk"],
        suggested_action_types: ["reform_law", "create_committee", "crackdown"],
        prompt: "A falconer asks for access to the royal forest to breed birds; hunters object."
      },
      {
        tags: ["quirk"],
        suggested_action_types: ["adjust_tax_rate", "subsidize_sector", "reform_law"],
        prompt: "A brewer seeks the court's seal on his ale and a tax exemption for {{locality}}."
      },
      {
        tags: ["quirk"],
        suggested_action_types: ["reform_law", "create_committee", "freeform_effect"],
        prompt: "A magistrate asks whether to allow a marriage between rival families to end a feud in {{locality}}."
      },
      {
        tags: ["quirk"],
        suggested_action_types: ["issue_debt", "deploy_force", "fund_project"],
        prompt: "A family begs to ransom a child taken by bandits after {{hardship}}. They ask for coin and escorts."
      },
      {
        tags: ["quirk"],
        suggested_action_types: ["fund_project", "create_committee", "issue_debt"],
        prompt: "A courtier petitions to rename a city gate in honor of {{playerName}}; masons request funds."
      }
    ]
  },
  {
    task_type: "crisis",
    variants: [
      {
        suggested_action_types: ["issue_debt", "fund_project", "mobilize", "create_committee"],
        urgency: "high",
        prompt: "A sudden crisis emerges around {{topic}}. The court demands a rapid, concrete response."
      },
      {
        suggested_action_types: ["mobilize", "fund_project", "create_committee", "issue_debt"],
        urgency: "high",
        prompt: "A volatile incident tied to {{topic}} threatens stability. The council demands immediate direction."
      },
      {
        suggested_action_types: ["create_committee", "mobilize", "fund_project"],
        urgency: "high",
        prompt: "Unrest spikes after {{topic}}. Emergency measures are requested at once."
      },
      {
        suggested_action_types: ["mobilize", "fund_project", "issue_debt"],
        urgency: "high",
        prompt: "A disaster tied to {{topic}} strains order and supplies. The court demands immediate action."
      }
    ]
  }
];

export async function fetchTaskWikiContext(scenario: Scenario, turnIndex: number): Promise<WikiPageSummary[]> {
  const cacheKey = `${scenario.scenario_id}:${turnIndex}`;
  const cached = wikiCache.get(cacheKey);
  if (cached) return cached;

  const player = scenario.nations.find((n) => n.nation_id === scenario.player_nation_id);
  const rival = scenario.nations.find((n) => n.nation_id !== scenario.player_nation_id);
  const year = scenario.start_date.slice(0, 4);
  const playerName = player?.name ?? "the realm";
  const rivalName = rival?.name ?? "neighboring powers";

  const queries = [
    `${playerName} economy ${year}`,
    `${playerName} military ${year}`,
    `${playerName} diplomacy ${rivalName}`,
    `${playerName} internal politics ${year}`,
    `${playerName} taxation ${year}`
  ];

  const referenceYear = Number.parseInt(scenario.start_date.slice(0, 4), 10);
  const yearFilter = Number.isFinite(referenceYear) ? referenceYear : undefined;
  try {
    const results = await retrieveWikipediaContext(queries, 1, { referenceYear: yearFilter });
    wikiCache.set(cacheKey, results);
    pruneWikiCache();
    return results;
  } catch {
    wikiCache.set(cacheKey, []);
    pruneWikiCache();
    return [];
  }
}

export function generateTasksForTurn(
  scenario: Scenario,
  turnIndex: number,
  seed: number,
  count: number,
  wikiContext: WikiPageSummary[] = [],
  storySeeds: StorySeed[] = [],
  worldState?: WorldState,
  storyChance = 0.4,
  generationOptions: TaskGenerationOptions = {}
): GeneratedTask[] {
  const templates = buildTemplates(scenario);
  if (templates.length === 0 || count <= 0) return [];

  const options = { ...DEFAULT_GENERATION_OPTIONS, ...generationOptions };
  const rng = mulberry32(seed ^ (turnIndex + 1));
  const usedTemplateIndices = new Set<number>();
  const usedStories = new Set<string>();
  const tasks: GeneratedTask[] = [];
  let taskCounter = 0;

  const player = scenario.nations.find((n) => n.nation_id === scenario.player_nation_id);
  const rival = scenario.nations.find((n) => n.nation_id !== scenario.player_nation_id);
  const playerSnapshot = worldState?.nations?.[scenario.player_nation_id]
    ?? scenario.nation_snapshots.find((n) => n.nation_id === scenario.player_nation_id);
  const ctxBase: Omit<TemplateContext, "topic" | "wiki"> = {
    playerName: player?.name ?? "the realm",
    rivalName: rival?.name ?? null,
    year: scenario.start_date.slice(0, 4),
    realm: {
      treasury: playerSnapshot?.treasury ?? 0,
      stability: playerSnapshot?.stability ?? 50,
      gdp: playerSnapshot?.gdp ?? 0,
      legitimacy: playerSnapshot?.legitimacy ?? 50,
      warExhaustion: playerSnapshot?.war_exhaustion ?? 0
    }
  };

  const templateIndicesByType = new Map<TaskTemplate["task_type"], number[]>();
  templates.forEach((template, index) => {
    const list = templateIndicesByType.get(template.task_type) ?? [];
    list.push(index);
    templateIndicesByType.set(template.task_type, list);
  });

  const petitionTemplateIndices = templates
    .map((template, index) => (template.task_type === "petition" && !template.tags.includes("quirk") ? index : -1))
    .filter((index) => index >= 0);
  const quirkTemplateIndices = templates
    .map((template, index) => (template.tags.includes("quirk") ? index : -1))
    .filter((index) => index >= 0);

  const minPetitions = Math.min(options.minPetitions, count);
  const quirkSlots = options.requireQuirk && count > 0 ? 1 : 0;
  const petitionSlots = Math.min(count, Math.max(minPetitions, quirkSlots));
  const remainingAfterPetitions = count - petitionSlots;

  let continuationSlots = 0;
  if (storySeeds.length > 0 && remainingAfterPetitions > 0 && (options.continuationShare > 0 || options.minContinuations > 0)) {
    const target = Math.max(options.minContinuations, Math.round(remainingAfterPetitions * options.continuationShare));
    continuationSlots = Math.min(storySeeds.length, target);
  }

  const remainingAfterContinuations = count - petitionSlots - continuationSlots;
  const allowStoryChance = options.continuationShare === 0 && options.minContinuations === 0;

  const storyPool = [...storySeeds];
  for (let i = storyPool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [storyPool[i], storyPool[j]] = [storyPool[j], storyPool[i]];
  }
  const continuationSeeds = storyPool.slice(0, continuationSlots);

  const pickTemplateIndex = (pool: number[], fallback: number[] = templates.map((_, index) => index)): number => {
    const source = pool.length > 0 ? pool : fallback;
    const available = source.filter((index) => !usedTemplateIndices.has(index));
    const selection = available.length > 0 ? available : source;
    const chosen = selection[Math.floor(rng() * selection.length)];
    usedTemplateIndices.add(chosen);
    return chosen;
  };

  const createTaskFromTemplate = (templateIndex: number, seedStory?: StorySeed) => {
    const template = templates[templateIndex];
    const taskIndex = taskCounter;
    taskCounter += 1;
    const taskId = buildTurnTaskId(seed, turnIndex, taskIndex);
    const taskRng = mulberry32((seed ^ (turnIndex + 1) ^ (taskIndex + 1) * 2654435761) >>> 0);
    const urgency = template.urgency ?? pickUrgency(taskRng);
    const wiki = pickWiki(wikiContext, taskRng);
    const topic = seedStory?.title ?? wiki?.title ?? `${ctxBase.playerName} affairs`;
    const prompt = template.prompt({ ...ctxBase, topic, wiki, story: seedStory }, taskRng);
    const sources = buildWikiSources(wiki);
    const ownerId = template.owner_character_id ?? pickOwnerForDomain(scenario, template.domain, worldState?.appointments);
    const story = seedStory
      ? buildStoryContinuation(seedStory, prompt, turnIndex)
      : buildNewStory(taskId, topic, prompt, turnIndex);
    if (seedStory) usedStories.add(seedStory.story_id);

    const taskData: Scenario["initial_tasks"][number] = {
      task_type: template.task_type,
      owner_character_id: ownerId ?? undefined,
      urgency,
      prompt,
      context_overrides: template.suggested_action_types.length > 0
        ? { suggested_action_types: template.suggested_action_types }
        : {}
    };

    const context = buildTaskContext(taskData, taskId, scenario.player_nation_id, turnIndex, sources);
    context.story = story;

    tasks.push({
      task_id: taskId,
      task_type: template.task_type,
      owner_character_id: ownerId ?? null,
      urgency,
      context,
      created_turn: turnIndex
    });
  };

  for (const seedStory of continuationSeeds) {
    const typePoolRaw = templateIndicesByType.get(seedStory.task_type) ?? [];
    const typePool = typePoolRaw.filter((index) => !templates[index].tags.includes("quirk"));
    const pool = typePool.length > 0 ? typePool : typePoolRaw;
    const idx = pickTemplateIndex(pool);
    createTaskFromTemplate(idx, seedStory);
  }

  if (quirkSlots > 0) {
    const idx = pickTemplateIndex(quirkTemplateIndices, petitionTemplateIndices);
    createTaskFromTemplate(idx);
  }

  for (let i = 0; i < petitionSlots - quirkSlots; i += 1) {
    const idx = pickTemplateIndex(petitionTemplateIndices);
    createTaskFromTemplate(idx);
  }

  for (let i = 0; i < remainingAfterContinuations; i += 1) {
    const idx = pickTemplateIndex(templates.map((_, index) => index));
    let seedStory: StorySeed | undefined;
    if (allowStoryChance) {
      seedStory = maybePickStorySeed(storySeeds, templates[idx], usedStories, rng, storyChance);
    }
    createTaskFromTemplate(idx, seedStory);
  }

  return tasks;
}

function buildTemplates(scenario: Scenario): TaskTemplate[] {
  const core = TEMPLATE_LIBRARY.flatMap((spec) =>
    spec.variants.map((variant) => ({
      task_type: spec.task_type,
      domain: spec.domain,
      suggested_action_types: variant.suggested_action_types,
      tags: variant.tags ?? [],
      owner_character_id: variant.owner_character_id ?? null,
      urgency: variant.urgency,
      prompt: (ctx, rng) => withStoryPrefix(ctx.story, renderTemplate(variant.prompt, ctx, rng), ctx.year)
    } satisfies TaskTemplate))
  );

  const initial = (scenario.initial_tasks ?? []).map((task) => {
    const suggested = extractSuggested(task.context_overrides);
    return {
      task_type: task.task_type,
      owner_character_id: task.owner_character_id ?? null,
      urgency: task.urgency ?? "medium",
      suggested_action_types: suggested,
      tags: [],
      prompt: () => task.prompt
    } satisfies TaskTemplate;
  });

  return [...core, ...initial];
}

function renderTemplate(template: string, ctx: TemplateContext, rng: () => number): string {
  const tokens: Record<string, string> = {
    playerName: ctx.playerName,
    realmName: ctx.playerName,
    rivalName: ctx.rivalName ?? "a rival",
    year: ctx.year,
    topic: ctx.topic,
    treasuryState: describeTreasury(ctx.realm.treasury, ctx.realm.gdp),
    stabilityState: describeStability(ctx.realm.stability),
    warWeariness: describeWarWeariness(ctx.realm.warExhaustion),
    ...buildFlavorTokens(rng),
    ...(ctx.tokens ?? {})
  };

  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => tokens[key] ?? match);
}

function maybePickStorySeed(
  storySeeds: StorySeed[],
  template: TaskTemplate,
  used: Set<string>,
  rng: () => number,
  storyChance: number
): StorySeed | undefined {
  if (!storySeeds.length) return undefined;
  const roll = rng();
  if (roll > storyChance) return undefined;
  const candidates = storySeeds.filter((seed) => seed.task_type === template.task_type && !used.has(seed.story_id));
  const pool = candidates.length ? candidates : storySeeds.filter((seed) => !used.has(seed.story_id));
  if (pool.length === 0) return undefined;
  const idx = Math.floor(rng() * pool.length);
  return pool[Math.min(pool.length - 1, Math.max(0, idx))];
}

function buildStoryContinuation(seed: StorySeed, prompt: string, turnIndex: number): TaskContext["story"] {
  const summary = summarizePrompt(prompt);
  const history = [...seed.history];
  history.push(formatHistoryEntry(turnIndex, summary));
  return {
    story_id: seed.story_id,
    title: seed.title,
    summary,
    history: history.slice(-6),
    last_turn: turnIndex,
    transcripts: seed.transcripts ?? []
  };
}

function buildNewStory(taskId: string, title: string, prompt: string, turnIndex: number): TaskContext["story"] {
  const summary = summarizePrompt(prompt);
  return {
    story_id: taskId,
    title,
    summary,
    history: [formatHistoryEntry(turnIndex, summary)],
    last_turn: turnIndex,
    transcripts: []
  };
}

function formatHistoryEntry(turnIndex: number, summary: string): string {
  return `Week ${turnIndex}: ${summary}`;
}

function extractSuggested(overrides: Record<string, unknown> | undefined): ActionType[] {
  const suggested = overrides?.suggested_action_types;
  if (Array.isArray(suggested)) return suggested.map(String) as ActionType[];
  const allowed = overrides?.allowed_action_types;
  if (Array.isArray(allowed)) return allowed.map(String) as ActionType[];
  return [];
}

function pickOwnerForDomain(
  scenario: Scenario,
  domain?: TaskTemplate["domain"],
  appointments?: AppointmentLike[]
): string | null {
  if (!domain) return null;
  const office = scenario.offices.find((entry) => entry.domain === domain && entry.nation_id === scenario.player_nation_id);
  if (!office) return null;
  const appointmentList = appointments && appointments.length > 0 ? appointments : scenario.appointments;
  const appointment = appointmentList.find((entry) => entry.office_id === office.office_id);
  return appointment?.character_id ?? null;
}

function pickWiki(context: WikiPageSummary[], rng: () => number): WikiPageSummary | undefined {
  if (context.length === 0) return undefined;
  const idx = Math.floor(rng() * context.length);
  return context[Math.min(context.length - 1, Math.max(0, idx))];
}

function buildWikiSources(wiki?: WikiPageSummary): TaskContext["sources"] {
  if (!wiki) return [];
  return [
    {
      source_type: "wikipedia",
      title: wiki.title,
      url: wiki.url,
      excerpt: wiki.extract ?? ""
    }
  ];
}

function pickUrgency(rng: () => number): "low" | "medium" | "high" {
  const roll = rng();
  if (roll < 0.2) return "low";
  if (roll < 0.8) return "medium";
  return "high";
}

function withStoryPrefix(story: StorySeed | undefined, prompt: string, year?: string): string {
  const yearPrefix = year ? `In ${year}, ` : "";
  if (!story) return `${yearPrefix}${prompt}`;
  const last = story.history[story.history.length - 1];
  const reminder = last ? formatReminder(last) : "our last ruling";
  const prefix = `Remember we did ${reminder}. `;
  return `${prefix}${yearPrefix}${prompt}`;
}

function summarizePrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  const withoutReminder = cleaned.replace(/^Remember we did[^.]*\.\s*/i, "").trim();
  const base = withoutReminder || cleaned;
  const firstSentence = base.split(/(?<=[.!?])\s+/)[0] ?? base;
  if (firstSentence.length <= 160) return firstSentence;
  return `${firstSentence.slice(0, 157)}…`;
}

function formatReminder(entry: string): string {
  const cleaned = entry.replace(/^Week\s+\d+:\s*/i, "").trim();
  const parts = cleaned.split("Decision:");
  const main = parts[0]?.trim() ?? cleaned;
  const decision = parts[1]?.trim();
  const withDecision = decision ? `${main} Decision was ${decision}` : main;
  return withDecision.replace(/\.$/, "").trim();
}

function describeTreasury(treasury: number, gdp: number): string {
  const ratio = gdp > 0 ? treasury / gdp : 0;
  if (ratio < 0.002) return "The treasury is nearly bare";
  if (ratio < 0.01) return "The treasury is strained";
  if (ratio < 0.03) return "The treasury remains steady";
  return "The treasury is flush";
}

function describeStability(stability: number): string {
  if (stability < 35) return "volatile unrest";
  if (stability < 55) return "unease";
  if (stability < 75) return "uneasy calm";
  return "confident calm";
}

function describeWarWeariness(warExhaustion: number): string {
  if (warExhaustion > 60) return "War weariness is severe.";
  if (warExhaustion > 30) return "War weariness is rising.";
  return "The realm is restless but ready.";
}
