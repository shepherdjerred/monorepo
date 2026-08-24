import { BucksLedgerKindSchema } from "@scout-for-lol/data";
import {
  captureBucksEconomy,
  captureBucksEconomySnapshot,
} from "#src/analytics/bryan-bucks.ts";
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
  const reserved = new Set(
    (
      await database.bucksAnalyticsBackfillEvent.findMany({
        select: { eventId: true },
      })
    ).map((row) => row.eventId),
  );
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
  const pendingLedgerEvents: Array<{
    outboxId: number;
    eventId: string;
    captured: boolean;
  }> = [];
  for (const outboxEntry of outboxEntries) {
    if (reserved.has(outboxEntry.eventId)) continue;
    const entry = outboxEntry.ledgerEntry;
    captureBucksEconomy({
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
      captured: true,
    });
  }

  const [accounts, pendingOutcome, pendingParlay, pendingWeekly, openPools] =
    await Promise.all([
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
      database.bucksMatchPool.findMany({
        where: { poolState: { in: ["open", "closed"] } },
        select: { serverId: true },
      }),
    ]);
  const pendingByServer = new Map<string, number>();
  for (const bet of pendingOutcome) {
    pendingByServer.set(
      bet.bucksAccount.serverId,
      (pendingByServer.get(bet.bucksAccount.serverId) ?? 0) +
        (bet.matchedStake ?? bet.stake),
    );
  }
  for (const bet of [...pendingParlay, ...pendingWeekly]) {
    pendingByServer.set(
      bet.bucksAccount.serverId,
      (pendingByServer.get(bet.bucksAccount.serverId) ?? 0) + bet.stake,
    );
  }
  const openMarketsByServer = new Map<string, number>();
  for (const pool of openPools) {
    openMarketsByServer.set(
      pool.serverId,
      (openMarketsByServer.get(pool.serverId) ?? 0) + 1,
    );
  }
  const bucket = Math.floor(now.getTime() / SNAPSHOT_INTERVAL_MS).toString();
  const pendingSnapshotEvents: Array<{
    eventId: string;
    captured: boolean;
  }> = [];
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
    captureBucksEconomySnapshot({
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
    pendingSnapshotEvents.push({ eventId, captured: true });
  }

  const pendingEvents = [
    ...pendingLedgerEvents.filter((event) => event.captured),
    ...pendingSnapshotEvents.filter((event) => event.captured),
  ];
  if (pendingEvents.length === 0) {
    return { ledgerEntries: 0, snapshots: 0 };
  }
  if (!(await (analytics.flush?.() ?? Promise.resolve(true)))) {
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
