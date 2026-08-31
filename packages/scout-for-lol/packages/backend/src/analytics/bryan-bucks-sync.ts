import {
  BucksLedgerKindSchema,
  OPEN_BUCKS_DARE_STATES,
} from "@scout-for-lol/data";
import {
  captureBucksEconomy,
  captureBucksEconomySnapshot,
} from "#src/analytics/bryan-bucks.ts";
import {
  aggregateBucksPendingStakes,
  countBucksOpenMarkets,
} from "#src/analytics/bryan-bucks-events.ts";
import { deterministicBucksAnalyticsEventId } from "#src/analytics/bryan-bucks-backfill.ts";
import {
  getProductAnalytics,
  type ProductAnalytics,
} from "#src/analytics/product-analytics.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

export type BryanBucksAnalyticsSyncResult = {
  ledgerEntries: number;
  snapshots: number;
};

/**
 * Publish committed Bryan Bucks rows that have not reached PostHog yet.
 *
 * This is deliberately called by a Temporal activity, outside the betting
 * transaction. A ledger row is therefore visible only after its transaction
 * commits; the durable event marker and ledger outbox acknowledgement are
 * written only after the SDK queue has flushed successfully. PostHog
 * receives a deterministic UUID, so a process failure between those
 * operations is harmless on retry.
 */
export async function syncBucksAnalytics(options?: {
  prismaClient?: ExtendedPrismaClient;
  analytics?: ProductAnalytics;
  now?: Date;
}): Promise<BryanBucksAnalyticsSyncResult> {
  const database = options?.prismaClient ?? prisma;
  const analytics = options?.analytics ?? getProductAnalytics();
  const now = options?.now ?? new Date();
  const reservedRows = await database.bucksAnalyticsBackfillEvent.findMany({
    select: { eventId: true },
  });
  const reserved = new Set(reservedRows.map((row) => row.eventId));
  const outboxEntries = await database.bucksAnalyticsLedgerOutbox.findMany({
    select: {
      id: true,
      eventId: true,
      ledgerEntry: {
        select: {
          delta: true,
          balanceAfter: true,
          kind: true,
          createdAt: true,
          bucksAccount: { select: { serverId: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  const pendingLedgerEvents: {
    outboxId: number;
    eventId: string;
    captured: boolean;
  }[] = [];
  for (const outboxEntry of outboxEntries) {
    if (reserved.has(outboxEntry.eventId)) continue;
    const entry = outboxEntry.ledgerEntry;
    const captured = captureBucksEconomy({
      serverId: entry.bucksAccount.serverId,
      movement: BucksLedgerKindSchema.parse(entry.kind),
      deltaBucks: entry.delta,
      balanceAfterBucks: entry.balanceAfter,
      timestamp: entry.createdAt,
      uuid: outboxEntry.eventId,
      analytics,
    });
    pendingLedgerEvents.push({
      outboxId: outboxEntry.id,
      eventId: outboxEntry.eventId,
      captured,
    });
  }

  const [
    accounts,
    pendingOutcome,
    pendingParlay,
    pendingWeekly,
    pendingDareContributions,
    openPools,
  ] = await Promise.all([
    database.bucksAccount.findMany({
      select: { serverId: true, isHouse: true, balance: true },
    }),
    database.bucksBet.findMany({
      where: { betOutcome: "pending" },
      select: {
        stake: true,
        matchedStake: true,
        bucksAccount: { select: { serverId: true } },
      },
    }),
    database.bucksParlayBet.findMany({
      where: { betOutcome: "pending" },
      select: { stake: true, bucksAccount: { select: { serverId: true } } },
    }),
    database.bucksWeeklyParlayBet.findMany({
      where: { betOutcome: "pending" },
      select: { stake: true, bucksAccount: { select: { serverId: true } } },
    }),
    // A dare's pot is contributor money at risk until the dare resolves —
    // the same "pending stake" the outcome/parlay/weekly sources measure.
    database.bucksDareContribution.findMany({
      where: { dare: { dareState: { in: [...OPEN_BUCKS_DARE_STATES] } } },
      select: { amount: true, bucksAccount: { select: { serverId: true } } },
    }),
    database.bucksMatchPool.findMany({
      where: { poolState: { in: ["open", "closed"] } },
      select: { serverId: true },
    }),
  ]);
  const pendingDare = pendingDareContributions.map((contribution) => ({
    stake: contribution.amount,
    bucksAccount: contribution.bucksAccount,
  }));
  const pendingByServer = aggregateBucksPendingStakes(
    pendingOutcome,
    pendingParlay,
    pendingWeekly,
    pendingDare,
  );
  const openMarketsByServer = countBucksOpenMarkets(openPools);
  const bucket = Math.floor(now.getTime() / SNAPSHOT_INTERVAL_MS).toString();
  const pendingSnapshotEvents: {
    eventId: string;
    captured: boolean;
  }[] = [];
  const serverIds = new Set([
    ...accounts.map((account) => account.serverId),
    ...openPools.map((pool) => pool.serverId),
  ]);
  for (const serverId of serverIds) {
    const eventId = deterministicBucksAnalyticsEventId(
      "live-snapshot",
      serverId,
      bucket,
    );
    if (reserved.has(eventId)) continue;
    const serverAccounts = accounts.filter(
      (account) => account.serverId === serverId,
    );
    const captured = captureBucksEconomySnapshot({
      serverId,
      memberAccounts: serverAccounts.filter((account) => !account.isHouse)
        .length,
      totalMemberBalanceBucks: serverAccounts
        .filter((account) => !account.isHouse)
        .reduce((total, account) => total + account.balance, 0),
      pendingStakeBucks: pendingByServer.get(serverId) ?? 0,
      houseBalanceBucks: serverAccounts
        .filter((account) => account.isHouse)
        .reduce((total, account) => total + account.balance, 0),
      openMarkets: openMarketsByServer.get(serverId) ?? 0,
      timestamp: now,
      uuid: eventId,
      analytics,
    });
    pendingSnapshotEvents.push({ eventId, captured });
  }

  const pendingEvents = [
    ...pendingLedgerEvents.filter((event) => event.captured),
    ...pendingSnapshotEvents.filter((event) => event.captured),
  ];
  if (pendingEvents.length === 0) {
    return { ledgerEntries: 0, snapshots: 0 };
  }
  const flushed = await (analytics.flush?.() ?? Promise.resolve(true));
  if (!flushed) {
    return { ledgerEntries: 0, snapshots: 0 };
  }
  await database.bucksAnalyticsBackfillEvent.createMany({
    data: pendingEvents.map((event) => ({ eventId: event.eventId })),
    skipDuplicates: true,
  });
  const acknowledgedOutboxIds = pendingLedgerEvents
    .filter((event) => event.captured)
    .map((event) => event.outboxId);
  if (acknowledgedOutboxIds.length > 0) {
    await database.bucksAnalyticsLedgerOutbox.deleteMany({
      where: { id: { in: acknowledgedOutboxIds } },
    });
  }
  return {
    ledgerEntries: pendingLedgerEvents.filter((event) => event.captured).length,
    snapshots: pendingSnapshotEvents.filter((event) => event.captured).length,
  };
}
