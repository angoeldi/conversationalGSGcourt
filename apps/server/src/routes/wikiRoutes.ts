import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { wikiSearch, wikiSummary } from "../wiki/wikipedia";

export async function wikiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/wiki/search", async (req, reply) => {
    const q = z.string().min(1).parse((req.query as any).q);
    const limit = z.coerce.number().int().min(1).max(10).default(5).parse((req.query as any).limit ?? 5);
    const r = await wikiSearch(q, limit);
    return reply.send({ results: r });
  });

  app.get("/api/wiki/summary", async (req, reply) => {
    const title = z.string().min(1).parse((req.query as any).title);
    const s = await wikiSummary(title);
    return reply.send(s);
  });
}
