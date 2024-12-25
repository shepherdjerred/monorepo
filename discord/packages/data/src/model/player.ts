import { z } from "https://esm.sh/zod@3.22.4";
import { RankSchema, RanksSchema } from "./rank.ts";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import { rankToLeaguePoints } from "./leaguePoints.ts";
import { PlayerConfigEntrySchema } from "./playerConfig.ts";

export type Player = z.infer<typeof PlayerSchema>;
export const PlayerSchema = z.strictObject({
  config: PlayerConfigEntrySchema,
  ranks: RanksSchema,
});

export type PlayerWithSoloQueueRank = z.infer<
  typeof PlayerWithSoloQueueRankSchema
>;
export const PlayerWithSoloQueueRankSchema = PlayerSchema.extend({
  ranks: RanksSchema.extend({
    solo: RankSchema,
  }),
});

export function filterPlayersWithSoloQueueRank(
  players: Player[],
): PlayerWithSoloQueueRank[] {
  return _.chain(players)
    .flatMap((player) =>
      player.ranks.solo ? [player as PlayerWithSoloQueueRank] : []
    )
    .value();
}

export function sortPlayersBySoloQueueRank(
  players: Player[],
): PlayerWithSoloQueueRank[] {
  const playersWithSoloQueueRank = filterPlayersWithSoloQueueRank(players);
  return _.chain(playersWithSoloQueueRank)
    .sortBy((player) => rankToLeaguePoints(player.ranks.solo))
    .reverse()
    .value();
}
