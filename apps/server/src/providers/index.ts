import type { LLMProvider } from "./types";
import { env } from "../config";
import { OpenAIResponsesProvider } from "./openai";
import { OpenRouterChatProvider } from "./openrouter";
import { GroqResponsesProvider } from "./groq";

export type ProviderName = "openai" | "openrouter" | "groq";

export type ProviderOverride = {
  apiKey?: string;
  baseUrl?: string;
};

export function makeProvider(which: ProviderName, override?: ProviderOverride): LLMProvider {
  switch (which) {
    case "openai":
      return new OpenAIResponsesProvider({
        apiKey: override?.apiKey,
        baseURL: override?.baseUrl
      });
    case "openrouter":
      return new OpenRouterChatProvider({
        apiKey: override?.apiKey,
        baseUrl: override?.baseUrl
      });
    case "groq":
      return new GroqResponsesProvider({
        apiKey: override?.apiKey,
        baseURL: override?.baseUrl
      });
  }
}

let cachedLlm: LLMProvider | null = null;
let cachedBuilder: LLMProvider | null = null;

export function getLlmProvider(): LLMProvider {
  if (!cachedLlm) cachedLlm = makeProvider(env.LLM_PROVIDER);
  return cachedLlm;
}

export function getBuilderProvider(): LLMProvider {
  if (!cachedBuilder) cachedBuilder = makeProvider(env.LLM_BUILDER_PROVIDER);
  return cachedBuilder;
}

export function getLlmProviderWithOverride(provider: ProviderName, override?: ProviderOverride): LLMProvider {
  if (!override?.apiKey && !override?.baseUrl) {
    if (provider === env.LLM_PROVIDER) return getLlmProvider();
  }
  return makeProvider(provider, override);
}

export function getBuilderProviderWithOverride(provider: ProviderName, override?: ProviderOverride): LLMProvider {
  if (!override?.apiKey && !override?.baseUrl) {
    if (provider === env.LLM_BUILDER_PROVIDER) return getBuilderProvider();
  }
  return makeProvider(provider, override);
}
