import { z } from "zod";
import { ActionBundle, UUID } from "./action";

export const DecisionParseOutput = z
  .object({
    task_id: UUID,
    intent_summary: z.string().min(1),
    proposed_bundles: z.array(ActionBundle).length(2),
    clarifying_questions: z.array(z.string()).default([]),
    assumptions: z.array(z.string()).default([]),
  })
  .strict();

export type DecisionParseOutput = z.infer<typeof DecisionParseOutput>;
