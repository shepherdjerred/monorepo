import { z } from "zod";

export type CommandRequest = z.infer<typeof CommandRequestSchema>;
/** A chord, written exactly as it would be typed in Discord, e.g. `3a up`. */
export const CommandRequestSchema = z.strictObject({
  kind: z.literal("command"),
  value: z.string().min(1).max(200),
});
