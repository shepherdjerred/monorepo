import { z } from "zod";
import { type Champion, ChampionSchema } from "#src/model/champion.ts";
import { RosterSchema } from "#src/model/roster.ts";
import { TeamSchema } from "#src/model/team.ts";
import { LaneSchema } from "#src/model/lane.ts";
import { QueueTypeSchema } from "#src/model/state.ts";
import { RankSchema } from "#src/model/rank.ts";
import { PlayerConfigEntrySchema } from "#src/model/player-config.ts";
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
  queueType: QueueTypeSchema.exclude(["arena", "classic"]).optional(),
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
  /**
   * Short one-line Scout commentary surfaced on the ranked-square design.
   * Optional — the renderer hides the commentary box when absent. Backend
   * may populate via LLM, template, or leave undefined.
   */
  commentary: z.string().optional(),
});

export const ClassicChampionSchema = z.strictObject({
  puuid: z.string().min(1),
  riotIdGameName: z.string().min(1),
  riotIdTagLine: z.string().min(1),
  championId: z.number().int().positive(),
  championName: z.string().min(1),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  level: z.number().int().min(1),
  items: z.array(z.number().int().nonnegative()).length(7),
  spells: z.array(z.number().int().nonnegative()).length(2),
  gold: z.number().int().nonnegative(),
  creepScore: z.number().int().nonnegative(),
});
export type ClassicChampion = z.infer<typeof ClassicChampionSchema>;

const ClassicRosterSchema = z.array(ClassicChampionSchema).min(1).max(5);

export const ClassicMatchSchema = z.strictObject({
  durationInSeconds: z.number().nonnegative(),
  queueType: z.literal("classic"),
  mapName: z.literal("Classic Rift"),
  players: z
    .array(
      z.strictObject({
        playerConfig: PlayerConfigEntrySchema,
        outcome: z.enum(["Victory", "Defeat", "Surrender"]),
        champion: ClassicChampionSchema,
        team: TeamSchema,
      }),
    )
    .min(1),
  teams: z.strictObject({
    red: ClassicRosterSchema,
    blue: ClassicRosterSchema,
  }),
});
export type ClassicMatch = z.infer<typeof ClassicMatchSchema>;

export function getLaneOpponent(
  player: Champion,
  opponents: Champion[],
): Champion | undefined {
  return pipe(
    opponents,
    filter((opponent) => opponent.lane === player.lane),
    first(),
  );
}
