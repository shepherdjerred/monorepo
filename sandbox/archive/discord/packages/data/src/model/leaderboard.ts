import { z } from "https://esm.sh/zod@3.22.4";
import { PlayerWithSoloQueueRankSchema } from "./player.ts";
import { rankToLeaguePoints } from "./leaguePoints.ts";
import { GlitterTierSchema } from "./glitterTier.ts";

export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;
export const LeaderboardEntrySchema = z.strictObject({
  player: PlayerWithSoloQueueRankSchema,
  position: z.number().nonnegative(),
  leaguePoints: z.number(),
  tier: GlitterTierSchema.optional(),
});

export type Leaderboard = z.infer<typeof LeaderboardSchema>;
export const LeaderboardSchema = z.strictObject({
  date: z.string().pipe(z.coerce.date()),
  contents: z.array(LeaderboardEntrySchema),
});

// the only difference between the two is the `leaguePointsDelta` field
export type OldLeaderboardEntry = z.infer<typeof OldLeaderboardEntrySchema>;
export const OldLeaderboardEntrySchema = z.strictObject({
  player: PlayerWithSoloQueueRankSchema,
  position: z.number().nonnegative(),
  leaguePointsDelta: z.number(),
});

export type OldLeaderboard = z.infer<typeof OldLeaderboardSchema>;
export const OldLeaderboardSchema = z.strictObject({
  date: z.string().pipe(z.coerce.date()),
  contents: z.array(OldLeaderboardEntrySchema),
});

export function convertOldLeaderboard(
  oldLeaderboard: OldLeaderboard,
): Leaderboard {
  return {
    date: oldLeaderboard.date,
    contents: oldLeaderboard.contents.map((entry) => ({
      player: entry.player,
      position: entry.position,
      tier: entry.player.config.tier,
      leaguePoints: rankToLeaguePoints(entry.player.ranks.solo),
    })),
  };
}
