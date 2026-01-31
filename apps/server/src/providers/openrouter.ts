import { zodToJsonSchema } from "zod-to-json-schema";
import type { LLMProvider, CompleteTextArgs, ParseWithSchemaArgs, ParseResult, Message } from "./types";
import { env } from "../config";

type OpenRouterProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
};

type OpenRouterChatResponse = {
  choices: Array<{ message: { role: string; content: string } }>;
};

export class OpenRouterChatProvider implements LLMProvider {
  readonly name = "openrouter";

  constructor(options: OpenRouterProviderOptions = {}) {
    const apiKey = options.apiKey ?? env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for openrouter provider");
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl ?? env.OPENROUTER_BASE_URL;
  }

  async completeText(args: CompleteTextArgs): Promise<string> {
    const data = await this.call(args.model, args.messages, undefined, args.temperature ?? 0.7);
    return data.choices[0]?.message?.content ?? "";
  }

  async parseWithSchema<T>(args: ParseWithSchemaArgs<T>): Promise<ParseResult<T>> {
    // Preferred path: provider-level structured outputs.
    const jsonSchema = zodToJsonSchema(args.schema, args.schemaName);
    try {
      const data = await this.call(args.model, args.messages, jsonSchema, args.temperature ?? 0.3);
      const text = data.choices[0]?.message?.content ?? "";
      const raw = parseLooseJson(text);
      const parsed = args.schema.parse(raw);
      return { parsed, rawText: text, rawJson: raw };
    } catch (e) {
      // Fallback: JSON mode by instruction, then validate locally.
      const fallbackMessages: Message[] = [
        {
          role: "system",
          content: "Return ONLY a single JSON object. Do not wrap in markdown. Do not add extra text."
        },
        ...args.messages
      ];
      const data = await this.call(args.model, fallbackMessages, undefined, Math.min(args.temperature ?? 0.3, 0.3));
      const text = data.choices[0]?.message?.content ?? "";
      const raw = parseLooseJson(text);
      const parsed = args.schema.parse(raw);
      return { parsed, rawText: text, rawJson: raw };
    }
  }

  private apiKey: string;
  private baseUrl: string;

  private async call(model: string, messages: Message[], jsonSchema: unknown | undefined, temperature: number): Promise<OpenRouterChatResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const body: any = { model, messages, temperature };

    if (jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "the_court_schema",
          strict: true,
          schema: jsonSchema
        }
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`OpenRouter error ${res.status}: ${t}`);
    }

    return (await res.json()) as OpenRouterChatResponse;
  }
}

function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error("Response was not JSON parseable");
  }
}
