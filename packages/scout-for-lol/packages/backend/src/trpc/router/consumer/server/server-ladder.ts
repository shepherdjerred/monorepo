import {
  rankToLeaguePoints,
  type DiscordAccountId,
  type LeaguePuuid,
  type Rank,
} from "@scout-for-lol/data";
import type { PuuidRanks } from "#src/lib/player-profile/profile-resolution.ts";
import {
  byName,
  playerRef,
  type ServerPlayer,
} from "#src/trpc/router/consumer/server/server-people.ts";

function points(rank: Rank | null): number {
  return rank === null ? -1 : rankToLeaguePoints(rank);
}

/** The player's freshest Solo/Duo rank across their accounts. */
function soloRank(
  player: ServerPlayer,
  ranks: Map<LeaguePuuid, PuuidRanks>,
): Rank | null {
  const evidence = player.accounts
    .map((account) => ranks.get(account.puuid)?.solo)
    .filter((entry) => entry !== undefined)
    .toSorted((left, right) => right.at.getTime() - left.at.getTime())[0];
  return evidence?.rank ?? null;
}

/**
 * Every tracked player by current Solo/Duo rank, highest first and unranked
 * last. Equal ranks fall back to name and id so the order never shifts between
 * requests.
 */
export function buildLadder(input: {
  players: ServerPlayer[];
  ranks: Map<LeaguePuuid, PuuidRanks>;
  viewerDiscordId: DiscordAccountId;
}) {
  const ranked = input.players.map((player) => ({
    player,
    rank: soloRank(player, input.ranks),
  }));
  return ranked
    .toSorted(
      (left, right) =>
        points(right.rank) - points(left.rank) ||
        byName(left.player, right.player),
    )
    .map((entry, index) => ({
      place: index + 1,
      ...playerRef(entry.player, input.viewerDiscordId),
      rank: entry.rank,
    }));
}
