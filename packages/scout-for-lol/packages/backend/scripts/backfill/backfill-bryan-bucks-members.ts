import { prisma } from "#src/database/index.ts";
import {
  getProductAnalytics,
  type ProductAnalytics,
} from "#src/analytics/product-analytics.ts";
import { deterministicBucksAnalyticsEventId } from "#src/analytics/bryan-bucks-backfill.ts";

type MemberBet = {
  id: number;
  bucksAccountId: number;
  createdAt: Date;
};

type MemberBetKind = "outcome_bet" | "parlay_bet" | "weekly_parlay_bet";
type MemberBetSource = "direct-bet" | "parlay-bet" | "weekly-parlay-bet";
type BackfillCapture = (eventId: string, callback: () => void) => Promise<void>;
type BucksAccount = { analyticsUserId: string; serverId: string };

function eventUuid(kind: string, id: number): string {
  return deterministicBucksAnalyticsEventId(kind, id);
}

function eventOptions(kind: string, id: number, timestamp: Date) {
  return { timestamp, uuid: eventUuid(kind, id) };
}

async function forEachAsync<T>(
  items: readonly T[],
  callback: (item: T) => Promise<void>,
): Promise<void> {
  for (const item of items) await callback(item);
}

async function captureMemberBet(input: {
  bet: MemberBet;
  source: MemberBetSource;
  activityKind: MemberBetKind;
  accountById: ReadonlyMap<number, BucksAccount>;
  analytics: ProductAnalytics;
  capture: BackfillCapture;
}): Promise<void> {
  const account = input.accountById.get(input.bet.bucksAccountId);
  if (account === undefined) return;
  await input.capture(eventUuid(input.source, input.bet.id), () => {
    input.analytics.captureBucksMember(
      {
        analyticsUserId: account.analyticsUserId,
        serverId: account.serverId,
      },
      {
        event: "bryan_bucks_member_activity",
        properties: {
          activity_kind: input.activityKind,
          surface: "unknown",
          status: "success",
        },
      },
      eventOptions(input.source, input.bet.id, input.bet.createdAt),
    );
  });
}

export async function backfillMemberBets(input: {
  launchBoundary: Date;
  liveCaptureBoundary: Date;
  accountById: ReadonlyMap<number, BucksAccount>;
  analytics?: ProductAnalytics;
  capture: BackfillCapture;
}): Promise<{
  directBets: number;
  parlayBets: number;
  weeklyParlayBets: number;
}> {
  const analytics = input.analytics ?? getProductAnalytics();
  const createdAt = {
    gte: input.launchBoundary,
    lt: input.liveCaptureBoundary,
  };
  const directBets = await prisma.bucksBet.findMany({
    where: { createdAt, bucksAccount: { isHouse: false } },
    select: { id: true, bucksAccountId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  await forEachAsync(directBets, (bet) =>
    captureMemberBet({
      bet,
      source: "direct-bet",
      activityKind: "outcome_bet",
      accountById: input.accountById,
      analytics,
      capture: input.capture,
    }),
  );

  const parlayBets = await prisma.bucksParlayBet.findMany({
    where: { createdAt, bucksAccount: { isHouse: false } },
    select: { id: true, bucksAccountId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  await forEachAsync(parlayBets, (bet) =>
    captureMemberBet({
      bet,
      source: "parlay-bet",
      activityKind: "parlay_bet",
      accountById: input.accountById,
      analytics,
      capture: input.capture,
    }),
  );

  const weeklyParlayBets = await prisma.bucksWeeklyParlayBet.findMany({
    where: { createdAt, bucksAccount: { isHouse: false } },
    select: { id: true, bucksAccountId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  await forEachAsync(weeklyParlayBets, (bet) =>
    captureMemberBet({
      bet,
      source: "weekly-parlay-bet",
      activityKind: "weekly_parlay_bet",
      accountById: input.accountById,
      analytics,
      capture: input.capture,
    }),
  );

  return {
    directBets: directBets.length,
    parlayBets: parlayBets.length,
    weeklyParlayBets: weeklyParlayBets.length,
  };
}
