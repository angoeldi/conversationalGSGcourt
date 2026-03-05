import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Action, DecisionParseOutput } from "@thecourt/shared";
import { ActionTypes } from "@thecourt/shared";
import { TaskContext as TaskContextSchema } from "@thecourt/shared";
import { applySingleAction, tickWeek } from "@thecourt/engine";
import { withClient } from "../db";
import { ensureGame } from "../lib/game";
import { AuthError, resolveAuthFromHeaders } from "../lib/auth";
import { parseDecision } from "../lib/decision";
import { getLlmProviderWithOverride } from "../providers";
import { env } from "../config";
import { readLlmRequestHeaders } from "../lib/llmRequest";
import { buildAutoDecision } from "../lib/autoDecision";
import { deriveTaskGenerationTuning, fetchTaskWikiContext, generateTasksForTurn, type StorySeed } from "../lib/taskGeneration";
import { buildNationDirectory } from "../lib/nationDirectory";
import { coerceDecisionToScenario } from "../lib/actionHarness";
import { readGameOptionHeaders } from "../lib/gameOptions";
import { buildStorySeeds } from "./storySeeds";

const TranscriptMessage = z.object({
  role: z.enum(["player", "courtier", "system"]),
  content: z.string().min(1),
  speaker_character_id: z.string().optional()
});

