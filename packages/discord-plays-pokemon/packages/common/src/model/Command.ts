import { z } from "zod";

export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export const CommandRequestSchema = z.strictObject({
  kind: z.literal("command"),
  value: z.string(),
});
