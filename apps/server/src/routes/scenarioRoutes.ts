import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Scenario } from "@thecourt/shared";
import { withClient } from "../db";
import { createGameForScenario } from "../lib/game";
import { AuthError, resolveAuthFromHeaders } from "../lib/auth";
import { buildNationDirectory } from "../lib/nationDirectory";
import { loadScenario } from "../lib/scenario";
import { env } from "../config";

export async function scenarioRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/scenarios/default", async (req, reply) => {
    try {
      const scenario = await loadScenario();
      return reply.send(scenario);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  app.post("/api/scenarios", async (req, reply) => {
    if (!env.SCENARIO_BUILDER_ENABLED) {
      return reply.status(403).send({
        error: "Scenario creation is experimental and disabled on this server. Set SCENARIO_BUILDER_ENABLED=true to enable."
      });
    }
    const body = z
      .object({
        scenario: Scenario,
        seed: z.number().int().optional()
      })
      .parse(req.body);

    try {
      const result = await withClient(async (c) => {
        const auth = await resolveAuthFromHeaders(c, req.headers as Record<string, unknown>, { required: true });
        const { scenario, game, world_state } = await createGameForScenario(c, body.scenario, {
          seed: body.seed,
          userId: auth?.user.user_id
        });
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
}
