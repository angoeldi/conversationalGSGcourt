import type { z } from "zod";

export type Message = { role: "system" | "user" | "assistant"; content: string };

export type ParseWithSchemaArgs<T> = {
  model: string;
  schema: z.ZodType<T>;
  schemaName: string;
  messages: Message[];
  temperature?: number;
};

export type CompleteTextArgs = {
  model: string;
  messages: Message[];
  temperature?: number;
};

export type ParseResult<T> = {
  parsed: T;
  rawText: string;
  rawJson: unknown;
};

export interface LLMProvider {
  readonly name: string;
  completeText(args: CompleteTextArgs): Promise<string>;
  parseWithSchema<T>(args: ParseWithSchemaArgs<T>): Promise<ParseResult<T>>;
}
