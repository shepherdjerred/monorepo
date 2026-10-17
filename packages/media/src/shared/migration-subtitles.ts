import { z } from "zod";

export const SubtitleSourceProfileSchema = z.strictObject({
  profileId: z.number().int().positive(),
  cutoff: z.number().int().nonnegative().nullable(),
  items: z
    .array(
      z.strictObject({
        id: z.number().int().positive(),
        language: z.string().regex(/^[a-z]{2,3}$/u),
        forced: z.enum(["True", "False"]),
        hi: z.enum(["True", "False", "Excluded"]),
        audio_exclude: z.enum(["True", "False"]),
        audio_only_include: z.enum(["True", "False"]).optional(),
      }),
    )
    .max(20),
  originalFormat: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  // Hash these source constraints instead of persisting arbitrary user-entered strings.
  constraintHash: z.string().regex(/^[a-f0-9]{64}$/u),
  hasConstraints: z.boolean(),
});
export const SubtitleManagerReferenceSchema = z.strictObject({
  kind: z.enum(["radarr", "sonarr"]),
  sourceMediaId: z.string().regex(/^[\w:.-]{1,200}$/u),
  sourceInstanceId: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
});
