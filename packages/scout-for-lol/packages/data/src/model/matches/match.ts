import { z } from "zod";
import { type Champion, ChampionSchema } from "#src/model/riot/champion.ts";
import { RosterSchema } from "#src/model/riot/roster.ts";
import { TeamSchema } from "#src/model/riot/team.ts";
import { LaneSchema } from "#src/model/riot/lane.ts";
import { QueueTypeSchema } from "#src/model/core/state.ts";
import { RankSchema } from "#src/model/riot/rank.ts";
import { PlayerConfigEntrySchema } from "#src/model/riot/player-config.ts";
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
  queueType: QueueTypeSchema.exclude([
    "arena",
    "classic",
    "classic aram mayhem",
  ]).optional(),
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

export const ClassicMatchSchema = z
  .strictObject({
    durationInSeconds: z.number().nonnegative(),
    queueType: z.enum(["classic", "classic aram mayhem"]),
    mapName: z.enum(["Classic Rift", "The Bandlewood"]),
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
  })
  .superRefine((data, context) => {
    const expectedMapName =
      data.queueType === "classic" ? "Classic Rift" : "The Bandlewood";
    if (data.mapName !== expectedMapName) {
      context.addIssue({
        code: "custom",
        message: `${data.queueType} matches must use ${expectedMapName}`,
        path: ["mapName"],
      });
    }
  });
export type ClassicMatch = z.infer<typeof ClassicMatchSchema>;

export function getLaneOpponent(
  player: Champion,
  opponents: Champion[],
): Champion | undefined {
  // A laneless player has no lane opponent. Without this guard, a lobby where
  // every `teamPosition` is "" (which is what Riot sends for sub-5 sides in a
  // custom) matches `undefined === undefined` against every enemy and returns
  // an arbitrary one. That answer then reaches the AI review prompt, which
  // states it as fact.
  if (player.lane === undefined) {
    return undefined;
  }
  return pipe(
    opponents,
    filter((opponent) => opponent.lane === player.lane),
    first(),
  );
}
