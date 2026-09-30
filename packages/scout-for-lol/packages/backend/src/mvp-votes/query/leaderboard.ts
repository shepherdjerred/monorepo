import { z } from "zod";
import {
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  MatchIdSchema,
  type DiscordGuildId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { mvpQueryDisplayName } from "#src/mvp-votes/query/names.ts";
import { MatchMvpRosterSchema } from "#src/mvp-votes/roster.ts";

export const MvpVoteQueueTypeSchema = z.enum(["flex"]);
export type MvpVoteQueueType = z.infer<typeof MvpVoteQueueTypeSchema>;

export const MvpVoteLeaderboardQuerySchema = z.strictObject({
  serverId: DiscordGuildIdSchema,
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  queueType: MvpVoteQueueTypeSchema.optional(),
  limit: z.number().int().min(1).max(50).default(25),
});

export type MvpVoteLeaderboardQuery = z.input<
  typeof MvpVoteLeaderboardQuerySchema
>;

export const MvpVoteLeaderboardRowSchema = z.strictObject({
  nomineePuuid: LeaguePuuidSchema,
  displayName: z.string().min(1),
  voteCount: z.number().int().positive(),
  matchCount: z.number().int().positive(),
});

export const MvpVoteLeaderboardResultSchema = z.strictObject({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  queueType: MvpVoteQueueTypeSchema.nullable(),
  totalVotes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  rows: z.array(MvpVoteLeaderboardRowSchema),
});

export type MvpVoteLeaderboardResult = z.infer<
  typeof MvpVoteLeaderboardResultSchema
>;

type NomineeAgg = {
  voteCount: number;
  matchIds: Set<string>;
};

function emptyLeaderboard(
  parsed: z.infer<typeof MvpVoteLeaderboardQuerySchema>,
): MvpVoteLeaderboardResult {
  return {
    from: parsed.from,
    to: parsed.to,
    queueType: parsed.queueType ?? null,
    totalVotes: 0,
    truncated: false,
    rows: [],
  };
}

async function displayNamesForNominees(
  input: {
    serverId: DiscordGuildId;
    puuids: readonly LeaguePuuid[];
    sampleMatchIdByPuuid: ReadonlyMap<LeaguePuuid, string>;
  },
  prismaClient: ExtendedPrismaClient,
): Promise<Map<LeaguePuuid, string>> {
  const names = new Map<LeaguePuuid, string>();
  if (input.puuids.length === 0) {
    return names;
  }
  const accounts = await prismaClient.account.findMany({
    where: {
      serverId: input.serverId,
      puuid: { in: [...input.puuids] },
    },
    select: { puuid: true, player: { select: { alias: true } } },
  });
  const aliases = new Map<LeaguePuuid, string>();
  for (const account of accounts) {
    const puuid = LeaguePuuidSchema.parse(account.puuid);
    aliases.set(puuid, account.player.alias);
  }
  const missing = input.puuids.filter((puuid) => {
    const alias = aliases.get(puuid);
    return alias === undefined || alias.trim().length === 0;
  });
  const matchIds = [
    ...new Set(
      missing.flatMap((puuid) => {
        const matchId = input.sampleMatchIdByPuuid.get(puuid);
        return matchId === undefined ? [] : [matchId];
      }),
    ),
  ];
  const contests =
    matchIds.length === 0
      ? []
      : await prismaClient.matchMvpContest.findMany({
          where: { matchId: { in: matchIds } },
          select: { matchId: true, roster: true },
        });
  const rosterByMatchId = new Map(
    contests.map((contest) => [
      contest.matchId,
      MatchMvpRosterSchema.parse(contest.roster),
    ]),
  );
  for (const puuid of input.puuids) {
    const alias = aliases.get(puuid);
    if (alias !== undefined && alias.trim().length > 0) {
      names.set(puuid, alias.trim());
      continue;
    }
    const matchId = input.sampleMatchIdByPuuid.get(puuid);
    if (matchId === undefined) {
      throw new Error(
        `Match MVP leaderboard has votes for ${puuid} with no sample match`,
      );
    }
    const roster = rosterByMatchId.get(matchId);
    if (roster === undefined) {
      throw new Error(
        `Match MVP leaderboard sample contest ${matchId} is missing for ${puuid}`,
      );
    }
    names.set(puuid, mvpQueryDisplayName(puuid, roster, aliases));
  }
  return names;
}

/**
 * Guild-scoped community MVP leaderboard. Date bounds are UTC match
 * `gameCreationAt` on the contest, not vote-cast time.
 */
export async function loadMvpVoteLeaderboard(
  input: MvpVoteLeaderboardQuery,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<MvpVoteLeaderboardResult> {
  const parsed = MvpVoteLeaderboardQuerySchema.parse(input);
  const from = new Date(parsed.from);
  const to = new Date(parsed.to);
  if (!(from.getTime() < to.getTime())) {
    throw new Error("MVP vote leaderboard requires from < to.");
  }
  const contests = await prismaClient.matchMvpContest.findMany({
    where: {
      gameCreationAt: { gte: from, lt: to },
      ...(parsed.queueType === undefined
        ? {}
        : { queueType: parsed.queueType }),
    },
    select: { matchId: true },
  });
  if (contests.length === 0) {
    return emptyLeaderboard(parsed);
  }
  const matchIds = contests.map((contest) =>
    MatchIdSchema.parse(contest.matchId),
  );
  const votes = await prismaClient.matchMvpVote.findMany({
    where: {
      serverId: parsed.serverId,
      matchId: { in: matchIds },
      nomineePuuid: { not: null },
    },
    select: { nomineePuuid: true, matchId: true },
  });
  const byNominee = new Map<LeaguePuuid, NomineeAgg>();
  for (const vote of votes) {
    const nomineePuuid = LeaguePuuidSchema.parse(vote.nomineePuuid);
    const existing = byNominee.get(nomineePuuid);
    if (existing === undefined) {
      byNominee.set(nomineePuuid, {
        voteCount: 1,
        matchIds: new Set([vote.matchId]),
      });
      continue;
    }
    existing.voteCount += 1;
    existing.matchIds.add(vote.matchId);
  }
  const ranked = [...byNominee.entries()].toSorted((left, right) => {
    return right[1].voteCount === left[1].voteCount
      ? left[0].localeCompare(right[0])
      : right[1].voteCount - left[1].voteCount;
  });
  const truncated = ranked.length > parsed.limit;
  const top = ranked.slice(0, parsed.limit);
  const sampleMatchIdByPuuid = new Map(
    top.map(([puuid, agg]) => {
      const sample = [...agg.matchIds][0];
      if (sample === undefined) {
        throw new Error(
          `Match MVP leaderboard nominee ${puuid} has votes but no match ids`,
        );
      }
      return [puuid, sample] as const;
    }),
  );
  const names = await displayNamesForNominees(
    {
      serverId: parsed.serverId,
      puuids: top.map(([puuid]) => puuid),
      sampleMatchIdByPuuid,
    },
    prismaClient,
  );
  return MvpVoteLeaderboardResultSchema.parse({
    from: parsed.from,
    to: parsed.to,
    queueType: parsed.queueType ?? null,
    totalVotes: votes.length,
    truncated,
    rows: top.map(([nomineePuuid, agg]) => {
      const displayName = names.get(nomineePuuid);
      if (displayName === undefined) {
        throw new Error(
          `Match MVP leaderboard failed to name nominee ${nomineePuuid}`,
        );
      }
      return {
        nomineePuuid,
        displayName,
        voteCount: agg.voteCount,
        matchCount: agg.matchIds.size,
      };
    }),
  });
}
