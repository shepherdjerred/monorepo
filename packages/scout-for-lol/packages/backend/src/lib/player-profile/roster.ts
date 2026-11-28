import {
  DiscordGuildIdSchema,
  rankToLeaguePoints,
  type DiscordAccountId,
  type DiscordGuildId,
  type LeaguePuuid,
  type Rank,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma } from "#src/database/index.ts";
import type { PlayerStreak } from "#src/lib/player-profile/behavior.ts";
import {
  latestRanksByPuuid,
  type PuuidRanks,
  type RankEvidence,
} from "#src/lib/player-profile/profile-resolution.ts";
import { withLakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import {
  readRosterGames,
  type RosterGameRow,
} from "#src/reports/duckdb/consumer/pages/roster-lake-reads.ts";
import { readMatchSupport } from "#src/reports/duckdb/community/match-support.ts";
import {
  listLivePrematchCaptures,
  resolveLivePrematchGames,
  type LivePrematchGame,
} from "#src/temporal/prematch/prematch-reads.ts";

/** Newest games read per account: the form window. */
export const ROSTER_FORM_GAMES = 20;
const DAY_MS = 86_400_000;
export const ROSTER_ACTIVITY_DAYS = 7;

type RosterPlayerRow = {
  id: number;
  alias: string;
  serverId: DiscordGuildId;
  discordId: DiscordAccountId | null;
  accounts: { puuid: LeaguePuuid }[];
};

type RosterGuild = { id: DiscordGuildId; name: string };

/**
 * One person for each connected set of Player rows. A person tracked in two
 * servers is two Player rows, and one with two Riot accounts is one row with
 * two accounts; both collapse here, joined by a shared Discord link or a
 * shared PUUID.
 */
function groupPeople(players: RosterPlayerRow[]): RosterPlayerRow[][] {
  const parent = players.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root] ?? root;
    return root;
  };
  const owner = new Map<string, number>();
  for (const [index, player] of players.entries()) {
    const keys = [
      ...(player.discordId === null ? [] : [`discord:${player.discordId}`]),
      ...player.accounts.map((account) => `puuid:${account.puuid}`),
    ];
    for (const key of keys) {
      const first = owner.get(key);
      if (first === undefined) owner.set(key, index);
      else parent[find(index)] = find(first);
    }
  }
  const people = new Map<number, RosterPlayerRow[]>();
  for (const [index, player] of players.entries()) {
    const root = find(index);
    people.set(root, [...(people.get(root) ?? []), player]);
  }
  return [...people.values()];
}

function freshest(
  evidence: (RankEvidence | undefined)[],
): RankEvidence | undefined {
  return evidence
    .filter((entry) => entry !== undefined)
    .toSorted((left, right) => right.at.getTime() - left.at.getTime())[0];
}

function runOfSameResult(games: { win: boolean }[]): PlayerStreak | null {
  const first = games[0];
  if (first === undefined) return null;
  const run = games.findIndex((game) => game.win !== first.win);
  return {
    result: first.win ? "win" : "loss",
    games: run === -1 ? games.length : run,
    atLeast: run === -1 && games.length === ROSTER_FORM_GAMES,
  };
}

function soloPoints(rank: Rank | null): number {
  return rank === null ? -1 : rankToLeaguePoints(rank);
}

