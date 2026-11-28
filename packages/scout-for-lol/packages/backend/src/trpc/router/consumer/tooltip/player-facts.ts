import type { User } from "#generated/prisma/client/index.js";
import { notFound } from "#src/lib/player-admin/shared.ts";
import { latestRanksByPuuid } from "#src/lib/player-profile/profile-resolution.ts";
import { freshest } from "#src/lib/player-profile/roster.ts";
import { withLakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import {
  readSharedGames,
  type SharedGameRow,
} from "#src/reports/duckdb/consumer/pages/tooltip-reads.ts";
import { readPlayerMatchHistory } from "#src/reports/duckdb/lake-reads.ts";
import {
  getChampionPagePeople,
  type ChampionPagePerson,
} from "#src/trpc/router/consumer/consumer-champion-people.ts";
import { STANDARD_COMMUNITY_QUEUES } from "#src/trpc/router/consumer/standard-rift.ts";
import {
  DAY_MS,
  TOOLTIP_WINDOW_DAYS,
} from "#src/trpc/router/consumer/tooltip/champion-facts.ts";

/** Results listed for the games the viewer and the player won or lost together. */
export const TOGETHER_RESULTS = 10;

function entryOf(person: ChampionPagePerson) {
  return { entryKey: person.playerId.toString(), puuids: person.puuids };
}

function togetherOf(games: readonly SharedGameRow[]) {
  return games.length === 0
    ? null
    : {
        games: games.length,
        wins: games.filter((game) => game.win).length,
        /** Newest first. */
        results: games.slice(0, TOGETHER_RESULTS).map((game) => game.win),
      };
}

/**
 * What Scout knows about a player for a hover: their Solo/Duo (else Flex)
 * rank, their latest game, and the games the viewer and they won or lost on
 * the same team, over the last {@link TOOLTIP_WINDOW_DAYS} days. The player
 * must be one of the people in the viewer's consumer scope, or the answer is
 * the same as for a player that does not exist.
 *
 * Ranks come from PostgreSQL. The latest game and the shared games are two
 * statements on one lake slot.
 */
export async function getPlayerTooltipFacts(input: {
  user: User;
  playerId: number;
  nowMs: number;
}) {
  const { people } = await getChampionPagePeople(input.user, undefined);
  const person = people.find((candidate) =>
    candidate.playerIds.includes(input.playerId),
  );
  if (person === undefined) throw notFound("Player was not found");
  const viewer = people.find((candidate) => candidate.isViewer);
  const sinceMs = input.nowMs - TOOLTIP_WINDOW_DAYS * DAY_MS;

  const [ranks, lake] = await Promise.all([
    latestRanksByPuuid(person.puuids),
    withLakePage(undefined, async (page) => {
      const [latest] = await readPlayerMatchHistory(page, {
        puuids: person.puuids,
        limit: 1,
        afterMs: sinceMs,
      });
      const shared =
        viewer === undefined || viewer === person
          ? []
          : await readSharedGames(page, {
              first: entryOf(viewer),
              second: entryOf(person),
              queues: STANDARD_COMMUNITY_QUEUES,
              sinceMs,
            });
      return { latest, shared };
    }),
  ]);

  const personRanks = person.puuids.map((puuid) => ranks.get(puuid));
  const solo = freshest(personRanks.map((entry) => entry?.solo));
  const flex = freshest(personRanks.map((entry) => entry?.flex));
  const ranked =
    solo === undefined
      ? flex === undefined
        ? undefined
        : ({ queue: "flex", rank: flex.rank } as const)
      : ({ queue: "solo", rank: solo.rank } as const);

  return {
    kind: "player" as const,
    player: {
      playerId: person.playerId,
      alias: person.alias,
      isViewer: person.isViewer,
      guilds: person.guilds,
    },
    windowDays: TOOLTIP_WINDOW_DAYS,
    rank:
      ranked === undefined
        ? null
        : {
            queue: ranked.queue,
            tier: ranked.rank.tier,
            division: ranked.rank.division,
            leaguePoints: ranked.rank.lp,
          },
    latestGame:
      lake.latest === undefined
        ? null
        : {
            matchId: lake.latest.match_id,
            win: lake.latest.win,
            championId: lake.latest.champion_id,
            championName: lake.latest.champion_name,
            kills: lake.latest.kills,
            deaths: lake.latest.deaths,
            assists: lake.latest.assists,
            queue: lake.latest.queue,
            gameCreationMs: lake.latest.game_creation_ms,
          },
    together: togetherOf(lake.shared),
  };
}
