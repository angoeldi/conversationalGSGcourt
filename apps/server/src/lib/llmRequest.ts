import { z } from "zod";
import type { ProviderName } from "../providers";

const ProviderSchema = z.enum(["openai", "openrouter", "groq"]);

export type LlmRequestOverrides = {
  provider: ProviderName;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export function readLlmRequestHeaders(
  headers: Record<string, unknown>,
  defaultProvider: ProviderName
): LlmRequestOverrides {
  const providerHeader = readHeader(headers, "x-llm-provider");
  let provider = defaultProvider;
  if (providerHeader) {
    const parsed = ProviderSchema.safeParse(providerHeader);
    if (!parsed.success) throw new Error(`Unsupported LLM provider: ${providerHeader}`);
    provider = parsed.data;
  }

  const apiKey = readHeader(headers, "x-llm-api-key");
  const baseUrl = readHeader(headers, "x-llm-base-url");
  const model = readHeader(headers, "x-llm-model");
  return { provider, apiKey, baseUrl, model };
}

function readHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value.trim() || undefined;
  return undefined;
}
