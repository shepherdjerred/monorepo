import { z } from "zod";
import {
  DiscordIdSchema,
  DiscordUserSchema,
} from "@shepherdjerred/discord-plays-core/auth/protocol.ts";

export const PLAYER_NAME_MAX = 20;

// Printable ASCII (code points 0x20..0x7E) keeps the stream burn-in font
// trivial (no shaping/emoji). Checked per code point rather than via a regex
// range, which lint flags as an "obscure range". Discord names are folded to
// this by `toPlayerName` before they reach a seat.
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

export type LeaderboardRequest = z.infer<typeof LeaderboardRequestSchema>;
export const LeaderboardRequestSchema = z.strictObject({
  kind: z.literal("leaderboard"),
});

export type PlayerStatsRequest = z.infer<typeof PlayerStatsRequestSchema>;
export const PlayerStatsRequestSchema = z.strictObject({
  kind: z.literal("player-stats"),
  discordId: DiscordIdSchema,
});

export type RecentRacesRequest = z.infer<typeof RecentRacesRequestSchema>;
export const RecentRacesRequestSchema = z.strictObject({
  kind: z.literal("recent-races"),
});

// ---- responses (server -> client) ----

/** A player's record over ranked races (Grand Prix and VS). */
export type PlayerRecord = z.infer<typeof PlayerRecordSchema>;
export const PlayerRecordSchema = z.strictObject({
  player: DiscordUserSchema,
  races: z.number().int().min(0),
  wins: z.number().int().min(0),
  /** Finished 1st, 2nd or 3rd. */
  podiums: z.number().int().min(0),
  /** Races not won. */
  losses: z.number().int().min(0),
  averagePlacement: z.number().min(1).max(8),
  winRate: z.number().min(0).max(1),
});

export type RaceResultSummary = z.infer<typeof RaceResultSummarySchema>;
export const RaceResultSummarySchema = z.strictObject({
  /** Null for races recorded before Discord sign-in existed. */
  player: DiscordUserSchema.nullable(),
  /** The name shown at the time of the race. */
  name: z.string().nullable(),
  placement: z.number().int().min(1).max(8),
  characterId: z.number().int().min(0),
  raceTimeMs: z.number().int().min(0),
  finished: z.boolean(),
});

export type RaceSummary = z.infer<typeof RaceSummarySchema>;
export const RaceSummarySchema = z.strictObject({
  id: z.number().int(),
  finishedAtMs: z.number().int(),
  courseId: z.number().int().min(0),
  gameMode: z.enum(["gp", "versus", "time-trials"]),
  /** Human racers only, best placement first. */
  results: z.array(RaceResultSummarySchema),
});

export type PlayerStats = z.infer<typeof PlayerStatsSchema>;
export const PlayerStatsSchema = z.strictObject({
  record: PlayerRecordSchema,
  /** Finishes per placement: index 0 = 1st place, index 7 = 8th. */
  placements: z.array(z.number().int().min(0)).length(8),
  /** Fastest finished race per course, in course order. */
  bestTimes: z.array(
    z.strictObject({
      courseId: z.number().int().min(0),
      raceTimeMs: z.number().int().min(0),
      characterId: z.number().int().min(0),
    }),
  ),
  /** Most-raced character, or null with no races. */
  favoriteCharacterId: z.number().int().min(0).nullable(),
  recent: z.array(RaceSummarySchema),
});

/** Sent on request, and broadcast to everyone after a race is recorded. */
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;
export const LeaderboardResponseSchema = z.strictObject({
  kind: z.literal("leaderboard"),
  value: z.strictObject({
    entries: z.array(PlayerRecordSchema),
  }),
});

/** `stats` is null when the player has no ranked races here. */
export type PlayerStatsResponse = z.infer<typeof PlayerStatsResponseSchema>;
export const PlayerStatsResponseSchema = z.strictObject({
  kind: z.literal("player-stats"),
  value: z.strictObject({
    discordId: DiscordIdSchema,
    stats: PlayerStatsSchema.nullable(),
  }),
});

export type RecentRacesResponse = z.infer<typeof RecentRacesResponseSchema>;
export const RecentRacesResponseSchema = z.strictObject({
  kind: z.literal("recent-races"),
  value: z.strictObject({
    races: z.array(RaceSummarySchema),
  }),
});
