import { z } from "zod";

/**
 * Why this browser cannot take a seat right now, or null when it can.
 *
 * - `signed-out`: playing needs a Discord sign-in.
 * - `no-session`: nobody has started a game with `/play`.
 * - `not-in-voice`: the player must be in the session's voice channel.
 */
export type PlayBlocker = z.infer<typeof PlayBlockerSchema>;
export const PlayBlockerSchema = z.enum([
  "signed-out",
  "no-session",
  "not-in-voice",
]);

export type Status = z.infer<typeof StatusSchema>;
export const StatusSchema = z.strictObject({
  driverFeedEnabled: z.boolean(),
  /** The running session's voice channel, or null when no game is running. */
  voiceChannel: z.strictObject({ id: z.string(), name: z.string() }).nullable(),
  playBlocker: PlayBlockerSchema.nullable(),
});

export type StatusRequest = z.infer<typeof StatusRequestSchema>;
export const StatusRequestSchema = z.strictObject({
  kind: z.literal("status"),
});

/** Sent on request, and pushed when the session or the viewer's voice state changes. */
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
export const StatusResponseSchema = z.strictObject({
  kind: z.literal("status"),
  value: StatusSchema,
});
