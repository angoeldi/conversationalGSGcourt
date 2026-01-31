import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import OpenAI from "openai";
import { env } from "../config";
import { withClient } from "../db";
import { ensureGame } from "../lib/game";
import { AuthError, resolveAuthFromHeaders } from "../lib/auth";
import { formatPortraitPrompt } from "../lib/portraitPrompt";

export async function portraitRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/portraits/:characterId", async (req, reply) => {
    const params = z.object({ characterId: z.string().uuid() }).parse(req.params);
    const query = z
      .object({
        provider: z.enum(["openai", "hf"]).optional(),
        model: z.string().optional(),
        size: z.enum(["256x256", "512x512", "1024x1024"]).default("512x512"),
        refresh: z.coerce.boolean().optional().default(false),
        game_id: z.string().uuid().optional()
      })
      .parse(req.query ?? {});

    try {
      const result = await withClient(async (c) => {
        const overrides = readPortraitOverrides(req.headers as Record<string, unknown>);
        const auth = await resolveAuthFromHeaders(c, req.headers as Record<string, unknown>, { required: true });
        const { scenario } = await ensureGame(c, { gameId: query.game_id, userId: auth?.user.user_id });
        const scenarioId = scenario.scenario_id;
        const character = scenario.characters.find((entry) => entry.character_id === params.characterId);
        if (!character) {
          return { kind: "missing", reason: "character_not_found" } as const;
        }

        const provider = resolvePortraitProvider(query.provider, overrides.provider);
        const prompt = formatPortraitPrompt(buildPortraitPrompt(scenario, character), provider);
        const existingRows = (await c.query(
          `SELECT prompt, provider, model, size, mime, image_b64
           FROM portraits
           WHERE scenario_id = $1 AND character_id = $2`,
          [scenarioId, params.characterId]
        )).rows as Array<{ prompt: string; provider: string; model: string | null; size: string; mime: string; image_b64: string }>;

        const existing = existingRows[0];
        const promptChanged = Boolean(existing && existing.prompt !== prompt);
        const providerChanged = Boolean(existing && existing.provider !== provider);
        const sizeChanged = Boolean(existing && existing.size !== query.size);
        const modelChanged = Boolean(existing && query.model && existing.model !== query.model);
        const shouldGenerate = query.refresh
          || !existing
          || promptChanged
          || providerChanged
          || sizeChanged
          || modelChanged;

        if (existing && !shouldGenerate) {
          app.log.info(
            {
              characterId: params.characterId,
              scenarioId,
              provider: existing.provider,
              size: existing.size,
              model: existing.model ?? null
            },
            "Portrait cache hit"
          );
          return {
            kind: "ok",
            character_id: params.characterId,
            prompt: existing.prompt,
            provider: existing.provider,
            model: existing.model,
            size: existing.size,
            mime: existing.mime,
            b64: existing.image_b64,
            data_url: `data:${existing.mime};base64,${existing.image_b64}`
          } as const;
        }

        if (existing) {
          app.log.info(
            {
              characterId: params.characterId,
              scenarioId,
              provider,
              size: query.size,
              model: query.model ?? null,
              refresh: query.refresh,
              promptChanged,
              providerChanged,
              sizeChanged,
              modelChanged
            },
            "Portrait cache refresh"
          );
        } else {
          app.log.info(
            {
              characterId: params.characterId,
              scenarioId,
              provider,
              size: query.size,
              model: query.model ?? null
            },
            "Portrait cache miss"
          );
        }

        if (!canGeneratePortrait(provider, overrides)) {
          return { kind: "missing", reason: "portrait_generation_unavailable", provider } as const;
        }

        app.log.info(
          {
            characterId: params.characterId,
            scenarioId,
            provider,
            size: query.size,
            model: query.model ?? null
          },
          "Portrait generation start"
        );
        const portrait = await generatePortraitImage({
          prompt,
          provider,
          model: query.model,
          size: query.size,
          apiKey: overrides.apiKey,
          baseUrl: overrides.baseUrl
        });

        await c.query(
          `INSERT INTO portraits (portrait_id, scenario_id, character_id, prompt, provider, model, size, mime, image_b64)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (scenario_id, character_id)
           DO UPDATE SET prompt = EXCLUDED.prompt, provider = EXCLUDED.provider, model = EXCLUDED.model,
             size = EXCLUDED.size, mime = EXCLUDED.mime, image_b64 = EXCLUDED.image_b64, updated_at = now()`,
          [
            randomUUID(),
            scenarioId,
            params.characterId,
            prompt,
            provider,
            query.model ?? null,
            query.size,
            portrait.mime,
            portrait.b64
          ]
        );

        app.log.info(
          {
            characterId: params.characterId,
            scenarioId,
            provider,
            size: query.size,
            model: query.model ?? null
          },
          "Portrait generation stored"
        );
        return {
          kind: "ok",
          character_id: params.characterId,
          prompt,
          provider,
          model: query.model ?? null,
          size: query.size,
          mime: portrait.mime,
          b64: portrait.b64,
          data_url: portrait.data_url
        } as const;
      });

      if (!result || result.kind !== "ok") {
        const reason = result?.reason ?? "portrait_unavailable";
        app.log.warn(
          {
            characterId: params.characterId,
            reason,
            provider: result && "provider" in result ? result.provider : undefined,
            hasOpenAI: Boolean(env.OPENAI_API_KEY),
            hasHFKey: Boolean(env.HF_API_KEY),
            hasHFUrl: Boolean(env.HF_INFERENCE_URL)
          },
          "Portrait unavailable"
        );
        return reply.status(404).send({
          error: `Portrait not available (${reason}).`,
          code: reason,
          provider: result && "provider" in result ? result.provider : undefined
        });
      }
      return reply.send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.status).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ err }, "Portrait generation failed");
      return reply.status(500).send({ error: message });
    }
  });

  app.post("/api/portraits/generate", async (req, reply) => {
    const body = z
      .object({
        prompt: z.string().min(1),
        provider: z.enum(["openai", "hf"]).optional(),
        model: z.string().optional(),
        size: z.enum(["256x256", "512x512", "1024x1024"]).default("512x512")
      })
      .parse(req.body);

    const overrides = readPortraitOverrides(req.headers as Record<string, unknown>);
    const provider = resolvePortraitProvider(body.provider, overrides.provider);
    const portrait = await generatePortraitImage({
      prompt: formatPortraitPrompt(body.prompt, provider),
      provider,
      model: body.model,
      size: body.size,
      apiKey: overrides.apiKey,
      baseUrl: overrides.baseUrl
    });
    return reply.send(portrait);
  });
}

