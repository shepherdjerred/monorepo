import { z } from "zod";

/** A source that can be played into a Discord voice connection. */
export const SoundSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file"), path: z.string().min(1) }),
  z.object({ type: z.literal("url"), url: z.string().min(1) }),
]);

export type SoundSource = z.infer<typeof SoundSourceSchema>;
