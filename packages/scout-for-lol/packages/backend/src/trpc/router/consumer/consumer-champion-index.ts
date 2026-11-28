import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import {
  LANE_ORDER,
  getChampionDisplayName,
  parseLane,
  type Lane,
} from "@scout-for-lol/data";
import type { LakeChampionIndexRow } from "#src/reports/duckdb/consumer/pages/champion-index-reads.ts";
import type { ChampionPagePerson } from "#src/trpc/router/consumer/consumer-champion-people.ts";

/** Games needed before a win rate ranks someone as "best" on a champion. */
export const QUALIFYING_GAMES = 10;

/** Win rate and tier from the public meta snapshot; filled in a later wave. */
export type ChampionIndexPublicMeta = {
  tier: string;
  winRate: number;
  games: number;
};

type Tally = { games: number; wins: number };

export type ChampionIndexPerson = {
  playerId: number;
  alias: string;
  guilds: { guildId: DiscordGuildId; name: string }[];
  games: number;
  wins: number;
  winRate: number;
  /** False below {@link QUALIFYING_GAMES} games on the champion. */
  qualified: boolean;
};

export type ChampionIndexEntry = {
  championId: number;
  name: string;
  /** Everyone in scope, the viewer included. */
  games: number;
  wins: number;
  winRate: number;
  /** Distinct friends who played it, the viewer excluded. */
  friendCount: number;
  /** Games per lane, most played first; a mode with no lane adds none. */
  lanes: { lane: Lane; games: number }[];
  lastPlayedMs: number;
  /** The viewer's own games on it; null when the viewer has none. */
  you: (Tally & { winRate: number; lastPlayedMs: number }) | null;
  /** The friend with the best win rate on it, qualified players first. */
  bestFriend: ChampionIndexPerson | null;
  /** Always null until the public meta snapshot is served (wave 4). */
  publicMeta: ChampionIndexPublicMeta | null;
};

type PersonTally = Tally & { lastPlayedMs: number };

function addTally(into: Tally, row: Tally): void {
  into.games += row.games;
  into.wins += row.wins;
}

function bestFriendOrder(
  left: ChampionIndexPerson,
  right: ChampionIndexPerson,
): number {
  if (left.qualified !== right.qualified) return left.qualified ? -1 : 1;
  return (
    right.winRate - left.winRate ||
    right.games - left.games ||
    left.alias.localeCompare(right.alias) ||
    left.playerId - right.playerId
  );
}

function laneOrder(
  left: { lane: Lane; games: number },
  right: { lane: Lane; games: number },
): number {
  return (
    right.games - left.games ||
    LANE_ORDER.indexOf(left.lane) - LANE_ORDER.indexOf(right.lane)
  );
}

/**
 * The index rows for the viewer and their friends, most played first with the
 * name and id breaking ties, so a re-read never reorders.
 */
export function buildChampionIndex(options: {
  rows: readonly LakeChampionIndexRow[];
  people: readonly ChampionPagePerson[];
}): ChampionIndexEntry[] {
  const personByKey = new Map(
    options.people.map(
      (person) => [person.playerId.toString(), person] as const,
    ),
  );
  const rowsByChampion = Map.groupBy(options.rows, (row) => row.champion_id);
  const entries = [...rowsByChampion.entries()].map(
    ([championId, championRows]): ChampionIndexEntry => {
      const total: Tally = { games: 0, wins: 0 };
      const lanes = new Map<Lane, number>();
      const perPerson = new Map<string, PersonTally>();
      let lastPlayedMs = 0;
      for (const row of championRows) {
        addTally(total, { games: row.games, wins: row.wins });
        lastPlayedMs = Math.max(lastPlayedMs, row.last_played_ms);
        const lane = parseLane(row.team_position);
        if (lane !== undefined) {
          lanes.set(lane, (lanes.get(lane) ?? 0) + row.games);
        }
        const person = perPerson.get(row.entry_key) ?? {
          games: 0,
          wins: 0,
          lastPlayedMs: 0,
        };
        addTally(person, { games: row.games, wins: row.wins });
        person.lastPlayedMs = Math.max(person.lastPlayedMs, row.last_played_ms);
        perPerson.set(row.entry_key, person);
      }
      const friends: ChampionIndexPerson[] = [];
      let you: ChampionIndexEntry["you"] = null;
      for (const [entryKey, tally] of perPerson) {
        const person = personByKey.get(entryKey);
        if (person === undefined) {
          throw new Error("Champion index returned an unrequested player");
        }
        const winRate = tally.wins / tally.games;
        if (person.isViewer) {
          you = { ...tally, winRate };
          continue;
        }
        friends.push({
          playerId: person.playerId,
          alias: person.alias,
          guilds: person.guilds,
          games: tally.games,
          wins: tally.wins,
          winRate,
          qualified: tally.games >= QUALIFYING_GAMES,
        });
      }
      return {
        championId,
        name: getChampionDisplayName(championId),
        games: total.games,
        wins: total.wins,
        winRate: total.wins / total.games,
        friendCount: friends.length,
        lanes: [...lanes]
          .map(([lane, games]) => ({ lane, games }))
          .toSorted(laneOrder),
        lastPlayedMs,
        you,
        bestFriend: friends.toSorted(bestFriendOrder)[0] ?? null,
        publicMeta: null,
      };
    },
  );
  return entries.toSorted(
    (left, right) =>
      right.games - left.games ||
      right.friendCount - left.friendCount ||
      left.name.localeCompare(right.name) ||
      left.championId - right.championId,
  );
}
