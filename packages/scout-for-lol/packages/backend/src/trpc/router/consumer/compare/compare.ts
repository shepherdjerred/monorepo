import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
} from "@scout-for-lol/data";
import { freshest, ROSTER_FORM_GAMES } from "#src/lib/player-profile/roster.ts";
import {
  latestRanksByPuuid,
  type PuuidRanks,
} from "#src/lib/player-profile/profile-resolution.ts";
import { readGuildMatchRows } from "#src/reports/duckdb/community/community-lake.ts";
import {
  readAccountChampions,
  type AccountChampionRow,
} from "#src/reports/duckdb/consumer/pages/compare-lake-reads.ts";
import { withLakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import {
  readRosterGames,
  type RosterGameRow,
} from "#src/reports/duckdb/consumer/pages/roster-lake-reads.ts";
import { duoHistory } from "#src/trpc/router/consumer/community-insights.ts";
import {
  resolveComparedPeople,
  type ComparedPerson,
} from "#src/trpc/router/consumer/compare/compare-people.ts";
import { STANDARD_COMMUNITY_QUEUES } from "#src/trpc/router/consumer/standard-rift.ts";

/** The most champions listed under "Champions you both play". */
export const COMPARE_CHAMPION_LIMIT = 6;

type GameTally = { games: number; wins: number };

function recentForm(
  person: ComparedPerson,
  games: RosterGameRow[],
): GameTally | null {
  const puuids = new Set<string>(person.puuids);
  const form = [
    ...new Map(
      games
        .filter((game) => puuids.has(game.puuid))
        .toSorted(
          (left, right) =>
            right.game_creation_ms - left.game_creation_ms ||
            right.match_id.localeCompare(left.match_id),
        )
        .map((game) => [game.match_id, game] as const),
    ).values(),
  ].slice(0, ROSTER_FORM_GAMES);
  return form.length === 0
    ? null
    : { games: form.length, wins: form.filter((game) => game.win).length };
}

type ChampionTotals = { name: string; tally: GameTally };

function championTotals(
  person: ComparedPerson,
  rows: AccountChampionRow[],
): Map<number, ChampionTotals> {
  const puuids = new Set<string>(person.puuids);
  const totals = new Map<number, ChampionTotals>();
  for (const row of rows.filter((candidate) => puuids.has(candidate.puuid))) {
    const current = totals.get(row.champion_id);
    totals.set(row.champion_id, {
      name: current?.name ?? row.champion_name,
      tally: {
        games: (current?.tally.games ?? 0) + row.games,
        wins: (current?.tally.wins ?? 0) + row.wins,
      },
    });
  }
  return totals;
}

/** Champions both people have played, the most played together first. */
function sharedChampions(
  left: Map<number, ChampionTotals>,
  right: Map<number, ChampionTotals>,
) {
  return [...left]
    .flatMap(([championId, leftTotals]) => {
      const rightTotals = right.get(championId);
      return rightTotals === undefined
        ? []
        : [
            {
              championId,
              championName: leftTotals.name,
              left: leftTotals.tally,
              right: rightTotals.tally,
            },
          ];
    })
    .toSorted(
      (a, b) =>
        b.left.games + b.right.games - (a.left.games + a.right.games) ||
        a.championName.localeCompare(b.championName) ||
        a.championId - b.championId,
    )
    .slice(0, COMPARE_CHAMPION_LIMIT);
}

function soloRank(person: ComparedPerson, ranks: Map<LeaguePuuid, PuuidRanks>) {
  return (
    freshest(person.puuids.map((puuid) => ranks.get(puuid)?.solo))?.rank ?? null
  );
}

/**
 * Two players side by side, on one lake slot: each one's solo rank and last
 * twenty games, their games on the same team, their games against each other
 * and the champions both play. Each person's accounts count once; `against`
 * is an empty list when they never met.
 */
export async function getConsumerCompare(input: {
  guildIds: DiscordGuildId[];
  leftId: number;
  rightId: number;
  viewerDiscordId: DiscordAccountId;
}) {
  const [left, right] = await resolveComparedPeople(input);
  const puuids = [...left.puuids, ...right.puuids];
  const lake = await withLakePage(undefined, async (page) => ({
    games: await readRosterGames(page, {
      puuids,
      newestPerAccount: ROSTER_FORM_GAMES,
    }),
    champions: await readAccountChampions(page, {
      puuids,
      queues: STANDARD_COMMUNITY_QUEUES,
    }),
    shared: await readGuildMatchRows(page, {
      puuids,
      queues: STANDARD_COMMUNITY_QUEUES,
      bothOf: { left: left.puuids, right: right.puuids },
    }),
  }));
  const ranks = await latestRanksByPuuid(puuids);
  const history = duoHistory({
    players: [left, right],
    rows: lake.shared,
    playerIds: [left.id, right.id],
  });
  const side = (person: ComparedPerson) => ({
    playerId: person.id,
    alias: person.alias,
    isYou: person.isYou,
    rank: soloRank(person, ranks),
    form: recentForm(person, lake.games),
  });
  return {
    left: side(left),
    right: side(right),
    together: {
      games: history.together.games,
      wins: history.together.wins,
      matches: history.together.matches.map((match) => ({
        matchId: RiotMatchIdSchema.parse(match.matchId),
        gameCreationMs: match.at,
        win: match.win,
      })),
    },
    against: history.against.map((match) => ({
      matchId: RiotMatchIdSchema.parse(match.matchId),
      gameCreationMs: match.at,
      winner: match.winner,
    })),
    champions: sharedChampions(
      championTotals(left, lake.champions),
      championTotals(right, lake.champions),
    ),
  };
}
