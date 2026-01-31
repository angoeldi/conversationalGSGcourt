import type { Scenario, CourtChatRequest, CourtChatOutput, DecisionParseOutput, TaskContext } from "@thecourt/shared";
import { ActionTypes } from "@thecourt/shared";

export type CourtViewModel = {
  ruler: {
    characterId?: string;
    name: string;
    title: string;
    legitimacy: number;
    talents: {
      diplomacy: number;
      finance: number;
      war: number;
      admin: number;
    };
    health: string;
  };
  realm: {
    name: string;
    gdp: string;
    treasury: string;
    taxRate: string;
    stability: string;
    population: string;
    literacy: string;
    culture: string;
    religion: string;
  };
  council: Array<{
    characterId: string;
    name: string;
    office: string;
    domain: string;
    lit: boolean;
    stats: string;
  }>;
};

export type CourtierProfile = {
  characterId: string;
  name: string;
  title: string | undefined;
  office: string;
  domain: Scenario["offices"][number]["domain"];
  traits: string[];
  skills: Scenario["characters"][number]["skills"];
  advisorModel: Scenario["characters"][number]["advisor_model"];
};

type NationDirectoryEntry = {
  nation_id: string;
  name: string;
  tag: string;
  map_aliases: string[];
  summary: string;
  trajectory: Record<string, number | undefined>;
};

export type TaskViewModel = {
  taskId: string;
  taskType: "diplomacy" | "war" | "finance" | "interior" | "intrigue" | "appointment" | "petition" | "crisis";
  ownerCharacterId?: string;
  urgency: "low" | "medium" | "high";
  prompt: string;
  sources: TaskContext["sources"];
  story?: TaskContext["story"];
  allowedActionTypes: string[];
  suggestedActionTypes?: string[];
  state: "open" | "queued" | "resolved";
};

export type ChatMessage = {
  role: "player" | "courtier" | "system";
  content: string;
  speakerCharacterId?: string;
};

export type ActionEffectLogEntry = {
  effect_id: string;
  effect_type: string;
  delta: Record<string, unknown>;
  audit: Record<string, unknown>;
  created_at: string;
  action_id: string;
  action_type: string;
  turn_index: number | null;
  turn_date: string | null;
};

export type PortraitResponse = {
  character_id: string;
  prompt: string;
  provider: "openai" | "hf";
  model: string | null;
  size: "256x256" | "512x512" | "1024x1024";
  mime: string;
  b64: string;
  data_url: string;
};

export type LlmProviderName = "openai" | "openrouter" | "groq";
export type ImageProviderName = "openai" | "hf";

export type LlmProfile = {
  enabled: boolean;
  provider: LlmProviderName;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

export type ImageProfile = {
  enabled: boolean;
  provider: ImageProviderName;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  size?: PortraitResponse["size"];
};

export type LlmOverrides = {
  chat: LlmProfile;
  decision: LlmProfile;
  builder: LlmProfile;
  images: ImageProfile;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type LlmAuth = {
  provider: LlmProviderName;
  apiKey: string;
  model?: string;
  baseUrl?: string;
};

export type UserAuth = {
  token: string;
  email?: string;
  displayName?: string;
  userId?: string;
  isGuest?: boolean;
};

export type PlayerOptions = {
  limitFreeformDeltas: boolean;
  strictActionsOnly: boolean;
  petitionInflow: "low" | "normal" | "high";
  petitionCap: number;
  courtSize: "full" | "focused" | "core";
  courtChurn: boolean;
};

const LLM_AUTH_STORAGE_KEY = "court:llm-auth";
const LLM_OVERRIDES_STORAGE_KEY = "court:llm-overrides";
const USER_AUTH_STORAGE_KEY = "court:user-auth";
const GAME_ID_STORAGE_KEY = "court:game-id";
const PLAYER_OPTIONS_STORAGE_KEY = "court:player-options";

const DEFAULT_PLAYER_OPTIONS: PlayerOptions = {
  limitFreeformDeltas: false,
  strictActionsOnly: false,
  petitionInflow: "normal",
  petitionCap: 10,
  courtSize: "full",
  courtChurn: false
};

export function loadLlmAuth(): LlmAuth | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LLM_AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LlmAuth>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.apiKey || typeof parsed.apiKey !== "string") return null;
    if (parsed.provider !== "openai" && parsed.provider !== "openrouter" && parsed.provider !== "groq") return null;
    return {
      provider: parsed.provider,
      apiKey: parsed.apiKey,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined
    };
  } catch {
    return null;
  }
}

