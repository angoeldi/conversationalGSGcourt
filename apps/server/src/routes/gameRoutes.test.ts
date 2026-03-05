import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const withClientMock = vi.fn();
const ensureGameMock = vi.fn();
const resolveAuthFromHeadersMock = vi.fn();
const fetchTaskWikiContextMock = vi.fn();
const generateTasksForTurnMock = vi.fn();

vi.mock("../db", () => ({
  withClient: withClientMock
}));

vi.mock("../lib/game", () => ({
  ensureGame: ensureGameMock
}));

vi.mock("../lib/auth", () => ({
  resolveAuthFromHeaders: resolveAuthFromHeadersMock,
  AuthError: class extends Error {
    status = 401;
  }
}));

vi.mock("../lib/taskGeneration", () => ({
  fetchTaskWikiContext: fetchTaskWikiContextMock,
  generateTasksForTurn: generateTasksForTurnMock
}));

const baseWorldState = {
  turn_index: 0,
  turn_seed: 123,
  player_nation_id: "11111111-1111-1111-1111-111111111111",
  nations: {
    "11111111-1111-1111-1111-111111111111": {
      nation_id: "11111111-1111-1111-1111-111111111111",
      gdp: 1_000_000,
      tax_rate: 0.3,
      tax_capacity: 0.6,
      compliance: 0.7,
      treasury: 50_000,
      debt: 1_000,
      stability: 70,
      legitimacy: 75,
      population: 100_000,
      literacy: 0.2,
      admin_capacity: 25,
      corruption: 0.2,
      manpower_pool: 5_000,
      force_size: 2_000,
      readiness: 0.4,
      supply: 0.5,
      war_exhaustion: 5,
      tech_level_mil: 20,
      laws: [],
      institutions: {},
      culture_mix: {},
      religion_mix: {}
    }
  },
  provinces: {
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": {
      geo_region_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      nation_id: "11111111-1111-1111-1111-111111111111",
      population: 10000,
      productivity: 1,
      infrastructure: 1,
      unrest: 3,
      compliance_local: 0.8,
      garrison: 200,
      resources: [],
      culture_mix: {},
      religion_mix: {}
    }
  },
  relations: [],
  operations: [],
  nation_trajectories: {},
  trajectory_modifiers: [],
  appointments: [],
  debt_instruments: []
};

type FakeDb = {
  unresolvedOpenTasks: number;
  actions: Array<{ action_id: string; type: string; params: Record<string, unknown>; status: string }>;
  actionEffects: Array<{ effect_type: string; delta: Record<string, unknown> }>;
};

function makeFakeClient(db: FakeDb) {
  let actionSeq = 0;
  return {
    async query(text: string) {
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
      if (text.includes("SELECT COUNT(*)::int AS count FROM tasks") && text.includes("state = 'open'")) {
        return { rows: [{ count: db.unresolvedOpenTasks }] };
      }
      if (text.includes("INSERT INTO actions")) {
        actionSeq += 1;
        db.actions.push({
          action_id: `action-${actionSeq}`,
          type: "apply_unresolved_tasks_penalty",
          params: {
            target_nation_id: "11111111-1111-1111-1111-111111111111",
            unresolved_task_count: db.unresolvedOpenTasks,
            stability_delta: -Math.min(6, db.unresolvedOpenTasks),
            legitimacy_delta: -Math.min(4, Math.ceil(db.unresolvedOpenTasks / 2)),
            reason: "unresolved_open_tasks"
          },
          status: "queued"
        });
        return { rows: [] };
      }
      if (text.includes("SELECT action_id, type, params FROM actions")) {
        return {
          rows: db.actions.filter((a) => a.status === "queued").map((a) => ({ action_id: a.action_id, type: a.type, params: a.params }))
        };
      }
      if (text.includes("UPDATE actions SET status = 'applied'")) {
        db.actions = db.actions.map((a) => ({ ...a, status: "applied" }));
        return { rows: [] };
      }
      if (text.includes("INSERT INTO action_effects")) {
        db.actionEffects.push({ effect_type: "governance.unresolved_tasks_penalty_applied", delta: {} });
        return { rows: [] };
      }
      if (text.includes("SELECT decision_id, task_id FROM decision_queue")) return { rows: [] };
      if (text.includes("INSERT INTO turns") || text.includes("INSERT INTO world_snapshots") || text.includes("UPDATE games SET current_turn")) {
        return { rows: [] };
      }
      if (text.includes("SELECT task_id, task_type, context, closed_turn")) return { rows: [] };
      throw new Error(`Unhandled SQL in test: ${text}`);
    }
  };
}

describe("POST /api/game/advance-week unresolved penalty", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://test";
    vi.resetAllMocks();
    resolveAuthFromHeadersMock.mockResolvedValue({ user: { user_id: "user-1" } });
    fetchTaskWikiContextMock.mockResolvedValue([]);
    generateTasksForTurnMock.mockReturnValue([]);
  });

  it("applies penalty when unresolved open tasks remain", async () => {
    const db: FakeDb = { unresolvedOpenTasks: 3, actions: [], actionEffects: [] };
    withClientMock.mockImplementation(async (cb: (client: ReturnType<typeof makeFakeClient>) => Promise<unknown>) => cb(makeFakeClient(db)));
    ensureGameMock.mockResolvedValue({
      game: { game_id: "game-1", seed: 42, current_turn: 0, scenario_id: "s-1" },
      scenario: { start_date: "1492-01-01", player_nation_id: "11111111-1111-1111-1111-111111111111" },
      world_state: structuredClone(baseWorldState)
    });

    const { gameRoutes } = await import("./gameRoutes");
    const app = Fastify();
    await gameRoutes(app);

    const res = await app.inject({
      method: "POST",
      url: "/api/game/advance-week",
      payload: { auto_decide_open: false }
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.unresolved_open_tasks_before).toBe(3);
    expect(payload.unresolved_open_tasks_penalized).toBe(3);
    expect(payload.unresolved_tasks_penalty).toMatchObject({
      penalty_applied: true,
      stability_delta: -3,
      legitimacy_delta: -2
    });
    expect(db.actionEffects.length).toBe(1);

    await app.close();
  });

  it("skips penalty when all tasks are queued/resolved", async () => {
    const db: FakeDb = { unresolvedOpenTasks: 0, actions: [], actionEffects: [] };
    withClientMock.mockImplementation(async (cb: (client: ReturnType<typeof makeFakeClient>) => Promise<unknown>) => cb(makeFakeClient(db)));
    ensureGameMock.mockResolvedValue({
      game: { game_id: "game-1", seed: 42, current_turn: 0, scenario_id: "s-1" },
      scenario: { start_date: "1492-01-01", player_nation_id: "11111111-1111-1111-1111-111111111111" },
      world_state: structuredClone(baseWorldState)
    });

    const { gameRoutes } = await import("./gameRoutes");
    const app = Fastify();
    await gameRoutes(app);

    const res = await app.inject({
      method: "POST",
      url: "/api/game/advance-week",
      payload: { auto_decide_open: false }
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.unresolved_tasks_penalty).toMatchObject({
      penalty_applied: false,
      stability_delta: 0,
      legitimacy_delta: 0
    });
    expect(db.actionEffects.length).toBe(0);

    await app.close();
  });
});
