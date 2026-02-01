import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(repoRoot, ".env"), override: true });
dotenv.config({ override: true });

const hfUrl = process.env.HF_INFERENCE_URL?.trim();
if (hfUrl && /api-inference\.huggingface\.co/i.test(hfUrl)) {
  const rewritten = hfUrl.replace(
    /^https?:\/\/api-inference\.huggingface\.co/i,
    "https://router.huggingface.co/hf-inference"
  );
  if (rewritten !== hfUrl) {
    process.env.HF_INFERENCE_URL = rewritten;
    // eslint-disable-next-line no-console
    console.warn(`[config] HF_INFERENCE_URL updated to ${rewritten}`);
  }
}

const ExperimentalFeatureFlag = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const Env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    DATABASE_URL: z.string().min(1),

    LLM_PROVIDER: z.enum(["openai", "openrouter", "groq"]).default("openai"),
    LLM_MODEL: z.string().default("gpt-5-nano"),

    LLM_BUILDER_PROVIDER: z.enum(["openai", "openrouter", "groq"]).default("openai"),
    LLM_BUILDER_MODEL: z.string().default("gpt-5.2"),

    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().optional(),

    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
    OPENROUTER_MODEL: z.string().optional(),

    GROQ_API_KEY: z.string().optional(),
    GROQ_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
    GROQ_MODEL: z.string().default("openai/gpt-oss-20b"),

    HF_API_KEY: z.string().optional(),
    HF_INFERENCE_URL: z.string().optional(),

    SCENARIO_BUILDER_ENABLED: ExperimentalFeatureFlag.default(false)
  })
  .passthrough();

export type Env = z.infer<typeof Env>;

export const env: Env = Env.parse(process.env);
