import { z } from "zod";

export const ActionEffect = z
  .object({
    effect_type: z.string().min(1),
    delta: z.record(z.any()),
    audit: z.record(z.any())
  })
  .strict();

export type ActionEffect = z.infer<typeof ActionEffect>;
