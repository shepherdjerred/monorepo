import { z } from "zod";
import { PlayerSchema } from "./player.ts";

export type Status = z.infer<typeof StatusSchema>;
export const StatusSchema = z.strictObject({
  /** Whether a game session is running right now. */
  sessionActive: z.boolean(),
  /** Whether the in-browser live feed is served. */
  driverFeedEnabled: z.boolean(),
  /** Everyone in the session's voice channel, bots excluded. */
  playerList: z.array(PlayerSchema),
});

export type StatusRequest = z.infer<typeof StatusRequestSchema>;
export const StatusRequestSchema = z.strictObject({
  kind: z.literal("status"),
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;
export const StatusResponseSchema = z.strictObject({
  kind: z.literal("status"),
  value: StatusSchema,
});
