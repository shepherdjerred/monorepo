import { z } from "zod";
import { DiscordUserSchema } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";

export const PlayBlockerSchema = z.enum([
  "no-session",
  "signed-out",
  "not-in-voice",
  "too-few-players",
]);
export type PlayBlocker = z.infer<typeof PlayBlockerSchema>;

export type Status = z.infer<typeof StatusSchema>;
export const StatusSchema = z.strictObject({
  /** Whether a game session is running right now. */
  sessionActive: z.boolean(),
  /** Whether the in-browser live feed is served. */
  driverFeedEnabled: z.boolean(),
  /** Everyone in the session's voice channel, bots excluded. */
  playerList: z.array(DiscordUserSchema),
  playBlocker: PlayBlockerSchema.nullable(),
  voiceChannelName: z.string().nullable(),
  minimumInChannel: z.number().int().nonnegative(),
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;
export const StatusResponseSchema = z.strictObject({
  kind: z.literal("status"),
  value: StatusSchema,
});
