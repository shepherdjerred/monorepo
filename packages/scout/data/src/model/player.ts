import { z } from "zod";
import { RankSchema, RanksSchema } from "@shepherdjerred/scout-data/model/rank";
import { rankToLeaguePoints } from "@shepherdjerred/scout-data/model/league-points";
import { PlayerConfigEntrySchema } from "@shepherdjerred/scout-data/model/player-config";
import { flatMap, sortBy } from "remeda";

export type Player = z.infer<typeof PlayerSchema>;
export const PlayerSchema = z.strictObject({
  config: PlayerConfigEntrySchema,
  ranks: RanksSchema,
});

export type PlayerWithSoloQueueRank = z.infer<typeof PlayerWithSoloQueueRankSchema>;
export const PlayerWithSoloQueueRankSchema = PlayerSchema.extend({
  ranks: RanksSchema.extend({
    solo: RankSchema,
  }),
});

export function filterPlayersWithSoloQueueRank(players: Player[]): PlayerWithSoloQueueRank[] {
  return flatMap(players, (player) => {
    const result = PlayerWithSoloQueueRankSchema.safeParse(player);
    return result.success ? [result.data] : [];
  });
}

export function sortPlayersBySoloQueueRank(players: Player[]): PlayerWithSoloQueueRank[] {
  const playersWithSoloQueueRank = filterPlayersWithSoloQueueRank(players);
  return sortBy(playersWithSoloQueueRank, (player) => rankToLeaguePoints(player.ranks.solo)).reverse();
}
