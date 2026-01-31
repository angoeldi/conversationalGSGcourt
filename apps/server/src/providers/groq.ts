import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { LLMProvider, CompleteTextArgs, ParseWithSchemaArgs, ParseResult, Message } from "./types";
import { env } from "../config";

type GroqProviderOptions = {
  apiKey?: string;
  baseURL?: string;
};

export class GroqResponsesProvider implements LLMProvider {
  readonly name = "groq";
  private client: OpenAI;

  constructor(options: GroqProviderOptions = {}) {
    const apiKey = options.apiKey ?? env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is required for groq provider");
    const baseURL = options.baseURL ?? env.GROQ_BASE_URL;
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async completeText(args: CompleteTextArgs): Promise<string> {
    const resp = await this.client.responses.create({
      model: args.model,
      input: args.messages,
      temperature: args.temperature ?? 0.7
    });
    return resp.output_text;
  }

  async parseWithSchema<T>(args: ParseWithSchemaArgs<T>): Promise<ParseResult<T>> {
    try {
      const resp = await this.client.responses.parse({
        model: args.model,
        input: args.messages,
        temperature: args.temperature ?? 0.3,
        text: { format: zodTextFormat(args.schema, args.schemaName) }
      });
      const parsed = resp.output_parsed as T;
      return { parsed, rawText: resp.output_text, rawJson: parsed };
    } catch {
      const fallbackMessages: Message[] = [
        {
          role: "system",
          content: "Return ONLY a single JSON object, no markdown, no extra text."
        },
        ...args.messages
      ];
      const resp = await this.client.responses.create({
        model: args.model,
        input: fallbackMessages,
        temperature: Math.min(args.temperature ?? 0.3, 0.3)
      });
      const rawText = resp.output_text;
      const rawJson = parseLooseJson(rawText);
      const parsed = args.schema.parse(rawJson);
      return { parsed, rawText, rawJson };
    }
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
