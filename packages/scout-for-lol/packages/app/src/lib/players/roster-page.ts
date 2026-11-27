import { parseQueueType, type DiscordGuildId } from "@scout-for-lol/data";
import { getBrowserChampionName } from "@scout-for-lol/data/browser-assets";
import { relativeWhenInline } from "#src/lib/format/relative-time.ts";
import { streakPhrase, wonOfLast } from "#src/lib/player/form-text.ts";
import { queueLabel } from "#src/lib/player/player-feed.ts";
import { rankParts, type RankParts } from "#src/lib/player/rank-parts.ts";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";

export type Roster = RouterOutputs["consumerPlayer"]["roster"];
export type RosterPlayer = Roster["players"][number];

/** Friends listed before "See all". */
export const FRIENDS_PREVIEW = 8;
/** The fewest characters that start a search. */
export const MIN_SEARCH_CHARACTERS = 2;

/** Whether a search is long enough to run. */
export function isSearchReady(query: string): boolean {
  return query.trim().length >= MIN_SEARCH_CHARACTERS;
}

/** People in at least one of the chosen servers; every server when none is chosen. */
export function playersIn(
  roster: Roster,
  guildIds: readonly DiscordGuildId[] | undefined,
): RosterPlayer[] {
  return guildIds === undefined
    ? roster.players
    : roster.players.filter((player) =>
        player.memberships.some((membership) =>
          guildIds.includes(membership.guild.id),
        ),
      );
}

/** The roster's people in the order a search ranked them; anyone it does not list is left out. */
export function playersMatching(
  roster: Roster,
  playerIds: readonly number[],
): RosterPlayer[] {
  const byId = new Map(
    roster.players.flatMap((player) =>
      player.memberships.map(
        (membership) => [membership.playerId, player] as const,
      ),
    ),
  );
  const found = playerIds.flatMap((id) => byId.get(id) ?? []);
  return [...new Set(found)];
}

/** The viewer's own entry, when a player is linked to their Discord account. */
export function youIn(
  players: readonly RosterPlayer[],
): RosterPlayer | undefined {
  return players.find((player) => player.isYou);
}

/** Their best queue's rank for a row: Solo/Duo, else Flex. */
export function rowRank(player: RosterPlayer): RankParts | undefined {
  const rank = player.rank.solo ?? player.rank.flex;
  return rank === null ? undefined : rankParts(rank);
}

/**
 * The end of a sentence about someone's latest game: "Lost as Thresh, 2 hours
 * ago", or "as Ahri" for a game under way (the row leads it with "In a game
 * now").
 */
export function latestLine(
  player: RosterPlayer,
  nowMs: number,
): string | undefined {
  if (player.live !== null) {
    return `as ${getBrowserChampionName(player.live.championId)}`;
  }
  const game = player.latestGame;
  if (game === null) return undefined;
  const when = relativeWhenInline(game.gameCreationMs, nowMs);
  return `${game.win ? "Won" : "Lost"} as ${game.championName}, ${when}`;
}

/** "Won 12 of the last 20, and on a 3-game win streak." */
export function youLine(player: RosterPlayer): string | undefined {
  const { form } = player;
  if (form === null) return undefined;
  const run = streakPhrase(form.streak);
  return `${wonOfLast(form.wins, form.games)}${run === undefined ? "" : `, and on ${run}`}.`;
}

export type RosterHero = {
  lead: string;
  sub: string | undefined;
  /** The champion behind the hero's art, when there is one. */
  art: number | undefined;
};

function nameList(names: readonly string[]): string {
  return names.length <= 2
    ? names.join(" and ")
    : `${names[0] ?? ""} and ${(names.length - 1).toString()} others`;
}

/** Who is in a game right now, or how active the servers have been. */
export function rosterHero(players: readonly RosterPlayer[]): RosterHero {
  const live = players
    .flatMap((player) =>
      player.live === null ? [] : [{ player, live: player.live }],
    )
    .toSorted(
      (left, right) =>
        new Date(right.live.detectedAt).getTime() -
        new Date(left.live.detectedAt).getTime(),
    );
  const first = live[0];
  if (first !== undefined) {
    const champion = getBrowserChampionName(first.live.championId);
    const queueType = parseQueueType(first.live.queueId);
    const queue = queueType === undefined ? undefined : queueLabel(queueType);
    const names = live.map((entry) => entry.player.alias);
    return {
      lead: `${nameList(names)} ${names.length === 1 ? "is" : "are"} playing right now.`,
      sub: `As ${champion}${queue === undefined ? "" : ` in ${queue}`}.`,
      art: first.live.championId,
    };
  }
  const latest = players
    .flatMap((player) =>
      player.latestGame === null ? [] : [player.latestGame],
    )
    .toSorted((left, right) => right.gameCreationMs - left.gameCreationMs)[0];
  const active = players.filter(
    (player) => player.lastSevenDays.games > 0,
  ).length;
  return {
    lead: `${active.toString()} of ${players.length.toString()} played this week.`,
    sub: undefined,
    art: latest?.championId,
  };
}
