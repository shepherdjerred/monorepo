import type {
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
} from "@scout-for-lol/data";
import {
  groupGamesByPuuid,
  groupPeople,
  personGames,
  type RosterPlayerRow,
} from "#src/lib/player-profile/roster.ts";
import type { RosterGameRow } from "#src/reports/duckdb/consumer/pages/roster-lake-reads.ts";

/**
 * One person the viewer can see: every Player row joined by a shared Discord
 * link or PUUID, with their games merged across accounts and servers so a
 * multi-account or multi-server friend is counted once.
 */
export type HomePerson = {
  /** The lowest Player id among the person's rows; the stable identity. */
  playerId: number;
  /** Every Player row of the person, in the viewer's servers. */
  playerIds: number[];
  alias: string;
  isYou: boolean;
  guildIds: DiscordGuildId[];
  puuids: ReadonlySet<LeaguePuuid>;
  /** Newest first, one row per match. */
  games: RosterGameRow[];
};

export function resolveHomePeople(input: {
  players: RosterPlayerRow[];
  games: readonly RosterGameRow[];
  viewerDiscordId: DiscordAccountId;
}): HomePerson[] {
  const byPuuid = groupGamesByPuuid(input.games);
  return groupPeople(input.players)
    .map((members) => {
      const sorted = members.toSorted((left, right) => left.id - right.id);
      const primary = sorted[0];
      if (primary === undefined) throw new Error("A person has no player");
      const puuids = new Set(
        members.flatMap((member) =>
          member.accounts.map((account) => account.puuid),
        ),
      );
      return {
        playerId: primary.id,
        playerIds: sorted.map((member) => member.id),
        alias: primary.alias,
        isYou: members.some(
          (member) => member.discordId === input.viewerDiscordId,
        ),
        guildIds: [
          ...new Set(sorted.map((member) => member.serverId)),
        ].toSorted(),
        puuids,
        games: personGames(puuids, byPuuid),
      };
    })
    .toSorted((left, right) => left.playerId - right.playerId);
}
