import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken, issueAuthToken } from "../lib/auth";
import { pool } from "../db";

vi.mock("../providers", () => ({
  getLlmProviderWithOverride: vi.fn(() => ({ provider: "mock" }))
}));

vi.mock("../lib/decision", () => ({
  parseDecision: vi.fn(async (taskContext: { task_id: string; nation_id: string }) => ({
    task_id: taskContext.task_id,
    intent_summary: "Fixture decision",
    proposed_bundles: [
      {
        label: "Primary",
        actions: [
          { type: "adjust_tax_rate", params: { new_tax_rate: 0.41, rationale: "Raise wartime revenue" } },
          {
            type: "send_envoy",
            params: {
              target_nation_id: "99999999-9999-4999-8999-999999999999",
              message_tone: "firm",
              topic: "Demand concession"
            }
          }
        ]
      },
      {
        label: "Alternative",
        actions: [{ type: "adjust_tax_rate", params: { new_tax_rate: 0.39, rationale: "Softer raise" } }]
      }
    ]
  }))
}));

vi.mock("../lib/taskGeneration", () => ({
  fetchTaskWikiContext: vi.fn(async () => []),
  generateTasksForTurn: vi.fn((scenario: { player_nation_id: string }, turnIndex: number, _seed: number, count: number) => {
    return Array.from({ length: count }, (_, idx) => {
      const ordinal = String(turnIndex * 100 + idx + 1).padStart(12, "0");
      const taskId = `00000000-0000-4000-8000-${ordinal}`;
      return {
        task_id: taskId,
        owner_character_id: null,
        task_type: "petition",
        urgency: "medium",
        created_turn: turnIndex,
        context: {
          task_id: taskId,
          task_type: "petition",
          owner_character_id: null,
          nation_id: scenario.player_nation_id,
          created_turn: turnIndex,
          urgency: "medium",
          prompt: `Generated petition ${idx + 1}`,
          sources: [],
          perceived_facts: [],
          entities: [],
          constraints: { allowed_action_types: [], forbidden_action_types: [], notes: [] },
          chat_summary: "",
          last_messages: []
        }
      };
    });
  })
}));

import { gameRoutes } from "./gameRoutes";

type AuthFixture = { token: string };

const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });

let app: FastifyInstance;
let auth: AuthFixture;

beforeAll(async () => {
  await runMigrations();
  app = Fastify();
  await gameRoutes(app);
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  auth = await createAuthFixture();
});

