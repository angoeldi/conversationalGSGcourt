import { z } from "zod";
import { UUID, NonEmpty } from "./action";

export const ClaimValue = z.union([z.string(), z.number(), z.boolean()]);

export const Claim = z
  .object({
    claim_id: UUID.optional(),
    subject: NonEmpty,
    predicate: NonEmpty,
    value: ClaimValue,
    unit: z.string().optional(),
    confidence: z.number().min(0).max(1),
    epistemic_status: z.enum(["asserted", "speculated", "rhetorical"]),
    fact_id: z.string().optional(),
    source_hint: z.string().optional(),
  })
  .strict();

export type Claim = z.infer<typeof Claim>;

export const CourtierMessage = z
  .object({
    thread_id: UUID.optional(),
    task_id: UUID.optional(),
    sender_character_id: UUID.optional(),
    content: z.string().min(1),
    claims: z.array(Claim).default([]),
    recommendation_hint: z
      .object({
        suggested_action_types: z.array(z.string()).default([]),
        urgency: z.enum(["low", "medium", "high"]).optional(),
      })
      .optional(),
  })
  .strict();

export type CourtierMessage = z.infer<typeof CourtierMessage>;
