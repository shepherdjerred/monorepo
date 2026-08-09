/** Read-side queries backing the karma commands. Every one is scoped to a
 *  guild — karma has been per-guild since the multi-server migration, and a
 *  query that forgets the scope silently mixes servers together. */
import { prisma } from "#src/db/index.ts";
import type { LeaderboardKind } from "#src/karma/leaderboard-kinds.ts";
import {
  type KarmaCount,
  type LeaderboardPeriod,
  periodStart,
  rankLeaderboard,
  type RankedEntry,
} from "#src/karma/scoring.ts";

function windowFilter(period: LeaderboardPeriod, now: Date) {
  const since = periodStart(period, now);
  return since === undefined ? {} : { datetime: { gte: since } };
}

/**
 * Ranked totals for a guild.
 *
 * `given` exists because the legacy schema carried a `karma_given` view that
 * nothing ever queried — and with 17 givers against 45 receivers, recognizing
 * generosity is the lever that matters.
 */
export async function getLeaderboard(params: {
  guildId: string;
  kind: LeaderboardKind;
  period: LeaderboardPeriod;
  now?: Date;
}): Promise<RankedEntry[]> {
  const now = params.now ?? new Date();
  const column = params.kind === "received" ? "receiverId" : "giverId";
  const rows = await prisma.karma.groupBy({
    by: [column],
    where: { guildId: params.guildId, ...windowFilter(params.period, now) },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
  });
  const counts: KarmaCount[] = rows.map((row) => ({
    id: row[column],
    karmaReceived: row._sum.amount ?? 0,
  }));
  return rankLeaderboard(counts);
}

export type PersonStats = {
  received: number;
  given: number;
  rank: number | null;
  entries: number;
  firstAt: Date | null;
  /** Who has given this person the most karma, if anyone has. */
  biggestFan: { id: string; total: number } | null;
};

export async function getPersonStats(
  guildId: string,
  userId: string,
): Promise<PersonStats> {
  const [receivedAgg, givenAgg, first, fans, board] = await Promise.all([
    prisma.karma.aggregate({
      _sum: { amount: true },
      _count: true,
      where: { guildId, receiverId: userId },
    }),
    prisma.karma.aggregate({
      _sum: { amount: true },
      where: { guildId, giverId: userId },
    }),
    prisma.karma.findFirst({
      where: { guildId, receiverId: userId },
      orderBy: { datetime: "asc" },
      select: { datetime: true },
    }),
    prisma.karma.groupBy({
      by: ["giverId"],
      where: { guildId, receiverId: userId, NOT: { giverId: userId } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 1,
    }),
    getLeaderboard({ guildId, kind: "received", period: "all" }),
  ]);

  const fan = fans[0];
  const entry = board.find((row) => row.id === userId);

  return {
    received: receivedAgg._sum.amount ?? 0,
    given: givenAgg._sum.amount ?? 0,
    rank: entry?.rank ?? null,
    entries: receivedAgg._count,
    firstAt: first?.datetime ?? null,
    biggestFan:
      fan === undefined
        ? null
        : { id: fan.giverId, total: fan._sum.amount ?? 0 },
  };
}

/** Karma exchanged between two specific people, both directions. */
export async function getPairwiseExchange(
  guildId: string,
  viewerId: string,
  otherId: string,
): Promise<{ viewerGave: number; otherGave: number }> {
  const [viewerGave, otherGave] = await Promise.all([
    prisma.karma.aggregate({
      _sum: { amount: true },
      where: { guildId, giverId: viewerId, receiverId: otherId },
    }),
    prisma.karma.aggregate({
      _sum: { amount: true },
      where: { guildId, giverId: otherId, receiverId: viewerId },
    }),
  ]);
  return {
    viewerGave: viewerGave._sum.amount ?? 0,
    otherGave: otherGave._sum.amount ?? 0,
  };
}

export type ReasonRow = {
  id: number;
  amount: number;
  datetime: Date;
  reason: string | null;
  giverId: string;
  receiverId: string;
};

/** Recent reasons someone was given karma for.
 *  89% of all entries carry a reason, and they are where the social value of
 *  this bot actually lives — but they were only ever visible ten at a time in
 *  an ephemeral history command. */
export async function getRecentReasons(
  guildId: string,
  userId: string,
  take = 10,
): Promise<ReasonRow[]> {
  return prisma.karma.findMany({
    where: {
      guildId,
      receiverId: userId,
      reason: { not: null },
      amount: { gt: 0 },
    },
    orderBy: { datetime: "desc" },
    take,
    select: {
      id: true,
      amount: true,
      datetime: true,
      reason: true,
      giverId: true,
      receiverId: true,
    },
  });
}

/** Keyword search across reasons. SQLite `contains` is case-insensitive for
 *  ASCII, which is all this needs. */
export async function searchReasons(
  guildId: string,
  query: string,
  take = 10,
): Promise<ReasonRow[]> {
  return prisma.karma.findMany({
    where: { guildId, reason: { contains: query } },
    orderBy: { datetime: "desc" },
    take,
    select: {
      id: true,
      amount: true,
      datetime: true,
      reason: true,
      giverId: true,
      receiverId: true,
    },
  });
}

/** The caller's most recent give, if it is still within the undo window.
 *
 *  Scoped to the caller so this can only ever retract your own give — it is a
 *  mis-click fix, not a moderation tool. Restricted to positive awards to
 *  someone else, because a self-give records a negative penalty: without this
 *  filter, giving yourself karma and immediately undoing would delete the
 *  penalty row and cancel the consequence entirely. */
export async function findUndoableGive(params: {
  guildId: string;
  giverId: string;
  withinMs: number;
  now?: Date;
}): Promise<ReasonRow | null> {
  const now = params.now ?? new Date();
  return prisma.karma.findFirst({
    where: {
      guildId: params.guildId,
      giverId: params.giverId,
      amount: { gt: 0 },
      NOT: { receiverId: params.giverId },
      datetime: { gte: new Date(now.getTime() - params.withinMs) },
    },
    orderBy: { datetime: "desc" },
    select: {
      id: true,
      amount: true,
      datetime: true,
      reason: true,
      giverId: true,
      receiverId: true,
    },
  });
}

export async function deleteKarmaById(id: number): Promise<void> {
  await prisma.karma.delete({ where: { id } });
}