function buildPortraitPrompt(
  scenario: { start_date: string; player_nation_id: string; nations: Array<{ nation_id: string; name: string }>; appointments: Array<{ office_id: string; character_id: string }>; offices: Array<{ office_id: string; name: string; nation_id: string }> },
  character: { name: string; title?: string; portrait_prompt?: string; traits?: string[]; character_id: string }
): string {
  if (character.portrait_prompt) return character.portrait_prompt;
  const year = String(scenario.start_date ?? "").slice(0, 4);
  const nation = scenario.nations.find((entry) => entry.nation_id === scenario.player_nation_id);
  const appointment = scenario.appointments.find((entry) => entry.character_id === character.character_id);
  const office = appointment ? scenario.offices.find((entry) => entry.office_id === appointment.office_id) : null;
  const role = office?.name ? `${office.name} of ${nation?.name ?? "the realm"}` : `courtier of ${nation?.name ?? "the realm"}`;
  const title = character.title ? `${character.title} ` : "";
  const traitText = (character.traits ?? []).slice(0, 2).join(", ");
  const flavor = traitText ? `, ${traitText}` : "";
  return `Portrait of ${title}${character.name}, ${role}, ${year}. Historic oil painting, 15th-century, realistic, detailed face, ornate clothing${flavor}.`;
}

function canGeneratePortrait(provider: "openai" | "hf", overrides?: PortraitOverrides): boolean {
  if (provider === "openai") return Boolean(overrides?.apiKey ?? env.OPENAI_API_KEY);
  const apiKey = overrides?.apiKey ?? env.HF_API_KEY;
  const baseUrl = overrides?.baseUrl ?? env.HF_INFERENCE_URL;
  return Boolean(apiKey && baseUrl);
}

function resolvePortraitProvider(requested?: "openai" | "hf", override?: "openai" | "hf"): "openai" | "hf" {
  if (override) return override;
  if (requested) return requested;
  if (env.OPENAI_API_KEY) return "openai";
  if (env.HF_API_KEY && env.HF_INFERENCE_URL) return "hf";
  return "openai";
}


async function generatePortraitImage(input: {
  prompt: string;
  provider: "openai" | "hf";
  model?: string;
  size: "256x256" | "512x512" | "1024x1024";
  apiKey?: string;
  baseUrl?: string;
}): Promise<{ mime: string; b64: string; data_url: string }> {
  if (input.provider === "openai") {
    const apiKey = input.apiKey ?? env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for portrait generation");
    const baseURL = input.baseUrl ?? env.OPENAI_BASE_URL ?? undefined;
    const client = new OpenAI({ apiKey, baseURL });
    const model = input.model ?? "gpt-image-1.5";

    const img = await client.images.generate({ model, prompt: input.prompt, size: input.size, n: 1 });
    const b64 = (img.data?.[0] as any)?.b64_json as string | undefined;
    if (!b64) throw new Error("No image returned (expected b64_json)");
    return { mime: "image/png", b64, data_url: `data:image/png;base64,${b64}` };
  }

  const hfKey = input.apiKey ?? env.HF_API_KEY;
  const hfUrl = input.baseUrl ?? env.HF_INFERENCE_URL;
  if (!hfKey || !hfUrl) {
    throw new Error("HF_API_KEY and HF_INFERENCE_URL are required for provider=hf");
  }

  const res = await fetch(hfUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hfKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputs: input.prompt,
      options: { wait_for_model: true }
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Hugging Face error ${res.status}: ${t}`);
  }

  const ct = res.headers.get("content-type") ?? "application/octet-stream";
  if (!ct.startsWith("image/")) {
    const text = await res.text();
    throw new Error(`Hugging Face non-image response (${ct}): ${text.slice(0, 240)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const b64 = buf.toString("base64");
  return { mime: ct, b64, data_url: `data:${ct};base64,${b64}` };
}

type PortraitOverrides = {
  apiKey?: string;
  baseUrl?: string;
  provider?: "openai" | "hf";
};

function readPortraitOverrides(headers: Record<string, unknown>): PortraitOverrides {
  const apiKey = readHeader(headers, "x-portrait-api-key");
  const baseUrl = readHeader(headers, "x-portrait-base-url");
  const provider = readHeader(headers, "x-portrait-provider");
  const resolvedProvider = provider === "openai" || provider === "hf" ? provider : undefined;
  return {
    apiKey: apiKey?.trim() || undefined,
    baseUrl: baseUrl?.trim() || undefined,
    provider: resolvedProvider
  };
}

function readHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value.trim() || undefined;
  return undefined;
}
