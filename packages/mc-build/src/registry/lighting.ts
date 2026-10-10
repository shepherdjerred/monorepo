import { z } from "zod";

export const LightingValueSchema = z.strictObject({
  emission: z.number().int().min(0).max(15),
  transmits: z.boolean(),
});
export type LightingValue = z.infer<typeof LightingValueSchema>;

/** Paper enumerates every state; omitted overrides equal its recorded default. */
export const BlockLightingSchema = z.strictObject({
  states: z.number().int().positive(),
  default: LightingValueSchema,
  overrides: z.record(z.string(), LightingValueSchema),
});
export type BlockLighting = z.infer<typeof BlockLightingSchema>;