export async function gameRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/game/state", async (req, reply) => {
    const query = z
      .object({ game_id: z.string().uuid().optional() })
      .parse(req.query ?? {});
    try {
      const result = await withClient(async (c) => {
        const auth = await resolveAuthFromHeaders(c, req.headers as Record<string, unknown>, { required: true });
        const { scenario, game, world_state } = await ensureGame(c, { gameId: query.game_id, userId: auth?.user.user_id });
        const tasks = (await c.query(
          `SELECT task_id, task_type, owner_character_id, urgency, state, context, created_turn, closed_turn
           FROM tasks
           WHERE game_id = $1
           ORDER BY created_turn, created_at`,
          [game.game_id]
        )).rows as Array<{
          task_id: string;
          task_type: string;
          owner_character_id: string | null;
          urgency: string;
          state: string;
          context: unknown;
          created_turn: number;
          closed_turn: number | null;
        }>;

        const nation_directory = buildNationDirectory(scenario);
        return {
          scenario,
          world_state,
          tasks,
          current_turn: game.current_turn,
          nation_directory,
          game_id: game.game_id,
          scenario_id: game.scenario_id
        };
      });

      return reply.send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.status).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  app.get("/api/game/action-log", async (req, reply) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        game_id: z.string().uuid().optional()
      })
      .parse(req.query ?? {});

    try {
      const result = await withClient(async (c) => {
        const auth = await resolveAuthFromHeaders(c, req.headers as Record<string, unknown>, { required: true });
        const { game } = await ensureGame(c, { gameId: query.game_id, userId: auth?.user.user_id });
        const rows = (await c.query(
          `SELECT ae.effect_id, ae.effect_type, ae.delta, ae.audit, ae.created_at,
                  a.action_id, a.type AS action_type, t.turn_index, t.date AS turn_date
           FROM action_effects ae
           JOIN actions a ON ae.action_id = a.action_id
           LEFT JOIN turns t ON a.turn_id = t.turn_id
           WHERE a.game_id = $1
           ORDER BY t.turn_index DESC NULLS LAST, ae.created_at DESC
           LIMIT $2 OFFSET $3`,
          [game.game_id, query.limit, query.offset]
        )).rows as Array<{
          effect_id: string;
          effect_type: string;
          delta: Record<string, unknown>;
          audit: Record<string, unknown>;
          created_at: string;
          action_id: string;
          action_type: string;
          turn_index: number | null;
          turn_date: string | null;
        }>;

        const entries = rows.map((row) => ({
          effect_id: row.effect_id,
          effect_type: row.effect_type,
          delta: row.delta,
          audit: row.audit,
          created_at: row.created_at,
          action_id: row.action_id,
          action_type: row.action_type,
          turn_index: row.turn_index,
          turn_date: row.turn_date
        }));

        return { entries };
      });

      return reply.send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.status).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  app.post("/api/game/decisions/queue", async (req, reply) => {
    const body = z
      .object({
        task_context: TaskContextSchema,
        player_text: z.string().min(1),
        stage: z.enum(["discussion", "no_objection", "final"]),
        transcript: z.array(TranscriptMessage).min(1),
        game_id: z.string().uuid().optional()
      })
      .parse(req.body);

    const options = readGameOptionHeaders(req.headers as Record<string, unknown>);
    if (body.stage === "discussion") {
      return reply.status(400).send({ error: "Discussion messages cannot be queued as decisions." });
    }

    let decision: DecisionParseOutput;
    let requestLlm;
    try {
      requestLlm = readLlmRequestHeaders(req.headers as Record<string, unknown>, env.LLM_PROVIDER);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }

    let provider;
    try {
      provider = getLlmProviderWithOverride(requestLlm.provider, {
        apiKey: requestLlm.apiKey,
        baseUrl: requestLlm.baseUrl
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }

    const model = resolveGameModel(requestLlm.provider, requestLlm.model);
    const allowed = body.task_context.constraints.allowed_action_types ?? [];
    if (options.strictActionsOnly) {
      body.task_context.constraints.allowed_action_types = allowed.length > 0
        ? allowed.filter((type) => type !== "freeform_effect")
        : ActionTypes.filter((type) => type !== "freeform_effect");
    }
    try {
      decision = await parseDecision(body.task_context, body.player_text, { provider, model });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.status).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }

    if (decision.task_id !== body.task_context.task_id) {
      decision = { ...decision, task_id: body.task_context.task_id };
    }

    try {
      await withClient(async (c) => {
        await c.query("BEGIN");
        try {
          const auth = await resolveAuthFromHeaders(c, req.headers as Record<string, unknown>, { required: true });
          const { game, scenario } = await ensureGame(c, { gameId: body.game_id, userId: auth?.user.user_id });
          decision = coerceDecisionToScenario(decision, scenario, body.task_context, {
            limitFreeformDeltas: options.limitFreeformDeltas,
            strictActionsOnly: options.strictActionsOnly
          });
          const bundle = decision.proposed_bundles[0];
          const taskId = body.task_context.task_id;

          const taskRows = (await c.query(
            "SELECT task_id FROM tasks WHERE task_id = $1 AND game_id = $2",
            [taskId, game.game_id]
          )).rows as Array<{ task_id: string }>;
          if (taskRows.length === 0) {
            throw new Error("Task not found for decision queue.");
          }

          await c.query(
            "UPDATE decision_queue SET status = 'superseded' WHERE game_id = $1 AND task_id = $2 AND status = 'queued'",
            [game.game_id, taskId]
          );
          await c.query(
            "DELETE FROM actions WHERE game_id = $1 AND source_task_id = $2 AND status = 'queued'",
            [game.game_id, taskId]
          );

          await c.query("DELETE FROM chat_messages WHERE task_id = $1", [taskId]);

          for (const message of body.transcript) {
            await c.query(
              `INSERT INTO chat_messages (message_id, task_id, sender_type, sender_character_id, content, meta)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                randomUUID(),
                taskId,
                message.role,
                message.speaker_character_id ?? null,
                message.content,
                {}
              ]
            );
          }

          const decisionId = randomUUID();
          await c.query(
            `INSERT INTO decision_queue (decision_id, game_id, task_id, stage, player_text, decision_json, selected_bundle_index, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              decisionId,
              game.game_id,
              taskId,
              body.stage,
              body.player_text,
              decision,
              0,
              "queued"
            ]
          );

          for (const action of bundle.actions) {
            const a = action as Action;
            await c.query(
              `INSERT INTO actions (action_id, game_id, nation_id, type, params, source_task_id, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                randomUUID(),
                game.game_id,
                body.task_context.nation_id,
                a.type,
                a.params,
                taskId,
                "queued"
              ]
            );
          }

          await c.query("UPDATE tasks SET state = 'queued' WHERE task_id = $1", [taskId]);

          await c.query("COMMIT");
        } catch (err) {
          await c.query("ROLLBACK");
          throw err;
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }

    return reply.send({ decision, queued_actions: decision.proposed_bundles[0]?.actions.length ?? 0 });
  });

  app.post("/api/game/advance-week", async (req, reply) => {
    const body = z
      .object({
        auto_decide_open: z.boolean().optional().default(false),
        game_id: z.string().uuid().optional()
      })
      .parse(req.body ?? {});
    try {
      const preload = await withClient(async (c) => {
        const auth = await resolveAuthFromHeaders(c, req.headers as Record<string, unknown>, { required: true });
        return ensureGame(c, { gameId: body.game_id, userId: auth?.user.user_id });
      });
      const wikiContext = await fetchTaskWikiContext(preload.scenario, preload.world_state.turn_index + 1);

      const result = await withClient(async (c) => {
        const auth = await resolveAuthFromHeaders(c, req.headers as Record<string, unknown>, { required: true });
        await c.query("BEGIN");
        try {
          const { game, scenario, world_state } = await ensureGame(c, { gameId: body.game_id, userId: auth?.user.user_id });
          const options = readGameOptionHeaders(req.headers as Record<string, unknown>);
          const inflowCount = options.petitionInflow === "low" ? 2 : options.petitionInflow === "high" ? 5 : 3;
          const maxOpenTasks = Math.max(2, options.petitionCap ?? 10);
          let working = structuredClone(world_state);
          let autoDecidedTasks = 0;

          const openTaskCountBeforeRow = (await c.query(
            "SELECT COUNT(*)::int AS count FROM tasks WHERE game_id = $1 AND state = 'open'",
            [game.game_id]
          )).rows as Array<{ count: number }>;
          const unresolvedOpenTasksBefore = openTaskCountBeforeRow[0]?.count ?? 0;

          const ctx = {
            turn_index: working.turn_index,
            turn_seed: working.turn_seed,
            now: computeTurnDate(scenario.start_date, working.turn_index)
          };
          if (body.auto_decide_open) {
            const openTasks = (await c.query(
              "SELECT task_id, nation_id, context FROM tasks WHERE game_id = $1 AND state = 'open'",
              [game.game_id]
            )).rows as Array<{ task_id: string; nation_id: string; context: unknown }>;

            for (const task of openTasks) {
              const taskContext = TaskContextSchema.parse(task.context);
              const { decision, chosen_actions } = buildAutoDecision(taskContext, scenario, game.seed, working.turn_index);
              const decisionId = randomUUID();

              await c.query(
                `INSERT INTO decision_queue (decision_id, game_id, task_id, stage, player_text, decision_json, selected_bundle_index, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                  decisionId,
                  game.game_id,
                  task.task_id,
                  "final",
                  "Auto-resolved at end of week.",
                  decision,
                  0,
                  "queued"
                ]
              );

              for (const action of chosen_actions) {
                const a = action as Action;
                await c.query(
                  `INSERT INTO actions (action_id, game_id, nation_id, type, params, source_task_id, status)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  [
                    randomUUID(),
                    game.game_id,
                    taskContext.nation_id,
                    a.type,
                    a.params,
                    task.task_id,
                    "queued"
                  ]
                );
              }

              await c.query("UPDATE tasks SET state = 'queued' WHERE task_id = $1", [task.task_id]);
              autoDecidedTasks += 1;
            }
          }

          const unresolvedAfterAutoRow = (await c.query(
            "SELECT COUNT(*)::int AS count FROM tasks WHERE game_id = $1 AND state = 'open'",
            [game.game_id]
          )).rows as Array<{ count: number }>;
          const unresolvedOpenTasksForPenalty = unresolvedAfterAutoRow[0]?.count ?? 0;
          const unresolvedTasksPenalty = computeUnresolvedTaskPenalty(unresolvedOpenTasksForPenalty);
          const penaltyNationId = working.player_nation_id ?? scenario.player_nation_id;

          if (unresolvedTasksPenalty.penalty_applied) {
            const penaltyAction: Action = {
              type: "apply_unresolved_tasks_penalty",
              params: {
                target_nation_id: penaltyNationId,
                unresolved_task_count: unresolvedOpenTasksForPenalty,
                stability_delta: unresolvedTasksPenalty.stability_delta,
                legitimacy_delta: unresolvedTasksPenalty.legitimacy_delta,
                reason: "unresolved_open_tasks"
              }
            };
            await c.query(
              `INSERT INTO actions (action_id, game_id, nation_id, type, params, source_task_id, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                randomUUID(),
                game.game_id,
                penaltyNationId,
                penaltyAction.type,
                penaltyAction.params,
                null,
                "queued"
              ]
            );
          }

          const queuedActions = (await c.query(
            "SELECT action_id, type, params FROM actions WHERE game_id = $1 AND status = 'queued' ORDER BY created_at",
            [game.game_id]
          )).rows as Array<{ action_id: string; type: string; params: Record<string, unknown> }>;

          const effectRows: Array<{ action_id: string; effect_type: string; delta: Record<string, unknown>; audit: Record<string, unknown> }> = [];
          for (const row of queuedActions) {
            const action: Action = { type: row.type, params: row.params } as Action;
            const res = applySingleAction(working, action, ctx);
            working = res.next_state;
            for (const effect of res.effects) {
              effectRows.push({
                action_id: row.action_id,
                effect_type: effect.effect_type,
                delta: effect.delta,
                audit: effect.audit
              });
            }
          }

          const ticked = tickWeek(working, ctx);
          const nextState = ticked.next_state;
          const newTurnId = randomUUID();
          const newTurnIndex = nextState.turn_index;

          const date = computeTurnDate(scenario.start_date, newTurnIndex);

          await c.query(
            `INSERT INTO turns (turn_id, game_id, turn_index, turn_seed, date, chronicle_text, deltas)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [newTurnId, game.game_id, newTurnIndex, nextState.turn_seed, date, "", {}]
          );

          await c.query(
            `INSERT INTO world_snapshots (game_id, turn_index, world_state)
             VALUES ($1, $2, $3)`,
            [game.game_id, newTurnIndex, nextState]
          );

          if (queuedActions.length > 0) {
            const actionIds = queuedActions.map((row) => row.action_id);
            await c.query(
              "UPDATE actions SET status = 'applied', turn_id = $1 WHERE action_id = ANY($2)",
              [newTurnId, actionIds]
            );
          }

          for (const effect of effectRows) {
            await c.query(
              `INSERT INTO action_effects (effect_id, action_id, effect_type, delta, audit)
               VALUES ($1, $2, $3, $4, $5)`,
              [randomUUID(), effect.action_id, effect.effect_type, effect.delta, effect.audit]
            );
          }

          const queuedDecisions = (await c.query(
            "SELECT decision_id, task_id FROM decision_queue WHERE game_id = $1 AND status = 'queued'",
            [game.game_id]
          )).rows as Array<{ decision_id: string; task_id: string }>;

          if (queuedDecisions.length > 0) {
            const decisionIds = queuedDecisions.map((row) => row.decision_id);
            const taskIds = queuedDecisions.map((row) => row.task_id);
            await c.query(
              "UPDATE decision_queue SET status = 'processed', processed_turn = $1 WHERE decision_id = ANY($2)",
              [newTurnIndex, decisionIds]
            );
            await c.query(
              "UPDATE tasks SET state = 'resolved', closed_turn = $1 WHERE task_id = ANY($2)",
              [newTurnIndex, taskIds]
            );
          }

          const openCountRow = (await c.query(
            "SELECT COUNT(*)::int AS count FROM tasks WHERE game_id = $1 AND state = 'open'",
            [game.game_id]
          )).rows as Array<{ count: number }>;
          const openCount = openCountRow[0]?.count ?? 0;
          const capacity = Math.max(0, maxOpenTasks - openCount);
          const toCreate = Math.max(0, Math.min(inflowCount, capacity));
          const openTaskPressure = maxOpenTasks > 0 ? Math.min(1, openCount / maxOpenTasks) : 0;
          const recentTypeRows = (await c.query(
            `SELECT task_type, COUNT(*)::int AS count
             FROM tasks
             WHERE game_id = $1 AND created_turn >= $2
             GROUP BY task_type`,
            [game.game_id, Math.max(0, newTurnIndex - 4)]
          )).rows as Array<{ task_type: string; count: number }>;
          const recentTaskTypeCounts = recentTypeRows.reduce<Record<string, number>>((acc, row) => {
            acc[row.task_type] = row.count;
            return acc;
          }, {});
          const tuning = deriveTaskGenerationTuning({
            turnIndex: newTurnIndex,
            openTaskPressure,
            recentTaskTypeCounts: recentTaskTypeCounts as Parameters<typeof deriveTaskGenerationTuning>[0]["recentTaskTypeCounts"],
            worldState: nextState,
            playerNationId: scenario.player_nation_id,
            knobs: options.taskGeneration
          });
          const storySeeds = await buildStorySeeds(c, game.game_id, newTurnIndex);
          const generated = generateTasksForTurn(
            scenario,
            newTurnIndex,
            game.seed,
            toCreate,
            wikiContext,
            storySeeds,
            nextState,
            tuning.storyChance,
            tuning.options
          );
          for (const task of generated) {
            await c.query(
              `INSERT INTO tasks (task_id, game_id, nation_id, owner_character_id, task_type, urgency, state, context, created_turn)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                task.task_id,
                game.game_id,
                scenario.player_nation_id,
                task.owner_character_id,
                task.task_type,
                task.urgency,
                "open",
                task.context,
                task.created_turn
              ]
            );
          }

          await c.query("UPDATE games SET current_turn = $1 WHERE game_id = $2", [newTurnIndex, game.game_id]);

          await c.query("COMMIT");

          const rejectedActions = effectRows
            .filter((effect) => effect.effect_type === "action.rejected")
            .map((effect) => ({
              action_id: effect.action_id,
              type: String(effect.delta?.type ?? "unknown"),
              reason: String(effect.delta?.reason ?? "unknown"),
              target_nation_id: effect.delta?.target_nation_id ? String(effect.delta.target_nation_id) : undefined
            }));

          return {
            turn_index: newTurnIndex,
            processed_actions: queuedActions.length,
            processed_decisions: queuedDecisions.length,
            auto_decided_tasks: autoDecidedTasks,
            unresolved_open_tasks_before: unresolvedOpenTasksBefore,
            unresolved_open_tasks_penalized: unresolvedOpenTasksForPenalty,
            unresolved_tasks_penalty: unresolvedTasksPenalty,
            rejected_actions: rejectedActions
          };
        } catch (err) {
          await c.query("ROLLBACK");
          throw err;
        }
      });

      return reply.send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.status).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });
}

function computeUnresolvedTaskPenalty(unresolvedOpenTasks: number): {
  penalty_applied: boolean;
  stability_delta: number;
  legitimacy_delta: number;
} {
  if (unresolvedOpenTasks <= 0) {
    return {
      penalty_applied: false,
      stability_delta: 0,
      legitimacy_delta: 0
    };
  }

  const stabilityDelta = -Math.min(6, unresolvedOpenTasks);
  const legitimacyDelta = -Math.min(4, Math.ceil(unresolvedOpenTasks / 2));
  return {
    penalty_applied: true,
    stability_delta: stabilityDelta,
    legitimacy_delta: legitimacyDelta
  };
}

function computeTurnDate(startDate: string, turnIndex: number): string {
  const base = new Date(startDate);
  if (Number.isNaN(base.getTime())) return startDate;
  const ms = base.getTime() + turnIndex * 7 * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function resolveGameModel(provider: "openai" | "openrouter" | "groq", override?: string): string {
  if (override?.trim()) return override.trim();
  if (provider === "openrouter") return env.OPENROUTER_MODEL?.trim() || env.LLM_MODEL;
  if (provider === "groq") return env.GROQ_MODEL;
  return env.LLM_MODEL;
}