describe("gameRoutes", () => {
  it("supersedes prior queued decisions and actions for /api/game/decisions/queue", async () => {
    const state = await getGameState(auth.token);
    const taskContext = state.tasks[0].context;

    const first = await app.inject({
      method: "POST",
      url: "/api/game/decisions/queue",
      headers: authHeader(auth.token),
      payload: {
        game_id: state.game_id,
        task_context: taskContext,
        player_text: "First decision",
        stage: "final",
        transcript: [{ role: "player", content: "First order" }]
      }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().queued_actions).toBe(2);

    const second = await app.inject({
      method: "POST",
      url: "/api/game/decisions/queue",
      headers: authHeader(auth.token),
      payload: {
        game_id: state.game_id,
        task_context: taskContext,
        player_text: "Second decision",
        stage: "final",
        transcript: [{ role: "player", content: "Second order" }]
      }
    });
    expect(second.statusCode).toBe(200);

    const decisionRows = (await pool.query(
      `SELECT status FROM decision_queue WHERE game_id = $1 AND task_id = $2 ORDER BY queued_at`,
      [state.game_id, taskContext.task_id]
    )).rows as Array<{ status: string }>;
    expect(decisionRows.map((row) => row.status)).toEqual(["superseded", "queued"]);

    const actionRows = (await pool.query(
      `SELECT status FROM actions WHERE game_id = $1 AND source_task_id = $2 ORDER BY created_at`,
      [state.game_id, taskContext.task_id]
    )).rows as Array<{ status: string }>;
    expect(actionRows).toHaveLength(2);
    expect(actionRows.every((row) => row.status === "queued")).toBe(true);

    const taskRow = (await pool.query("SELECT state FROM tasks WHERE task_id = $1", [taskContext.task_id])).rows[0] as { state: string };
    expect(taskRow.state).toBe("queued");
  });

  it("processes queued actions, resolves tasks, stores world snapshot, and reports rejected_actions", async () => {
    const state = await getGameState(auth.token);
    const taskId = state.tasks[0].task_id;

    await pool.query(
      `INSERT INTO decision_queue (decision_id, game_id, task_id, stage, player_text, decision_json, selected_bundle_index, status)
       VALUES ($1, $2, $3, 'final', 'fixture', $4, 0, 'queued')`,
      [randomUUID(), state.game_id, taskId, { task_id: taskId, intent_summary: "fixture", proposed_bundles: [] }]
    );

    await pool.query(
      `INSERT INTO actions (action_id, game_id, nation_id, type, params, source_task_id, status)
       VALUES
       ($1, $2, $3, 'adjust_tax_rate', $4, $5, 'queued'),
       ($6, $2, $3, 'send_envoy', $7, $5, 'queued')`,
      [
        randomUUID(),
        state.game_id,
        state.scenario.player_nation_id,
        { new_tax_rate: 0.42, rationale: "test" },
        taskId,
        randomUUID(),
        {
          target_nation_id: "99999999-9999-4999-8999-999999999999",
          message_tone: "firm",
          topic: "Invalid target"
        }
      ]
    );
    await pool.query("UPDATE tasks SET state = 'queued' WHERE task_id = $1", [taskId]);

    const res = await app.inject({
      method: "POST",
      url: "/api/game/advance-week",
      headers: authHeader(auth.token),
      payload: { game_id: state.game_id }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.processed_actions).toBe(2);
    expect(body.processed_decisions).toBe(1);
    expect(body.rejected_actions).toEqual([
      {
        action_id: expect.any(String),
        type: "send_envoy",
        reason: "nation_not_found",
        target_nation_id: "99999999-9999-4999-8999-999999999999"
      }
    ]);

    const appliedActions = (await pool.query(
      "SELECT status, turn_id FROM actions WHERE game_id = $1 ORDER BY created_at",
      [state.game_id]
    )).rows as Array<{ status: string; turn_id: string | null }>;
    expect(appliedActions.every((row) => row.status === "applied" && row.turn_id)).toBe(true);

    const decision = (await pool.query(
      "SELECT status, processed_turn FROM decision_queue WHERE game_id = $1 AND task_id = $2",
      [state.game_id, taskId]
    )).rows[0] as { status: string; processed_turn: number };
    expect(decision.status).toBe("processed");
    expect(decision.processed_turn).toBe(body.turn_index);

    const task = (await pool.query("SELECT state, closed_turn FROM tasks WHERE task_id = $1", [taskId])).rows[0] as { state: string; closed_turn: number };
    expect(task.state).toBe("resolved");
    expect(task.closed_turn).toBe(body.turn_index);

    const snapshot = (await pool.query(
      "SELECT 1 FROM world_snapshots WHERE game_id = $1 AND turn_index = $2",
      [state.game_id, body.turn_index]
    )).rows.length;
    expect(snapshot).toBe(1);
  });

  it("applies petition inflow with cap handling", async () => {
    const state = await getGameState(auth.token);
    const [keptOpen, ...others] = state.tasks.map((task) => task.task_id);
    if (others.length > 0) {
      await pool.query("UPDATE tasks SET state = 'resolved', closed_turn = 0 WHERE task_id = ANY($1)", [others]);
    }
    await pool.query("UPDATE tasks SET state = 'open', closed_turn = NULL WHERE task_id = $1", [keptOpen]);

    const res = await app.inject({
      method: "POST",
      url: "/api/game/advance-week",
      headers: {
        ...authHeader(auth.token),
        "x-petition-inflow": "high",
        "x-petition-cap": "2"
      },
      payload: { game_id: state.game_id }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const newOpenTasks = (await pool.query(
      "SELECT task_id FROM tasks WHERE game_id = $1 AND state = 'open' AND created_turn = $2",
      [state.game_id, body.turn_index]
    )).rows.length;
    expect(newOpenTasks).toBe(1);

    const totalOpen = (await pool.query(
      "SELECT COUNT(*)::int AS count FROM tasks WHERE game_id = $1 AND state = 'open'",
      [state.game_id]
    )).rows[0] as { count: number };
    expect(totalOpen.count).toBeLessThanOrEqual(2);
  });

  it("auto_decide_open queues and resolves open tasks when advancing week", async () => {
    const state = await getGameState(auth.token);

    const res = await app.inject({
      method: "POST",
      url: "/api/game/advance-week",
      headers: authHeader(auth.token),
      payload: { game_id: state.game_id, auto_decide_open: true }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.auto_decided_tasks).toBeGreaterThan(0);

    const processedAuto = (await pool.query(
      "SELECT status, processed_turn FROM decision_queue WHERE game_id = $1",
      [state.game_id]
    )).rows as Array<{ status: string; processed_turn: number | null }>;
    expect(processedAuto.length).toBeGreaterThan(0);
    expect(processedAuto.every((row) => row.status === "processed" && row.processed_turn === body.turn_index)).toBe(true);

    const resolvedTasks = (await pool.query(
      "SELECT COUNT(*)::int AS count FROM tasks WHERE game_id = $1 AND state = 'resolved' AND closed_turn = $2",
      [state.game_id, body.turn_index]
    )).rows[0] as { count: number };
    expect(resolvedTasks.count).toBeGreaterThanOrEqual(body.auto_decided_tasks);
  });
});

async function getGameState(token: string) {
  const res = await app.inject({ method: "GET", url: "/api/game/state", headers: authHeader(token) });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    game_id: string;
    scenario: { player_nation_id: string };
    tasks: Array<{ task_id: string; context: Record<string, unknown> }>;
  };
}

async function createAuthFixture(): Promise<AuthFixture> {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const token = issueAuthToken();
  await pool.query(
    `INSERT INTO users (user_id, email, display_name, password_hash, is_guest)
     VALUES ($1, $2, $3, $4, true)`,
    [userId, `tester-${userId}@example.com`, "Route Tester", "test"]
  );
  await pool.query(
    `INSERT INTO user_sessions (session_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '7 days')`,
    [sessionId, userId, hashToken(token)]
  );
  return { token };
}

async function runMigrations(): Promise<void> {
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  for (const file of ["0001_init.sql", "0002_decision_queue.sql", "0003_portraits.sql", "0004_auth.sql", "0005_guest_users.sql", "0006_feedback.sql"]) {
    const sql = await readFile(path.join(serverRoot, "sql", file), "utf8");
    await pool.query(sql);
  }
}

async function resetDatabase(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      action_effects,
      actions,
      chat_messages,
      decision_queue,
      turns,
      world_snapshots,
      tasks,
      games,
      scenarios,
      user_sessions,
      users,
      portraits,
      feedback_entries
    RESTART IDENTITY CASCADE
  `);
}
