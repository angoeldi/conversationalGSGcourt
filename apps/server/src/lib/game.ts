import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Scenario, TaskContext } from "@thecourt/shared";
import { Scenario as ScenarioSchema } from "@thecourt/shared";
import { ActionTypes } from "@thecourt/shared";
import type { WorldState } from "@thecourt/engine";
import { loadScenario } from "./scenario";
import { buildGameTaskId } from "./ids";
import { buildWorldState, hydrateWorldState } from "./worldState";
import { normalizeScenarioGeoRegions } from "./geoRegion";

type GameRow = {
  game_id: string;
  scenario_id: string;
  seed: number;
  current_turn: number;
  user_id: string | null;
};

export async function ensureDefaultGame(c: pg.PoolClient): Promise<{ scenario: Scenario; game: GameRow; world_state: WorldState }> {
  const scenario = await loadScenario();

  await ensureScenarioRow(c, scenario);

  const gameRows = (await c.query(
    "SELECT game_id, scenario_id, seed, current_turn, user_id FROM games WHERE scenario_id = $1 AND user_id IS NULL ORDER BY created_at LIMIT 1",
    [scenario.scenario_id]
  )).rows as GameRow[];

  let game = gameRows[0];
  if (!game) {
    const gameId = randomUUID();
    const seed = Math.floor(Math.random() * 2 ** 31);
    await c.query(
      `INSERT INTO games (game_id, scenario_id, seed, current_turn, user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [gameId, scenario.scenario_id, seed, 0, null]
    );
    game = { game_id: gameId, scenario_id: scenario.scenario_id, seed, current_turn: 0, user_id: null };
  }

  await ensureTasksForGame(c, scenario, game, { stableTaskIds: true });
  const worldState = await ensureWorldSnapshot(c, scenario, game);

  return { scenario, game, world_state: worldState };
}

export async function ensureGame(
  c: pg.PoolClient,
  options: { gameId?: string; userId?: string } = {}
): Promise<{ scenario: Scenario; game: GameRow; world_state: WorldState }> {
  if (options.gameId) return ensureGameById(c, options.gameId, options.userId);
  if (options.userId) return ensureUserGame(c, options.userId);
  return ensureDefaultGame(c);
}

export async function ensureGameById(
  c: pg.PoolClient,
  gameId: string,
  userId?: string
): Promise<{ scenario: Scenario; game: GameRow; world_state: WorldState }> {
  const gameRows = (await c.query(
    "SELECT game_id, scenario_id, seed, current_turn, user_id FROM games WHERE game_id = $1",
    [gameId]
  )).rows as GameRow[];
  const game = gameRows[0];
  if (!game) throw new Error("Game not found.");
  if (userId && game.user_id !== userId) throw new Error("Game not found.");

  const scenarioRows = (await c.query(
    "SELECT scenario_json FROM scenarios WHERE scenario_id = $1",
    [game.scenario_id]
  )).rows as Array<{ scenario_json: Scenario }>;
  const rawScenario = scenarioRows[0]?.scenario_json;
  if (!rawScenario) throw new Error("Scenario not found.");
  const normalized = normalizeScenarioGeoRegions(rawScenario);
  const parsed = ScenarioSchema.parse(normalized.scenario);
  if (normalized.changed) {
    await c.query(
      "UPDATE scenarios SET scenario_json = $1 WHERE scenario_id = $2",
      [parsed, parsed.scenario_id]
    );
  }
  const scenario = parsed;

  await ensureTasksForGame(c, scenario, game, { stableTaskIds: false });
  const worldState = await ensureWorldSnapshot(c, scenario, game);
  return { scenario, game, world_state: worldState };
}

export async function createGameForScenario(
  c: pg.PoolClient,
  scenario: Scenario,
  options: { seed?: number; userId?: string } = {}
): Promise<{ scenario: Scenario; game: GameRow; world_state: WorldState }> {
  const normalized = normalizeScenarioGeoRegions(scenario);
  const parsed = ScenarioSchema.parse(normalized.scenario);
  await ensureScenarioRow(c, parsed);
  const gameId = randomUUID();
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  await c.query(
    `INSERT INTO games (game_id, scenario_id, seed, current_turn, user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [gameId, scenario.scenario_id, seed, 0, options.userId ?? null]
  );
  const game: GameRow = {
    game_id: gameId,
    scenario_id: scenario.scenario_id,
    seed,
    current_turn: 0,
    user_id: options.userId ?? null
  };
  await ensureTasksForGame(c, parsed, game, { stableTaskIds: false });
  const worldState = await ensureWorldSnapshot(c, parsed, game);
  return { scenario: parsed, game, world_state: worldState };
}

async function ensureUserGame(
  c: pg.PoolClient,
  userId: string
): Promise<{ scenario: Scenario; game: GameRow; world_state: WorldState }> {
  const scenario = await loadScenario();

  await ensureScenarioRow(c, scenario);

  const gameRows = (await c.query(
    "SELECT game_id, scenario_id, seed, current_turn, user_id FROM games WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [userId]
  )).rows as GameRow[];

  let game = gameRows[0];
  if (!game) {
    const gameId = randomUUID();
    const seed = Math.floor(Math.random() * 2 ** 31);
    await c.query(
      `INSERT INTO games (game_id, scenario_id, seed, current_turn, user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [gameId, scenario.scenario_id, seed, 0, userId]
    );
    game = { game_id: gameId, scenario_id: scenario.scenario_id, seed, current_turn: 0, user_id: userId };
  }

  await ensureTasksForGame(c, scenario, game, { stableTaskIds: true });
  const worldState = await ensureWorldSnapshot(c, scenario, game);

  return { scenario, game, world_state: worldState };
}

export function buildTaskContext(
  task: Scenario["initial_tasks"][number],
  taskId: string,
  nationId: string,
  createdTurn = 0,
  sources: TaskContext["sources"] = []
): TaskContext {
  const suggested = buildSuggestedActions(task.context_overrides);
  return {
    task_id: taskId,
    task_type: task.task_type,
    owner_character_id: task.owner_character_id,
    nation_id: nationId,
    created_turn: createdTurn,
    urgency: task.urgency ?? "medium",
    prompt: task.prompt,
    sources,
    perceived_facts: [],
    entities: [],
    constraints: {
      allowed_action_types: [...ActionTypes],
      forbidden_action_types: [],
      suggested_action_types: suggested,
      notes: suggested.length ? [`Suggested action types: ${suggested.join(", ")}`] : []
    },
    chat_summary: "",
    last_messages: []
  };
}

function buildSuggestedActions(contextOverrides: Record<string, unknown> | undefined): string[] {
  const suggested = contextOverrides?.suggested_action_types;
  if (Array.isArray(suggested)) return suggested.map(String);
  const override = contextOverrides?.allowed_action_types;
  if (Array.isArray(override)) return override.map(String);
  return [];
}

async function ensureScenarioRow(c: pg.PoolClient, scenario: Scenario): Promise<void> {
  await c.query(
    `INSERT INTO scenarios (scenario_id, name, start_date, scenario_json)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (scenario_id)
     DO UPDATE SET name = EXCLUDED.name, start_date = EXCLUDED.start_date, scenario_json = EXCLUDED.scenario_json`,
    [scenario.scenario_id, scenario.name, scenario.start_date, scenario]
  );
}

async function ensureTasksForGame(
  c: pg.PoolClient,
  scenario: Scenario,
  game: GameRow,
  options: { stableTaskIds: boolean }
): Promise<void> {
  const taskRows = (await c.query(
    "SELECT task_id FROM tasks WHERE game_id = $1 LIMIT 1",
    [game.game_id]
  )).rows as Array<{ task_id: string }>;

  if (taskRows.length > 0) return;

  for (const [index, task] of scenario.initial_tasks.entries()) {
    const taskId = options.stableTaskIds ? buildGameTaskId(game.game_id, index) : randomUUID();
    const context = buildTaskContext(task, taskId, scenario.player_nation_id);
    await c.query(
      `INSERT INTO tasks (task_id, game_id, nation_id, owner_character_id, task_type, urgency, state, context, created_turn)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        taskId,
        game.game_id,
        scenario.player_nation_id,
        task.owner_character_id ?? null,
        task.task_type,
        task.urgency ?? "medium",
        "open",
        context,
        0
      ]
    );
  }
}

async function ensureWorldSnapshot(
  c: pg.PoolClient,
  scenario: Scenario,
  game: GameRow
): Promise<WorldState> {
  const worldRows = (await c.query(
    "SELECT world_state FROM world_snapshots WHERE game_id = $1 AND turn_index = $2",
    [game.game_id, game.current_turn]
  )).rows as Array<{ world_state: WorldState }>;

  let worldState = worldRows[0]?.world_state;
  if (!worldState) {
    worldState = buildWorldState(scenario, game.seed, game.current_turn);
    await c.query(
      `INSERT INTO world_snapshots (game_id, turn_index, world_state)
       VALUES ($1, $2, $3)`,
      [game.game_id, game.current_turn, worldState]
    );
    return worldState;
  }

  const hydrated = hydrateWorldState(scenario, worldState);
  worldState = hydrated.state;
  if (hydrated.changed) {
    await c.query(
      `UPDATE world_snapshots SET world_state = $1 WHERE game_id = $2 AND turn_index = $3`,
      [worldState, game.game_id, game.current_turn]
    );
  }
  return worldState;
}
