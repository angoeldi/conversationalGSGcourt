import { z } from "zod";
import { UUID, NonEmpty } from "./action";

export const PerceivedFact = z
  .object({
    fact_id: NonEmpty,
    domain: z.enum(["diplomacy", "war", "finance", "interior", "intrigue", "society", "economy"]),
    statement: z.string().min(1),
    value: z.union([z.number(), z.string(), z.boolean(), z.null()]),
    scale: z.string().optional(),
    confidence: z.number().min(0).max(1),
    last_updated_turn: z.number().int().min(0),
    source_character_id: UUID.optional(),
    notes: z.string().optional(),
  })
  .strict();

export type PerceivedFact = z.infer<typeof PerceivedFact>;

export const EntityRef = z
  .object({
    entity_type: z.enum(["nation", "province", "character", "office", "interest_group", "operation"]),
    entity_id: UUID,
    display_name: NonEmpty,
  })
  .strict();

export type EntityRef = z.infer<typeof EntityRef>;

export const ContextSource = z
  .object({
    source_type: z.enum(["wikipedia"]).default("wikipedia"),
    title: NonEmpty,
    url: NonEmpty,
    excerpt: z.string().default("")
  })
  .strict();

export type ContextSource = z.infer<typeof ContextSource>;

export const TranscriptMessage = z
  .object({
    role: z.enum(["player", "courtier", "system"]),
    sender_character_id: UUID.optional(),
    content: z.string().min(1),
  })
  .strict();

export type TranscriptMessage = z.infer<typeof TranscriptMessage>;

export const StoryTranscript = z
  .object({
    task_id: UUID,
    turn_index: z.number().int().min(0),
    messages: z.array(TranscriptMessage).min(1),
  })
  .strict();

export type StoryTranscript = z.infer<typeof StoryTranscript>;

export const TaskContext = z
  .object({
    task_id: UUID,
    task_type: z.enum([
      "diplomacy",
      "war",
      "finance",
      "interior",
      "intrigue",
      "appointment",
      "petition",
      "crisis",
    ]),
    owner_character_id: UUID.optional(),
    nation_id: UUID,
    created_turn: z.number().int().min(0),
    due_turn: z.number().int().min(0).optional(),
    urgency: z.enum(["low", "medium", "high"]).default("medium"),
    prompt: z.string().min(1),
    sources: z.array(ContextSource).default([]),
    story: z
      .object({
        story_id: UUID,
        title: z.string().min(1),
        summary: z.string().min(1),
        history: z.array(z.string().min(1)).default([]),
        last_turn: z.number().int().min(0).optional(),
        transcripts: z.array(StoryTranscript).default([]),
      })
      .optional(),

    // What the player + court are allowed to see about the situation.
    perceived_facts: z.array(PerceivedFact).default([]),
    entities: z.array(EntityRef).default([]),

    // Hard constraints (laws, institutions, geography) already surfaced to the LLM.
    constraints: z
      .object({
        allowed_action_types: z.array(z.string()).default([]),
        forbidden_action_types: z.array(z.string()).default([]),
        suggested_action_types: z.array(z.string()).default([]),
        notes: z.array(z.string()).default([]),
      })
      .default({ allowed_action_types: [], forbidden_action_types: [], suggested_action_types: [], notes: [] }),

    // Chat memory: server maintains a rolling summary so clients can request small contexts.
    chat_summary: z.string().default(""),
    last_messages: z
      .array(
        z.object({
          role: z.enum(["player", "courtier", "system"]),
          sender_character_id: UUID.optional(),
          content: z.string().min(1),
        })
      )
      .default([]),
  })
  .strict();

export type TaskContext = z.infer<typeof TaskContext>;
