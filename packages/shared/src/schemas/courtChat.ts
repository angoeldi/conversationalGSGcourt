import { z } from "zod";
import { UUID } from "./action";
import { TaskContext } from "./taskContext";

export const CourtChatCharacter = z
  .object({
    character_id: UUID,
    name: z.string().min(1),
    title: z.string().optional(),
    office: z.string().optional(),
    domain: z.enum(["foreign", "interior", "finance", "war", "intelligence", "chancellery"]).optional(),
    traits: z.array(z.string().min(1)).default([]),
    skills: z
      .object({
        diplomacy: z.number().int().min(0).max(100).optional(),
        finance: z.number().int().min(0).max(100).optional(),
        war: z.number().int().min(0).max(100).optional(),
        interior: z.number().int().min(0).max(100).optional(),
        intrigue: z.number().int().min(0).max(100).optional(),
        admin: z.number().int().min(0).max(100).optional()
      })
      .default({}),
    advisor_model: z
      .object({
        accuracy: z.number().min(0).max(1).optional(),
        reliability: z.number().min(0).max(1).optional()
      })
      .default({})
  })
  .strict();

export type CourtChatCharacter = z.infer<typeof CourtChatCharacter>;

export const CourtChatRequest = z
  .object({
    task_context: TaskContext,
    player_text: z.string().min(1),
    active_character_ids: z.array(UUID).min(1),
    characters: z.array(CourtChatCharacter).min(1),
    max_messages: z.number().int().min(1).max(4).default(2)
  })
  .strict();

export type CourtChatRequest = z.infer<typeof CourtChatRequest>;

export const CourtChatMessage = z
  .object({
    speaker_character_id: UUID,
    content: z.string().min(1)
  })
  .strict();

export type CourtChatMessage = z.infer<typeof CourtChatMessage>;

export const CourtChatOutput = z
  .object({
    task_id: UUID,
    messages: z.array(CourtChatMessage).min(1)
  })
  .strict();

export type CourtChatOutput = z.infer<typeof CourtChatOutput>;
