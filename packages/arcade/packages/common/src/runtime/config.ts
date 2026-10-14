import { z } from "zod";

export const MediaFormatSchema = z.strictObject({
  width: z.number().int().min(1).max(1920),
  height: z.number().int().min(1).max(1080),
  fps: z.literal(30),
  pixelFormat: z.enum(["rgba", "bgra"]),
  audioSampleRate: z.literal(48_000),
  audioChannels: z.literal(2),
  displayAspect: z.number().positive(),
});
export type RuntimeMediaFormat = z.infer<typeof MediaFormatSchema>;
export const RuntimePageSchema = z.strictObject({
  gameId: z.enum(["mkwii", "melee"]),
  sourceRevision: z.string().regex(/^[a-f\d]{40}$/),
  discSize: z.number().int().positive().nullable(),
  format: MediaFormatSchema,
});
export type RuntimePageConfig = z.infer<typeof RuntimePageSchema>;
