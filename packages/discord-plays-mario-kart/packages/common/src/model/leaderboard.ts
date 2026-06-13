import { z } from "zod";

export const PLAYER_NAME_MAX = 20;

// Printable ASCII (code points 0x20..0x7E) keeps the stream burn-in font
// trivial (no shaping/emoji). Checked per code point rather than via a regex
// range, which lint flags as an "obscure range".
function isPrintableAscii(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

export const PlayerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PLAYER_NAME_MAX)
  .refine(isPrintableAscii, "printable ASCII only");

// ---- requests (client -> server) ----

/** Set (or clear, with null) the display name for the caller's claimed seat. */
export type NameSetRequest = z.infer<typeof NameSetRequestSchema>;
export const NameSetRequestSchema = z.strictObject({
  kind: z.literal("name-set"),
  name: PlayerNameSchema.nullable(),
});

export type LeaderboardRequest = z.infer<typeof LeaderboardRequestSchema>;
export const LeaderboardRequestSchema = z.strictObject({
  kind: z.literal("leaderboard"),
});

// ---- responses (server -> client) ----

export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;
export const LeaderboardEntrySchema = z.strictObject({
  name: z.string(),
  wins: z.number().int().min(0),
  races: z.number().int().min(0),
  winRate: z.number().min(0).max(1),
});

/** Sent on request, and broadcast to everyone after a race is recorded. */
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;
export const LeaderboardResponseSchema = z.strictObject({
  kind: z.literal("leaderboard"),
  value: z.strictObject({
    entries: z.array(LeaderboardEntrySchema),
  }),
});
