import { z } from "zod";

/** Ask a game's publisher for the viewer's current session and voice status. */
export const StatusRequestSchema = z.strictObject({
  kind: z.literal("status"),
});
export type StatusRequest = z.infer<typeof StatusRequestSchema>;