export function loadPlayerOptions(): PlayerOptions {
  if (typeof window === "undefined") return { ...DEFAULT_PLAYER_OPTIONS };
  const raw = window.localStorage.getItem(PLAYER_OPTIONS_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_PLAYER_OPTIONS };
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerOptions>;
    const capValue = typeof parsed?.petitionCap === "number" ? parsed.petitionCap : DEFAULT_PLAYER_OPTIONS.petitionCap;
    const petitionCap = Number.isFinite(capValue) ? Math.max(2, Math.min(25, Math.round(capValue))) : DEFAULT_PLAYER_OPTIONS.petitionCap;
    return {
      limitFreeformDeltas: Boolean(parsed?.limitFreeformDeltas),
      strictActionsOnly: Boolean(parsed?.strictActionsOnly),
      petitionInflow: parsed?.petitionInflow === "low" || parsed?.petitionInflow === "high" ? parsed.petitionInflow : "normal",
      petitionCap,
      courtSize: parsed?.courtSize === "core" || parsed?.courtSize === "focused" ? parsed.courtSize : "full",
      courtChurn: Boolean(parsed?.courtChurn)
    };
  } catch {
    return { ...DEFAULT_PLAYER_OPTIONS };
  }
}

export function savePlayerOptions(options: PlayerOptions): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLAYER_OPTIONS_STORAGE_KEY, JSON.stringify(options));
}

export function loadLlmOverrides(): LlmOverrides {
  if (typeof window === "undefined") return defaultOverrides();
  const raw = window.localStorage.getItem(LLM_OVERRIDES_STORAGE_KEY);
  if (raw) {
    try {
      return normalizeOverrides(JSON.parse(raw));
    } catch {
      return defaultOverrides();
    }
  }
  const legacy = loadLlmAuth();
  if (legacy) {
    const legacyProfile = {
      enabled: true,
      provider: legacy.provider,
      apiKey: legacy.apiKey,
      model: legacy.model,
      baseUrl: legacy.baseUrl
    };
    return {
      chat: legacyProfile,
      decision: legacyProfile,
      builder: legacyProfile,
      images: defaultImageProfile("openai")
    };
  }
  return defaultOverrides();
}

export function loadUserAuth(): UserAuth | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UserAuth>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.token || typeof parsed.token !== "string") return null;
    return {
      token: parsed.token,
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : undefined,
      userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
      isGuest: typeof parsed.isGuest === "boolean" ? parsed.isGuest : undefined
    };
  } catch {
    return null;
  }
}

