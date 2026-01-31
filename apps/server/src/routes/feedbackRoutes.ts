import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withClient } from "../db";
import { AuthError, resolveAuthFromHeaders } from "../lib/auth";

const FeedbackBody = z.object({
  message: z.string().min(1).max(4000),
  game_id: z.string().uuid().optional()
});

type GameMetaRow = {
  game_id: string;
  scenario_id: string;
  current_turn: number;
  user_id: string | null;
};

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/feedback", async (req, reply) => {
    const body = FeedbackBody.parse(req.body);
    try {
      const result = await withClient(async (c) => {
        const auth = await resolveAuthFromHeaders(c, req.headers as Record<string, unknown>, { required: true });
        if (!auth) throw new AuthError("Missing auth token.");
        const userId = auth.user.user_id;

        let game: GameMetaRow | undefined;
        if (body.game_id) {
          const rows = (await c.query(
            "SELECT game_id, scenario_id, current_turn, user_id FROM games WHERE game_id = $1",
            [body.game_id]
          )).rows as GameMetaRow[];
          game = rows[0];
          if (!game) throw new Error("Game not found.");
          if (game.user_id && game.user_id !== userId) throw new Error("Game not found.");
        } else {
          const rows = (await c.query(
            "SELECT game_id, scenario_id, current_turn, user_id FROM games WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
            [userId]
          )).rows as GameMetaRow[];
          game = rows[0];
          if (!game) throw new Error("Game not found.");
        }

        const feedbackId = randomUUID();
        await c.query(
          `INSERT INTO feedback_items (feedback_id, user_id, game_id, scenario_id, turn_index, message)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [feedbackId, userId, game.game_id, game.scenario_id, game.current_turn, body.message.trim()]
        );

        return { feedback_id: feedbackId };
      });

      return reply.send({ ok: true, feedback_id: result.feedback_id });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.status).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });
}
