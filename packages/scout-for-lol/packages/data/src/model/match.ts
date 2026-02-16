import { z } from "zod";
import { type Champion, ChampionSchema } from "@scout-for-lol/data/model/champion";
import { RosterSchema } from "@scout-for-lol/data/model/roster";
import { TeamSchema } from "@scout-for-lol/data/model/team";
import { LaneSchema } from "@scout-for-lol/data/model/lane";
import { QueueTypeSchema } from "@scout-for-lol/data/model/state";
import { RankSchema } from "@scout-for-lol/data/model/rank";
import { PlayerConfigEntrySchema } from "@scout-for-lol/data/model/player-config";
import { filter, first, pipe } from "remeda";

/**
 * Branded type for Riot Games Match IDs
 * Format: "{PLATFORM_ID}_{GAME_ID}" (e.g., "NA1_5370969615")
 */
export type MatchId = z.infer<typeof MatchIdSchema>;
export const MatchIdSchema = z.string().brand<"MatchId">();

export type CompletedMatch = z.infer<typeof CompletedMatchSchema>;
export const CompletedMatchSchema = z.strictObject({
  durationInSeconds: z.number().nonnegative(),
  queueType: QueueTypeSchema.exclude(["arena"]).optional(),
  /**
   * Data specific to all players we care about (e.g. all subscribed players in this match).
   * This was previously a single 'player' object, now an array for multi-player support.
   */
  players: z.array(
    z.strictObject({
      playerConfig: PlayerConfigEntrySchema,
      wins: z.number().nonnegative().optional(),
      losses: z.number().nonnegative().optional(),
      outcome: z.enum(["Victory", "Defeat", "Surrender"]),
      champion: ChampionSchema,
      team: TeamSchema,
      lane: LaneSchema.optional(),
      laneOpponent: ChampionSchema.optional(),
      rankBeforeMatch: RankSchema.optional(),
      rankAfterMatch: RankSchema.optional(),
    }),
  ),

  teams: z.strictObject({
    red: RosterSchema,
    blue: RosterSchema,
  }),
});

export function getLaneOpponent(player: Champion, opponents: Champion[]): Champion | undefined {
  return pipe(
    opponents,
    filter((opponent) => opponent.lane === player.lane),
    first(),
  );
}