export function buildRoster(input: {
  players: RosterPlayerRow[];
  guilds: RosterGuild[];
  viewerDiscordId: DiscordAccountId;
  games: RosterGameRow[];
  ranks: Map<LeaguePuuid, PuuidRanks>;
  live: readonly LivePrematchGame[];
  nowMs: number;
}) {
  const guildById = new Map(input.guilds.map((guild) => [guild.id, guild]));
  const gamesByPuuid = new Map<string, RosterGameRow[]>();
  for (const game of input.games) {
    gamesByPuuid.set(game.puuid, [
      ...(gamesByPuuid.get(game.puuid) ?? []),
      game,
    ]);
  }
  const sinceMs = input.nowMs - ROSTER_ACTIVITY_DAYS * DAY_MS;

  const people = groupPeople(input.players).map((members) => {
    const sorted = members.toSorted((left, right) => left.id - right.id);
    const primary = sorted[0];
    if (primary === undefined) throw new Error("A roster person has no player");
    const puuids = new Set(
      members.flatMap((member) => member.accounts.map((a) => a.puuid)),
    );
    const games = [
      ...new Map(
        [...puuids]
          .flatMap((puuid) => gamesByPuuid.get(puuid) ?? [])
          .toSorted(
            (left, right) =>
              right.game_creation_ms - left.game_creation_ms ||
              right.match_id.localeCompare(left.match_id),
          )
          .map((game) => [game.match_id, game] as const),
      ).values(),
    ];
    const form = games.slice(0, ROSTER_FORM_GAMES);
    const latest = games[0];
    const personRanks = [...puuids].map((puuid) => input.ranks.get(puuid));
    const liveGame = input.live
      .filter((game) =>
        game.participants.some((participant) => puuids.has(participant.puuid)),
      )
      .toSorted(
        (left, right) => right.detectedAt.getTime() - left.detectedAt.getTime(),
      )[0];
    const liveParticipant = liveGame?.participants.find((participant) =>
      puuids.has(participant.puuid),
    );
    return {
      playerId: primary.id,
      alias: primary.alias,
      isYou: members.some(
        (member) => member.discordId === input.viewerDiscordId,
      ),
      accountCount: puuids.size,
      memberships: sorted
        .map((member) => {
          const guild = guildById.get(
            DiscordGuildIdSchema.parse(member.serverId),
          );
          if (guild === undefined) {
            throw new Error(
              "A roster player resolved outside the viewer's servers",
            );
          }
          return { playerId: member.id, guild };
        })
        .toSorted(
          (left, right) =>
            left.guild.name.localeCompare(right.guild.name) ||
            left.guild.id.localeCompare(right.guild.id),
        ),
      rank: {
        solo: freshest(personRanks.map((ranks) => ranks?.solo))?.rank ?? null,
        flex: freshest(personRanks.map((ranks) => ranks?.flex))?.rank ?? null,
      },
      latestGame:
        latest === undefined
          ? null
          : {
              matchId: RiotMatchIdSchema.parse(latest.match_id),
              win: latest.win,
              championId: latest.champion_id,
              championName: latest.champion_name,
              queue: latest.queue,
              queueId: latest.queue_id,
              gameCreationMs: latest.game_creation_ms,
            },
      live:
        liveGame === undefined || liveParticipant === undefined
          ? null
          : {
              gameId: liveGame.gameId,
              queueId: liveGame.queueId,
              championId: liveParticipant.championId,
              detectedAt: liveGame.detectedAt,
            },
      lastSevenDays: {
        games: games.filter((game) => game.game_creation_ms >= sinceMs).length,
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
  });

  return {
    guilds: input.guilds.toSorted(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    ),
    // Highest Solo/Duo rank first, unranked last; then the most recent game,
    // then name and id, so the order never shifts between requests.
    players: people.toSorted(
      (left, right) =>
        soloPoints(right.rank.solo) - soloPoints(left.rank.solo) ||
        (right.latestGame?.gameCreationMs ?? 0) -
          (left.latestGame?.gameCreationMs ?? 0) ||
        left.alias.toLowerCase().localeCompare(right.alias.toLowerCase()) ||
        left.playerId - right.playerId,
    ),
  };
}

/**
 * Everyone the viewer can see across their servers, on one lake slot: rank,
 * latest game, live status and the last seven days of games. The viewer's
 * `guilds` come from `assertConsumerPlayerScope`; nothing outside them is read.
 */
export async function getConsumerRoster(input: {
  guilds: { id: string; name: string }[];
  viewerDiscordId: DiscordAccountId;
}) {
  const guilds = input.guilds.map((guild) => ({
    id: DiscordGuildIdSchema.parse(guild.id),
    name: guild.name,
  }));
  const now = new Date();
  const [players, captures] = await Promise.all([
    prisma.player.findMany({
      where: { serverId: { in: guilds.map((guild) => guild.id) } },
      select: {
        id: true,
        alias: true,
        serverId: true,
        discordId: true,
        accounts: { select: { puuid: true } },
      },
    }),
    listLivePrematchCaptures(now),
  ]);
  const puuids = [
    ...new Set(
      players.flatMap((player) => player.accounts.map((a) => a.puuid)),
    ),
  ];
  const lake = await withLakePage(undefined, async (page) => {
    const games = await readRosterGames(page, {
      puuids,
      newestPerAccount: ROSTER_FORM_GAMES,
      sinceMs: now.getTime() - ROSTER_ACTIVITY_DAYS * DAY_MS,
    });
    // A capture the lake already holds is a finished game.
    const completed = await readMatchSupport(page, {
      matchIds: captures.map((capture) => capture.riotMatchId),
    });
    return { games, completed: new Set(completed.map((m) => m.match_id)) };
  });
  const [ranks, live] = await Promise.all([
    latestRanksByPuuid(puuids),
    resolveLivePrematchGames(captures, lake.completed),
  ]);
  const visible = new Set(puuids);
  return buildRoster({
    players,
    guilds,
    viewerDiscordId: input.viewerDiscordId,
    games: lake.games,
    ranks,
    live: live.filter((game) =>
      game.participants.some((participant) => visible.has(participant.puuid)),
    ),
    nowMs: now.getTime(),
  });
}
