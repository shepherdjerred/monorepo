import {
  Leaderboard,
  Player,
  rankToLeaguePoints,
  sortPlayersBySoloQueueRank,
} from "@discord/data";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";

export function toLeaderboard(players: Player[]): Leaderboard {
  let position = 0;
  let previous: number;

  const playersSorted = sortPlayersBySoloQueueRank(players);

  const entries = _.map(playersSorted, (player) => {
    const leaguePoints = rankToLeaguePoints(player.ranks.solo);

    // account for ties
    if (leaguePoints !== previous) {
      position++;
    }

    return {
      player,
      leaguePoints,
      position,
    };
  });

  return {
    date: new Date(),
    contents: entries,
  };
}
