import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { LLMProvider, CompleteTextArgs, ParseWithSchemaArgs, ParseResult } from "./types";
import { env } from "../config";

type OpenAIProviderOptions = {
  apiKey?: string;
  baseURL?: string;
};

export class OpenAIResponsesProvider implements LLMProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(options: OpenAIProviderOptions = {}) {
    const apiKey = options.apiKey ?? env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for openai provider");
    const baseURL = options.baseURL ?? env.OPENAI_BASE_URL ?? undefined;
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async completeText(args: CompleteTextArgs): Promise<string> {
    const resp = await this.client.responses.create({
      model: args.model,
      input: args.messages,
      temperature: args.temperature ?? 0.7
    });
    // The SDK normalizes output to text; `output_text` is the most convenient.
    return resp.output_text;
  }

  async parseWithSchema<T>(args: ParseWithSchemaArgs<T>): Promise<ParseResult<T>> {
    const resp = await this.client.responses.parse({
      model: args.model,
      input: args.messages,
      temperature: args.temperature ?? 0.3,
      text: { format: zodTextFormat(args.schema, args.schemaName) }
    });
    const parsed = resp.output_parsed as T;
    return { parsed, rawText: resp.output_text, rawJson: parsed };
  }
}
