import {
  DiscordGuildIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { listLiveGames } from "#src/live-roster/live-roster-view.ts";
import { latestRanksByPuuid } from "#src/lib/player-profile/profile-resolution.ts";
import {
  freshest,
  ROSTER_FORM_GAMES,
  runOfSameResult,
} from "#src/lib/player-profile/roster.ts";
import { withLakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { readRosterGames } from "#src/reports/duckdb/consumer/pages/roster-lake-reads.ts";
import { readHomeChallenge } from "#src/trpc/router/consumer/home/home-challenge.ts";
import {
  buildHomeFeed,
  HOME_FEED_DAYS,
} from "#src/trpc/router/consumer/home/home-feed.ts";
import {
  resolveHomePeople,
  type HomePerson,
} from "#src/trpc/router/consumer/home/home-people.ts";
import {
  buildClimbers,
  readRankMoves,
} from "#src/trpc/router/consumer/home/home-ranks.ts";

const DAY_MS = 86_400_000;

async function liveHero(input: {
  guildIds: ReturnType<typeof DiscordGuildIdSchema.parse>[];
  people: readonly HomePerson[];
  now: Date;
}) {
  const [game] = await listLiveGames(input.guildIds, input.now);
  if (game === undefined) return null;
  const byPlayerId = new Map(
    input.people.flatMap((person) =>
      person.playerIds.map((id) => [id, person] as const),
    ),
  );
  // One entry per person: someone tracked in two servers is one friend.
  const friends = [
    ...new Map(
      game.friends.flatMap((friend) => {
        const person = byPlayerId.get(friend.playerId);
        return person === undefined
          ? []
          : [
              [
                person.playerId,
                {
                  playerId: person.playerId,
                  alias: person.alias,
                  isYou: person.isYou,
                  championId: friend.championId,
                  lane: friend.lane,
                },
              ] as const,
            ];
      }),
    ).values(),
  ].toSorted((left, right) => left.playerId - right.playerId);
  return {
    riotMatchId: game.riotMatchId,
    queueId: game.queueId,
    startedAt: game.startedAt,
    detectedAt: game.detectedAt,
    friends,
  };
}

async function youPanel(person: HomePerson | undefined) {
  if (person === undefined) return null;
  const ranks = await latestRanksByPuuid([...person.puuids]);
  const personRanks = [...person.puuids].map((puuid) => ranks.get(puuid));
  const form = person.games.slice(0, ROSTER_FORM_GAMES);
  return {
    playerId: person.playerId,
    alias: person.alias,
    rank: {
      solo: freshest(personRanks.map((entry) => entry?.solo))?.rank ?? null,
      flex: freshest(personRanks.map((entry) => entry?.flex))?.rank ?? null,
    },
    form:
      form.length === 0
        ? null
        : {
            games: form.length,
            wins: form.filter((game) => game.win).length,
            streak: runOfSameResult(form),
          },
  };
}

export type HomeOverviewInput = {
  viewer: { discordId: DiscordAccountId; discordUsername: string };
  guilds: { id: string; name: string }[];
};

/**
 * The Home page: what the viewer's friends have been doing across every server
 * the viewer can see. One lake slot reads each tracked account's recent games;
 * ranks, rank changes, the live game and the viewer's challenge come from
 * PostgreSQL alone. Nothing is stored for the viewer: the feed, the climbers
 * and the You panel are derived on each request.
 */
export async function getConsumerHome(input: HomeOverviewInput) {
  const guilds = input.guilds
    .map((guild) => ({
      id: DiscordGuildIdSchema.parse(guild.id),
      name: guild.name,
    }))
    .toSorted(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
  const guildIds = guilds.map((guild) => guild.id);
  const now = new Date();
  const sinceMs = now.getTime() - HOME_FEED_DAYS * DAY_MS;

  const players = await prisma.player.findMany({
    where: { serverId: { in: guildIds } },
    select: {
      id: true,
      alias: true,
      serverId: true,
      discordId: true,
      accounts: { select: { puuid: true } },
    },
  });
  const puuids = [
    ...new Set(
      players.flatMap((player) =>
        player.accounts.map((account) => account.puuid),
      ),
    ),
  ];
  const [games, moves, challenge] = await Promise.all([
    withLakePage(
      undefined,
      async (page) =>
        await readRosterGames(page, {
          puuids,
          newestPerAccount: ROSTER_FORM_GAMES,
          sinceMs,
        }),
    ),
    readRankMoves({ puuids, sinceMs }),
    readHomeChallenge({
      viewerDiscordId: input.viewer.discordId,
      guildIds,
    }),
  ]);
  const people = resolveHomePeople({
    players,
    games,
    viewerDiscordId: input.viewer.discordId,
  });
  const viewer = people.find((person) => person.isYou);
  const [live, you] = await Promise.all([
    liveHero({ guildIds, people, now }),
    youPanel(viewer),
  ]);
  return {
    viewer: {
      name: viewer?.alias ?? input.viewer.discordUsername,
      playerId: viewer?.playerId ?? null,
    },
    guilds,
    live,
    feed: buildHomeFeed({ people, moves, nowMs: now.getTime() }),
    you,
    climbers: buildClimbers(people, moves),
    challenge,
  };
}