export function saveLlmAuth(auth: LlmAuth | null): void {
  if (typeof window === "undefined") return;
  if (!auth) {
    window.localStorage.removeItem(LLM_AUTH_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(LLM_AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function saveLlmOverrides(overrides: LlmOverrides | null): void {
  if (typeof window === "undefined") return;
  if (!overrides) {
    window.localStorage.removeItem(LLM_OVERRIDES_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(LLM_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
}

function defaultOverrides(): LlmOverrides {
  return {
    chat: defaultLlmProfile("openai"),
    decision: defaultLlmProfile("openai"),
    builder: defaultLlmProfile("openai"),
    images: defaultImageProfile("openai")
  };
}

function defaultLlmProfile(provider: LlmProviderName): LlmProfile {
  return { enabled: false, provider };
}

function defaultImageProfile(provider: ImageProviderName): ImageProfile {
  return { enabled: false, provider };
}

function normalizeOverrides(raw: unknown): LlmOverrides {
  if (!raw || typeof raw !== "object") return defaultOverrides();
  const record = raw as Record<string, unknown>;
  return {
    chat: normalizeLlmProfile(record.chat, "openai"),
    decision: normalizeLlmProfile(record.decision, "openai"),
    builder: normalizeLlmProfile(record.builder, "openai"),
    images: normalizeImageProfile(record.images, "openai")
  };
}

function normalizeLlmProfile(raw: unknown, fallbackProvider: LlmProviderName): LlmProfile {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const provider = value.provider;
  const resolvedProvider =
    provider === "openai" || provider === "openrouter" || provider === "groq" ? provider : fallbackProvider;
  return {
    enabled: Boolean(value.enabled),
    provider: resolvedProvider,
    apiKey: normalizeString(value.apiKey),
    model: normalizeString(value.model),
    baseUrl: normalizeString(value.baseUrl)
  };
}

function normalizeImageProfile(raw: unknown, fallbackProvider: ImageProviderName): ImageProfile {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const provider = value.provider;
  const resolvedProvider = provider === "openai" || provider === "hf" ? provider : fallbackProvider;
  const size = normalizePortraitSize(value.size);
  return {
    enabled: Boolean(value.enabled),
    provider: resolvedProvider,
    apiKey: normalizeString(value.apiKey),
    model: normalizeString(value.model),
    baseUrl: normalizeString(value.baseUrl),
    size
  };
}

function normalizePortraitSize(value: unknown): PortraitResponse["size"] | undefined {
  if (value === "256x256" || value === "512x512" || value === "1024x1024") return value;
  return undefined;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function saveUserAuth(auth: UserAuth | null): void {
  if (typeof window === "undefined") return;
  if (!auth) {
    window.localStorage.removeItem(USER_AUTH_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(USER_AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearUserAuth(): void {
  saveUserAuth(null);
}

export function loadGameId(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(GAME_ID_STORAGE_KEY);
  if (!value) return null;
  return value;
}

export function saveGameId(gameId: string | null): void {
  if (typeof window === "undefined") return;
  if (!gameId) {
    window.localStorage.removeItem(GAME_ID_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(GAME_ID_STORAGE_KEY, gameId);
}

export type ScenarioViewModel = {
  gameId: string;
  scenarioId: string;
  court: CourtViewModel;
  courtiers: CourtierProfile[];
  tasks: TaskViewModel[];
  playerNationId: string;
  playerNationName: string;
  rivalNationNames: string[];
  geoPack: { id: string; version: string };
  nations: Array<{ nationId: string; name: string }>;
  relations: Scenario["relations"];
  nationProfiles: Record<string, { summary: string; trajectory: Record<string, number | undefined>; mapAliases: string[] }>;
  worldState: WorldState;
  characterIndex: Record<string, { name: string; title?: string }>;
  regionAssignments: Array<{ geoRegionId: string; geoRegionKey?: string; nationId: string }>;
  turnIndex: number;
  realmStats: {
    gdp: number;
    treasury: number;
    taxRate: number;
    stability: number;
    population: number;
    literacy: number;
    legitimacy: number;
  };
};

let cachedScenario: Promise<ScenarioViewModel> | null = null;
let cachedGameId: string | null = null;

export function fetchScenarioDefault(force = false): Promise<ScenarioViewModel> {
  const storedGameId = loadGameId();
  if (!cachedScenario || force || cachedGameId !== storedGameId) {
    cachedGameId = storedGameId;
    cachedScenario = loadScenario(storedGameId);
  }
  return cachedScenario;
}

export async function refreshScenario(gameId?: string | null): Promise<ScenarioViewModel> {
  const resolvedGameId = gameId === undefined ? loadGameId() : gameId;
  cachedGameId = resolvedGameId ?? null;
  cachedScenario = loadScenario(resolvedGameId ?? null);
  return cachedScenario;
}

export type ScenarioBuilderInput = {
  name: string;
  start_date: string;
  player_polity: string;
  region_focus: string;
  geo_pack_id?: string;
  geo_pack_version?: string;
  extra_wiki_queries?: string[];
};

type AuthResponse = {
  token: string;
  expires_at?: string;
  user: { user_id: string; email: string; display_name?: string; is_guest?: boolean };
};

export async function registerUser(input: { email: string; password: string; display_name?: string }): Promise<UserAuth> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as AuthResponse;
  return {
    token: json.token,
    email: json.user.email,
    displayName: json.user.display_name,
    userId: json.user.user_id,
    isGuest: json.user.is_guest
  };
}

export async function loginUser(input: { email: string; password: string }): Promise<UserAuth> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as AuthResponse;
  return {
    token: json.token,
    email: json.user.email,
    displayName: json.user.display_name,
    userId: json.user.user_id,
    isGuest: json.user.is_guest
  };
}

export async function promoteGuest(input: { email: string; password: string; display_name?: string }): Promise<UserAuth> {
  const res = await fetch("/api/auth/promote", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as AuthResponse;
  return {
    token: json.token,
    email: json.user.email,
    displayName: json.user.display_name,
    userId: json.user.user_id,
    isGuest: json.user.is_guest
  };
}

export async function logoutUser(): Promise<void> {
  const auth = loadUserAuth();
  if (!auth?.token) return;
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { ...buildAuthHeaders() }
  });
  if (!res.ok) throw new Error(await res.text());
}

async function ensureUserAuth(): Promise<UserAuth | null> {
  const existing = loadUserAuth();
  if (existing?.token) return existing;
  if (typeof window === "undefined") return null;
  const res = await fetch("/api/auth/guest", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as AuthResponse;
  const auth = {
    token: json.token,
    email: json.user.email,
    displayName: json.user.display_name,
    userId: json.user.user_id,
    isGuest: json.user.is_guest ?? true
  };
  saveUserAuth(auth);
  return auth;
}

export async function sendFeedback(message: string, gameId?: string | null): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("Feedback message is required.");
  await ensureUserAuth();
  const payload: { message: string; game_id?: string } = { message: trimmed };
  const resolvedGameId = gameId ?? loadGameId();
  if (resolvedGameId) payload.game_id = resolvedGameId;
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function createScenarioFromBuilder(input: ScenarioBuilderInput): Promise<ScenarioViewModel> {
  await ensureUserAuth();
  const builderRes = await fetch("/api/builder/init-scenario", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildLlmHeaders("builder"), ...buildAuthHeaders() },
    body: JSON.stringify({
      ...input,
      extra_wiki_queries: input.extra_wiki_queries ?? []
    })
  });
  if (!builderRes.ok) {
    const text = await builderRes.text();
    throw new Error(text || "Scenario builder failed");
  }
  const scenario = (await builderRes.json()) as Scenario;

  const createRes = await fetch("/api/scenarios", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
    body: JSON.stringify({ scenario })
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(text || "Scenario creation failed");
  }
  const gameState = (await createRes.json()) as GameStateResponse;
  const viewModel = buildScenarioViewModelFromGame(gameState);
  cachedGameId = viewModel.gameId;
  cachedScenario = Promise.resolve(viewModel);
  saveGameId(viewModel.gameId);
  return viewModel;
}

type LlmOverrideKind = "chat" | "decision" | "builder";

function buildLlmHeaders(kind: LlmOverrideKind): Record<string, string> {
  const overrides = loadLlmOverrides();
  const profile = overrides[kind];
  if (!profile?.enabled) return {};
  const headers: Record<string, string> = {
    "x-llm-provider": profile.provider
  };
  if (profile.apiKey) headers["x-llm-api-key"] = profile.apiKey;
  if (profile.model) headers["x-llm-model"] = profile.model;
  if (profile.baseUrl) headers["x-llm-base-url"] = profile.baseUrl;
  return headers;
}

function buildPortraitHeaders(): Record<string, string> {
  const overrides = loadLlmOverrides();
  const profile = overrides.images;
  if (!profile?.enabled) return {};
  const headers: Record<string, string> = {};
  if (profile.apiKey) headers["x-portrait-api-key"] = profile.apiKey;
  if (profile.baseUrl) headers["x-portrait-base-url"] = profile.baseUrl;
  return headers;
}

function buildAuthHeaders(): Record<string, string> {
  const auth = loadUserAuth();
  if (!auth?.token) return {};
  return { Authorization: `Bearer ${auth.token}` };
}

function buildOptionHeaders(): Record<string, string> {
  const options = loadPlayerOptions();
  const headers: Record<string, string> = {};
  if (options.limitFreeformDeltas) headers["x-freeform-delta-limit"] = "1";
  if (options.strictActionsOnly) headers["x-strict-actions-only"] = "1";
  if (options.petitionInflow !== "normal") headers["x-petition-inflow"] = options.petitionInflow;
  if (options.petitionCap !== DEFAULT_PLAYER_OPTIONS.petitionCap) {
    headers["x-petition-cap"] = String(options.petitionCap);
  }
  if (options.courtChurn) headers["x-court-churn"] = "1";
  return headers;
}

function buildUrlWithGameId(path: string, gameId?: string | null): string {
  if (!gameId) return path;
  const [base, query] = path.split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("game_id", gameId);
  return `${base}?${params.toString()}`;
}

export async function requestCourtChat(payload: CourtChatRequest): Promise<CourtChatOutput> {
  const res = await fetch("/api/llm/court-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildLlmHeaders("chat"), ...buildAuthHeaders() },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as CourtChatOutput;
}

export async function requestDecisionParse(taskContext: TaskContext, playerText: string): Promise<DecisionParseOutput> {
  const res = await fetch("/api/llm/decision-parse", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildLlmHeaders("decision"), ...buildOptionHeaders(), ...buildAuthHeaders() },
    body: JSON.stringify({ task_context: taskContext, player_text: playerText })
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as DecisionParseOutput;
}

export async function queueDecision(payload: {
  task_context: TaskContext;
  player_text: string;
  stage: "discussion" | "no_objection" | "final";
  transcript: ChatMessage[];
  gameId?: string;
}): Promise<{ decision: DecisionParseOutput; queued_actions: number }> {
  const { gameId, transcript: rawTranscript, ...rest } = payload;
  const transcript = rawTranscript.map((message) => ({
    role: message.role,
    content: message.content,
    speaker_character_id: message.speakerCharacterId
  }));
  const res = await fetch("/api/game/decisions/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildLlmHeaders("decision"), ...buildOptionHeaders(), ...buildAuthHeaders() },
    body: JSON.stringify({
      ...rest,
      transcript,
      game_id: gameId
    })
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { decision: DecisionParseOutput; queued_actions: number };
}

export async function advanceWeek(options?: { auto_decide_open?: boolean; gameId?: string }): Promise<{
  turn_index: number;
  processed_actions: number;
  processed_decisions: number;
  auto_decided_tasks?: number;
  rejected_actions?: Array<{ action_id: string; type: string; reason: string; target_nation_id?: string }>;
}> {
  const { gameId, ...rest } = options ?? {};
  const res = await fetch("/api/game/advance-week", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildOptionHeaders(), ...buildAuthHeaders() },
    body: JSON.stringify({
      ...rest,
      game_id: gameId
    })
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as {
    turn_index: number;
    processed_actions: number;
    processed_decisions: number;
    auto_decided_tasks?: number;
    rejected_actions?: Array<{ action_id: string; type: string; reason: string; target_nation_id?: string }>;
  };
}

export async function fetchActionLog(limit = 50, offset = 0, gameId?: string): Promise<ActionEffectLogEntry[]> {
  const base = `/api/game/action-log?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`;
  const res = await fetch(buildUrlWithGameId(base, gameId), { headers: buildAuthHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  return (json?.entries ?? []) as ActionEffectLogEntry[];
}

export async function fetchPortrait(characterId: string, options?: { gameId?: string }): Promise<PortraitResponse> {
  const params = new URLSearchParams();
  if (options?.gameId) params.set("game_id", options.gameId);
  const overrides = loadLlmOverrides();
  const imageProfile = overrides.images;
  if (imageProfile?.enabled) {
    if (imageProfile.provider) params.set("provider", imageProfile.provider);
    if (imageProfile.model) params.set("model", imageProfile.model);
    if (imageProfile.size) params.set("size", imageProfile.size);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/portraits/${encodeURIComponent(characterId)}${suffix}`, {
    headers: { ...buildAuthHeaders(), ...buildPortraitHeaders() }
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(text) as { error?: string; code?: string; reason?: string };
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.error === "string") message = parsed.error;
        if (typeof parsed.code === "string") code = parsed.code;
        if (!code && typeof parsed.reason === "string") code = parsed.reason;
      }
    } catch {
      // ignore parse errors
    }
    if (!code) {
      const match = message.match(/\(([^)]+)\)/);
      if (match?.[1]) code = match[1];
    }
    throw new ApiError(res.status, message, code);
  }
  return (await res.json()) as PortraitResponse;
}

export function buildTaskContext(task: TaskViewModel, playerNationId: string, messages: ChatMessage[]): TaskContext {
  return {
    task_id: task.taskId,
    task_type: task.taskType,
    owner_character_id: task.ownerCharacterId,
    nation_id: playerNationId,
    created_turn: 0,
    urgency: task.urgency,
    prompt: task.prompt,
    sources: task.sources ?? [],
    story: task.story,
    perceived_facts: [],
    entities: [],
    constraints: {
      allowed_action_types: task.allowedActionTypes,
      forbidden_action_types: [],
      suggested_action_types: task.suggestedActionTypes ?? [],
      notes: []
    },
    chat_summary: "",
    last_messages: messages.slice(-12).map((msg) => ({
      role: msg.role,
      sender_character_id: msg.speakerCharacterId,
      content: msg.content
    }))
  };
}

type WorldState = {
  turn_index: number;
  turn_seed?: number;
  player_nation_id?: string;
  nations: Record<string, {
    nation_id: string;
    gdp: number;
    treasury: number;
    tax_rate: number;
    tax_capacity: number;
    compliance: number;
    debt: number;
    stability: number;
    population: number;
    literacy: number;
    legitimacy: number;
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
  }>;
  provinces?: Record<string, {
    geo_region_id: string;
    geo_region_key?: string;
    nation_id: string;
    population: number;
    productivity: number;
    infrastructure: number;
    unrest: number;
    compliance_local: number;
    garrison: number;
    resources: string[];
    culture_mix: Record<string, number>;
    religion_mix: Record<string, number>;
  }>;
  relations: Scenario["relations"];
  nation_trajectories?: Record<string, Record<string, number | undefined>>;
  trajectory_modifiers?: Array<{
    modifier_id: string;
    nation_id: string;
    metric: string;
    delta: number;
    remaining_weeks: number;
    source?: string;
    note?: string;
  }>;
  appointments?: Array<{
    office_id: string;
    character_id: string;
    start_turn: number;
  }>;
  debt_instruments?: Array<{
    instrument_id: string;
    nation_id: string;
    principal: number;
    interest_rate_annual: number;
    remaining_weeks: number;
    issued_turn: number;
  }>;
};

type GameStateResponse = {
  scenario: Scenario;
  world_state: WorldState;
  nation_directory?: NationDirectoryEntry[];
  tasks: Array<{
    task_id: string;
    task_type: TaskViewModel["taskType"];
    owner_character_id: string | null;
    urgency: TaskViewModel["urgency"];
    state: TaskViewModel["state"];
    context: TaskContext;
  }>;
  current_turn: number;
  game_id: string;
  scenario_id?: string;
};

async function loadScenario(gameId?: string | null): Promise<ScenarioViewModel> {
  await ensureUserAuth();
  const resolvedGameId = gameId === undefined ? loadGameId() : gameId;
  const authHeaders = buildAuthHeaders();
  let res = await fetch(buildUrlWithGameId("/api/game/state", resolvedGameId ?? undefined), { headers: authHeaders });
  if (!res.ok && resolvedGameId) {
    saveGameId(null);
    res = await fetch("/api/game/state", { headers: authHeaders });
  }
  if (!res.ok && res.status === 401 && Object.keys(authHeaders).length > 0) {
    clearUserAuth();
    saveGameId(null);
    await ensureUserAuth();
    const retryHeaders = buildAuthHeaders();
    res = await fetch("/api/game/state", { headers: retryHeaders });
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to load scenario");
  }
  const json = await res.json();
  const viewModel = buildScenarioViewModelFromGame(json as GameStateResponse);
  saveGameId(viewModel.gameId);
  return viewModel;
}

function buildScenarioViewModelFromGame(gameState: GameStateResponse): ScenarioViewModel {
  const { scenario, world_state: worldState, tasks: taskRows } = gameState;
  const options = loadPlayerOptions();
  const gameId = gameState.game_id;
  const scenarioId = gameState.scenario_id ?? scenario.scenario_id;
  const playerNation = scenario.nations.find((nation) => nation.nation_id === scenario.player_nation_id);
  const rivalNationNames = scenario.nations
    .filter((nation) => nation.nation_id !== scenario.player_nation_id)
    .map((nation) => nation.name);
  const playerSnapshot = worldState.nations[scenario.player_nation_id]
    ?? scenario.nation_snapshots.find((snapshot) => snapshot.nation_id === scenario.player_nation_id);
  const ruler = scenario.characters.find((character) => character.traits?.includes("ruler")) ?? scenario.characters[0];

  const tasks = taskRows;
  const litOwners = new Set(tasks.filter((task) => task.state === "open").map((task) => task.owner_character_id).filter(Boolean));

  const officesById = new Map(scenario.offices.map((office) => [office.office_id, office]));
  const activeAppointments = (worldState.appointments && worldState.appointments.length > 0)
    ? worldState.appointments
    : scenario.appointments;
  const appointmentsByOffice = new Map(activeAppointments.map((appointment) => [appointment.office_id, appointment]));
  const charactersById = new Map(scenario.characters.map((character) => [character.character_id, character]));

  const baseCouncil = scenario.offices
    .filter((office) => office.nation_id === scenario.player_nation_id)
    .map((office) => {
      const appointment = appointmentsByOffice.get(office.office_id);
      const character = appointment ? charactersById.get(appointment.character_id) : undefined;
      const stats = character ? buildAdvisorStats(character, office.domain) : "Vacant seat";
      return {
        characterId: character?.character_id ?? `vacant-${office.office_id}`,
        name: character?.name ?? "Vacant",
        office: office.name,
        domain: office.domain,
        lit: !!(character && litOwners.has(character.character_id)),
        stats
      };
    });

  const churnedCouncil = applyCourtChurn(baseCouncil, options, worldState.turn_seed ?? 0, gameState.current_turn);
  const council = applyCourtSizeLimit(churnedCouncil, options.courtSize);

  const courtView: CourtViewModel = {
    ruler: {
      characterId: ruler?.character_id,
      name: ruler?.name ?? "Unknown",
      title: ruler?.title ?? "Ruler",
      legitimacy: playerSnapshot?.legitimacy ?? 0,
      talents: {
        diplomacy: ruler?.skills?.diplomacy ?? 0,
        finance: ruler?.skills?.finance ?? 0,
        war: ruler?.skills?.war ?? 0,
        admin: ruler?.skills?.admin ?? 0
      },
      health: "Unknown"
    },
    realm: {
      name: playerNation?.name ?? "Unknown Realm",
      gdp: formatNumber(playerSnapshot?.gdp ?? 0),
      treasury: formatNumber(playerSnapshot?.treasury ?? 0),
      taxRate: formatPercent(playerSnapshot?.tax_rate ?? 0),
      stability: `${Math.round(playerSnapshot?.stability ?? 0)}`,
      population: formatNumber(playerSnapshot?.population ?? 0),
      literacy: formatPercent(playerSnapshot?.literacy ?? 0),
      culture: formatMix(playerSnapshot?.culture_mix ?? {}),
      religion: formatMix(playerSnapshot?.religion_mix ?? {})
    },
    council
  };

  const tasksView = tasks.map((task) => {
    const rawPrompt = task.context?.prompt ?? "New petition.";
    const sources = task.context?.sources ?? [];
    const normalized = normalizeTaskPrompt(rawPrompt, sources);
    const allowedActions = applyActionTypeOptions(task.context?.constraints?.allowed_action_types, options);
    const suggestedActions = task.context?.constraints?.suggested_action_types ?? [];
    return {
      taskId: task.task_id,
      taskType: task.task_type,
      ownerCharacterId: task.owner_character_id ?? undefined,
      urgency: task.urgency ?? "medium",
      prompt: normalized.prompt,
      sources: normalized.sources,
      story: task.context?.story,
      allowedActionTypes: allowedActions,
      suggestedActionTypes: suggestedActions,
      state: task.state ?? "open"
    };
  });

  const courtiers = activeAppointments
    .map((appointment) => {
      const office = officesById.get(appointment.office_id);
      if (!office || office.nation_id !== scenario.player_nation_id) return null;
      const character = charactersById.get(appointment.character_id);
      if (!character) return null;
      return {
        characterId: character.character_id,
        name: character.name,
        title: character.title,
        office: office.name,
        domain: office.domain,
        traits: character.traits ?? [],
        skills: character.skills,
        advisorModel: character.advisor_model
      };
    })
    .filter((entry): entry is CourtierProfile => Boolean(entry));

  const characterIndex = scenario.characters.reduce<Record<string, { name: string; title?: string }>>((acc, character) => {
    acc[character.character_id] = { name: character.name, title: character.title };
    return acc;
  }, {});

  const regionAssignments = scenario.region_assignments.map((assignment) => ({
    geoRegionId: assignment.geo_region_id,
    geoRegionKey: assignment.geo_region_key,
    nationId: assignment.nation_id
  }));

  const directory = (gameState.nation_directory ?? []).length > 0
    ? gameState.nation_directory ?? []
    : scenario.nations.map((nation) => {
      const profile = scenario.nation_profiles?.find((entry) => entry.nation_id === nation.nation_id);
      return {
        nation_id: nation.nation_id,
        name: nation.name,
        tag: nation.tag,
        map_aliases: profile?.map_aliases ?? [],
        summary: profile?.summary ?? `${nation.name} is a sovereign state.`,
        trajectory: profile?.trajectory ?? {}
      };
    });

  const nationProfiles = directory.reduce<Record<string, { summary: string; trajectory: Record<string, number | undefined>; mapAliases: string[] }>>((acc, entry) => {
    acc[entry.nation_id] = {
      summary: entry.summary,
      trajectory: entry.trajectory ?? {},
      mapAliases: entry.map_aliases ?? []
    };
    return acc;
  }, {});

  return {
    gameId,
    scenarioId,
    court: courtView,
    courtiers,
    tasks: tasksView,
    playerNationId: scenario.player_nation_id,
    playerNationName: playerNation?.name ?? "Player Realm",
    rivalNationNames,
    geoPack: {
      id: scenario.geo_pack?.id ?? "ne_admin1_v1",
      version: scenario.geo_pack?.version ?? "1"
    },
    nations: directory.map((nation) => ({
      nationId: nation.nation_id,
      name: nation.name
    })),
    relations: worldState.relations ?? scenario.relations ?? [],
    nationProfiles,
    worldState,
    characterIndex,
    regionAssignments,
    turnIndex: worldState.turn_index,
    realmStats: {
      gdp: playerSnapshot?.gdp ?? 0,
      treasury: playerSnapshot?.treasury ?? 0,
      taxRate: playerSnapshot?.tax_rate ?? 0,
      stability: playerSnapshot?.stability ?? 0,
      population: playerSnapshot?.population ?? 0,
      literacy: playerSnapshot?.literacy ?? 0,
      legitimacy: playerSnapshot?.legitimacy ?? 0
    }
  };
}

function buildAdvisorStats(character: Scenario["characters"][number], domain: string): string {
  const skill = pickSkillValue(character.skills, domain);
  const skillLabel = pickSkillLabel(domain);
  const reliability = formatDecimal(character.advisor_model?.reliability ?? 0);
  const accuracy = formatDecimal(character.advisor_model?.accuracy ?? 0);
  return `${skillLabel} ${skill}, Reliability ${reliability}, Accuracy ${accuracy}`;
}

function pickSkillValue(skills: Scenario["characters"][number]["skills"] | undefined, domain: string): number {
  if (!skills) return 0;
  switch (domain) {
    case "foreign":
      return skills.diplomacy ?? 0;
    case "finance":
      return skills.finance ?? 0;
    case "war":
      return skills.war ?? 0;
    case "interior":
      return skills.interior ?? 0;
    case "intelligence":
      return skills.intrigue ?? 0;
    case "chancellery":
      return skills.admin ?? 0;
    default:
      return 0;
  }
}

function pickSkillLabel(domain: string): string {
  switch (domain) {
    case "foreign":
      return "Diplomacy";
    case "finance":
      return "Finance";
    case "war":
      return "War";
    case "interior":
      return "Interior";
    case "intelligence":
      return "Intrigue";
    case "chancellery":
      return "Admin";
    default:
      return "Skill";
  }
}

function formatDecimal(value: number): string {
  return value.toFixed(2);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return `${Math.round(value)}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatMix(mix: Record<string, number>): string {
  const entries = Object.entries(mix);
  if (entries.length === 0) return "Unknown";
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  return sorted
    .slice(0, 2)
    .map(([key, fraction]) => `${titleCase(key)} ${Math.round(fraction * 100)}%`)
    .join(", ");
}

function applyActionTypeOptions(allowed: string[] | undefined, options: PlayerOptions): string[] {
  const base = Array.isArray(allowed) ? allowed.map(String) : [...ActionTypes];
  if (options.strictActionsOnly) {
    return base.filter((type) => type !== "freeform_effect");
  }
  return base;
}

function applyCourtSizeLimit(council: CourtViewModel["council"], size: PlayerOptions["courtSize"]): CourtViewModel["council"] {
  if (size === "full") return council;
  const limit = size === "focused" ? 5 : 3;
  return council.slice(0, limit);
}

function applyCourtChurn(
  council: CourtViewModel["council"],
  options: PlayerOptions,
  seed: number,
  turnIndex: number
): CourtViewModel["council"] {
  if (!options.courtChurn) return council;
  const eligible = council.filter((entry) => !entry.characterId.startsWith("vacant-"));
  if (eligible.length === 0) return council;
  const churned = new Set<string>();
  for (const entry of eligible) {
    const rng = mulberry32(seed ^ hashString(entry.characterId));
    const willLeave = rng() < 0.25;
    if (!willLeave) continue;
    const leaveTurn = 4 + Math.floor(rng() * 78);
    if (turnIndex >= leaveTurn) churned.add(entry.characterId);
  }
  const minRemaining = Math.min(2, eligible.length);
  if (eligible.length - churned.size < minRemaining) {
    for (const entry of eligible) {
      if (!churned.has(entry.characterId)) continue;
      churned.delete(entry.characterId);
      if (eligible.length - churned.size >= minRemaining) break;
    }
  }
  return council.filter((entry) => entry.characterId.startsWith("vacant-") || !churned.has(entry.characterId));
}

function normalizeTaskPrompt(rawPrompt: string, sources: TaskContext["sources"] | undefined): {
  prompt: string;
  sources: TaskContext["sources"];
} {
  const cleaned = stripWikiContext(rawPrompt);
  if (sources && sources.length > 0) {
    return { prompt: cleaned || rawPrompt, sources };
  }
  const extracted = extractWikiSource(rawPrompt);
  if (extracted) return extracted;
  return { prompt: cleaned || rawPrompt, sources: [] };
}

function stripWikiContext(prompt: string): string {
  const marker = "\n\nContext (Wikipedia:";
  const idx = prompt.indexOf(marker);
  if (idx === -1) return prompt;
  return prompt.slice(0, idx).trim();
}

function extractWikiSource(prompt: string): { prompt: string; sources: TaskContext["sources"] } | null {
  const marker = "\n\nContext (Wikipedia:";
  const idx = prompt.indexOf(marker);
  if (idx === -1) return null;
  const rest = prompt.slice(idx + marker.length);
  const closing = rest.indexOf("):");
  if (closing === -1) return null;
  const title = rest.slice(0, closing).trim();
  const excerpt = rest.slice(closing + 2).trim();
  if (!title) return null;
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  return {
    prompt: prompt.slice(0, idx).trim() || prompt,
    sources: [{ source_type: "wikipedia", title, url, excerpt }]
  };
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function buildAllowedActions(contextOverrides: Record<string, unknown> | undefined, options = loadPlayerOptions()): string[] {
  const override = contextOverrides?.allowed_action_types;
  if (Array.isArray(override)) return applyActionTypeOptions(override.map(String), options);
  return applyActionTypeOptions(undefined, options);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
