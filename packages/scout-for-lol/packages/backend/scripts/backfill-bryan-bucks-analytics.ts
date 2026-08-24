import { BucksLedgerKindSchema } from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import {
  captureBucksEconomy,
  captureBucksEconomySnapshot,
  captureBucksLifecycle,
} from "#src/analytics/bryan-bucks.ts";
import {
  aggregateBucksPendingStakes,
  countBucksOpenMarkets,
} from "#src/analytics/bryan-bucks-events.ts";
import { prisma } from "#src/database/index.ts";
import {
  getProductAnalytics,
  shutdownProductAnalytics,
} from "#src/analytics/product-analytics.ts";
import { deterministicBucksAnalyticsEventId } from "#src/analytics/bryan-bucks-backfill.ts";
import { createLogger } from "#src/logger.ts";

const LAUNCH_BOUNDARY = new Date("2026-08-16T00:00:00.000Z");
const dryRun = Bun.argv.includes("--dry-run");
const seedOnly = Bun.argv.includes("--seed-only");
const logger = createLogger("backfill-bryan-bucks-analytics");

function eventUuid(kind: string, id: number, suffix?: string): string {
  return deterministicBucksAnalyticsEventId(kind, id, suffix);
}

function eventOptions(
  kind: string,
  id: number,
  timestamp: Date,
  suffix?: string,
) {
  return { timestamp, uuid: eventUuid(kind, id, suffix) };
}

async function forEachAsync<T>(
  items: readonly T[],
  callback: (item: T) => Promise<void>,
): Promise<void> {
  for (const item of items) await callback(item);
}

async function main(): Promise<void> {
  if (configuration.environment !== "beta") {
    throw new Error(
      `Bryan Bucks analytics backfill requires ENVIRONMENT=beta; received ${configuration.environment}`,
    );
  }

  const earliestPool = await prisma.bucksMatchPool.findFirst({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (earliestPool !== null && earliestPool.createdAt < LAUNCH_BOUNDARY) {
    throw new Error(
      `Earliest Bryan Bucks pool predates the launch boundary: ${earliestPool.createdAt.toISOString()}`,
    );
  }

  const analytics = getProductAnalytics();
  let planned = 0;
  let skipped = 0;
  const reservedRows = await prisma.bucksAnalyticsBackfillEvent.findMany({
    select: { eventId: true },
  });
  const reservedEventIds = new Set(reservedRows.map((row) => row.eventId));
  const capture = async (
    eventId: string,
    callback: () => void,
  ): Promise<void> => {
    planned += 1;
    if (dryRun) return;
    if (reservedEventIds.has(eventId)) {
      skipped += 1;
      return;
    }
    if (!seedOnly) {
      callback();
      if (!(await (analytics.flush?.() ?? Promise.resolve(true)))) {
        throw new Error(`PostHog flush failed for event ${eventId}`);
      }
    }
    await prisma.bucksAnalyticsBackfillEvent.create({ data: { eventId } });
    reservedEventIds.add(eventId);
  };

  const accounts = await prisma.bucksAccount.findMany({
    where: { isHouse: false },
    select: { id: true, serverId: true, analyticsUserId: true },
  });
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const directBets = await prisma.bucksBet.findMany({
    where: { bucksAccount: { isHouse: false } },
    select: { id: true, bucksAccountId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  await forEachAsync(directBets, async (bet) => {
    const account = accountById.get(bet.bucksAccountId);
    if (account === undefined) return;
    await capture(eventUuid("direct-bet", bet.id), () => {
      analytics.captureBucksMember(
        {
          analyticsUserId: account.analyticsUserId,
          serverId: account.serverId,
        },
        {
          event: "bryan_bucks_member_activity",
          properties: {
            activity_kind: "outcome_bet",
            surface: "button",
            status: "success",
          },
        },
        eventOptions("direct-bet", bet.id, bet.createdAt),
      );
    });
  });

  const parlayBets = await prisma.bucksParlayBet.findMany({
    where: { bucksAccount: { isHouse: false } },
    select: {
      id: true,
      bucksAccountId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  await forEachAsync(parlayBets, async (bet) => {
    const account = accountById.get(bet.bucksAccountId);
    if (account === undefined) return;
    await capture(eventUuid("parlay-bet", bet.id), () => {
      analytics.captureBucksMember(
        {
          analyticsUserId: account.analyticsUserId,
          serverId: account.serverId,
        },
        {
          event: "bryan_bucks_member_activity",
          properties: {
            activity_kind: "parlay_bet",
            surface: "button",
            status: "success",
          },
        },
        eventOptions("parlay-bet", bet.id, bet.createdAt),
      );
    });
  });

  const weeklyParlayBets = await prisma.bucksWeeklyParlayBet.findMany({
    where: { bucksAccount: { isHouse: false } },
    select: {
      id: true,
      bucksAccountId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  await forEachAsync(weeklyParlayBets, async (bet) => {
    const account = accountById.get(bet.bucksAccountId);
    if (account === undefined) return;
    await capture(eventUuid("weekly-parlay-bet", bet.id), () => {
      analytics.captureBucksMember(
        {
          analyticsUserId: account.analyticsUserId,
          serverId: account.serverId,
        },
        {
          event: "bryan_bucks_member_activity",
          properties: {
            activity_kind: "weekly_parlay_bet",
            surface: "button",
            status: "success",
          },
        },
        eventOptions("weekly-parlay-bet", bet.id, bet.createdAt),
      );
    });
  });

  const pools = await prisma.bucksMatchPool.findMany({
    select: {
      id: true,
      serverId: true,
      createdAt: true,
      matchedAt: true,
      settledAt: true,
      poolState: true,
    },
    orderBy: { createdAt: "asc" },
  });
  await forEachAsync(pools, async (pool) => {
    await capture(eventUuid("pool", pool.id, "opened"), () => {
      captureBucksLifecycle({
        serverId: pool.serverId,
        transition: "bucks.pool.opened",
        options: eventOptions("pool", pool.id, pool.createdAt, "opened"),
        analytics,
      });
    });
    if (pool.matchedAt !== null) {
      const matchedAt = pool.matchedAt;
      await capture(eventUuid("pool", pool.id, "closed"), () => {
        captureBucksLifecycle({
          serverId: pool.serverId,
          transition: "bucks.pool.closed",
          options: eventOptions("pool", pool.id, matchedAt, "closed"),
          analytics,
        });
      });
    }
    if (pool.settledAt !== null && pool.poolState === "settled") {
      const settledAt = pool.settledAt;
      await capture(eventUuid("pool", pool.id, "settled"), () => {
        captureBucksLifecycle({
          serverId: pool.serverId,
          transition: "bucks.pool.settled",
          options: eventOptions("pool", pool.id, settledAt, "settled"),
          analytics,
        });
      });
    }
    if (pool.settledAt !== null && pool.poolState === "voided") {
      const settledAt = pool.settledAt;
      await capture(eventUuid("pool", pool.id, "voided"), () => {
        captureBucksLifecycle({
          serverId: pool.serverId,
          transition: "bucks.pool.voided",
          options: eventOptions("pool", pool.id, settledAt, "voided"),
          analytics,
        });
      });
    }
  });

  const parlayMarkets = await prisma.bucksParlayMarket.findMany({
    select: {
      id: true,
      serverId: true,
      publishedAt: true,
      settledAt: true,
      marketState: true,
    },
    orderBy: { publishedAt: "asc" },
  });
  await forEachAsync(parlayMarkets, async (market) => {
    await capture(eventUuid("parlay-market", market.id, "published"), () => {
      captureBucksLifecycle({
        serverId: market.serverId,
        transition: "bucks.parlay.published",
        options: eventOptions(
          "parlay-market",
          market.id,
          market.publishedAt,
          "published",
        ),
        analytics,
      });
    });
    if (market.settledAt !== null) {
      const settledAt = market.settledAt;
      await capture(
        eventUuid("parlay-market", market.id, market.marketState),
        () => {
          captureBucksLifecycle({
            serverId: market.serverId,
            transition:
              market.marketState === "voided"
                ? "bucks.parlay.voided"
                : "bucks.parlay.settled",
            options: eventOptions(
              "parlay-market",
              market.id,
              settledAt,
              market.marketState,
            ),
            analytics,
          });
        },
      );
    }
  });

  const weeklyMarkets = await prisma.bucksWeeklyParlayMarket.findMany({
    select: {
      id: true,
      serverId: true,
      publishedAt: true,
      settledAt: true,
      marketState: true,
    },
    orderBy: { publishedAt: "asc" },
  });
  await forEachAsync(weeklyMarkets, async (market) => {
    await capture(eventUuid("weekly-market", market.id, "published"), () => {
      captureBucksLifecycle({
        serverId: market.serverId,
        transition: "bucks.weekly_parlay.published",
        options: eventOptions(
          "weekly-market",
          market.id,
          market.publishedAt,
          "published",
        ),
        analytics,
      });
    });
    if (market.settledAt !== null) {
      const settledAt = market.settledAt;
      await capture(
        eventUuid("weekly-market", market.id, market.marketState),
        () => {
          captureBucksLifecycle({
            serverId: market.serverId,
            transition:
              market.marketState === "voided"
                ? "bucks.weekly_parlay.voided"
                : "bucks.weekly_parlay.settled",
            options: eventOptions(
              "weekly-market",
              market.id,
              settledAt,
              market.marketState,
            ),
            analytics,
          });
        },
      );
    }
  });

  const ledgerEntries = await prisma.bucksLedgerEntry.findMany({
    select: {
      id: true,
      delta: true,
      balanceAfter: true,
      kind: true,
      createdAt: true,
      bucksAccount: { select: { serverId: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  await forEachAsync(ledgerEntries, async (entry) => {
    await capture(eventUuid("ledger", entry.id), () => {
      captureBucksEconomy({
        serverId: entry.bucksAccount.serverId,
        movement: BucksLedgerKindSchema.parse(entry.kind),
        deltaBucks: entry.delta,
        balanceAfterBucks: entry.balanceAfter,
        ...eventOptions("ledger", entry.id, entry.createdAt),
        analytics,
      });
    });
  });

  const [allAccounts, pendingOutcome, pendingParlay, pendingWeekly, openPools] =
    await Promise.all([
      prisma.bucksAccount.findMany({
        select: { serverId: true, isHouse: true, balance: true },
      }),
      prisma.bucksBet.findMany({
        where: { betOutcome: "pending" },
        select: {
          stake: true,
          matchedStake: true,
          bucksAccount: { select: { serverId: true } },
        },
      }),
      prisma.bucksParlayBet.findMany({
        where: { betOutcome: "pending" },
        select: { stake: true, bucksAccount: { select: { serverId: true } } },
      }),
      prisma.bucksWeeklyParlayBet.findMany({
        where: { betOutcome: "pending" },
        select: { stake: true, bucksAccount: { select: { serverId: true } } },
      }),
      prisma.bucksMatchPool.findMany({
        where: { poolState: { in: ["open", "closed"] } },
        select: { serverId: true },
      }),
    ]);
  const serverIds = new Set([
    ...allAccounts.map((account) => account.serverId),
    ...openPools.map((pool) => pool.serverId),
  ]);
  const pendingByServer = aggregateBucksPendingStakes(
    pendingOutcome,
    pendingParlay,
    pendingWeekly,
  );
  const openMarketsByServer = countBucksOpenMarkets(openPools);
  const snapshotDate = new Date();
  const snapshotDay = snapshotDate.toISOString().slice(0, 10);
  await forEachAsync([...serverIds], async (serverId) => {
    const members = allAccounts.filter(
      (account) => account.serverId === serverId && !account.isHouse,
    );
    const house = allAccounts.filter(
      (account) => account.serverId === serverId && account.isHouse,
    );
    await capture(
      deterministicBucksAnalyticsEventId("snapshot", serverId, snapshotDay),
      () => {
        captureBucksEconomySnapshot({
          serverId,
          memberAccounts: members.length,
          totalMemberBalanceBucks: members.reduce(
            (total, account) => total + account.balance,
            0,
          ),
          pendingStakeBucks: pendingByServer.get(serverId) ?? 0,
          houseBalanceBucks: house.reduce(
            (total, account) => total + account.balance,
            0,
          ),
          openMarkets: openMarketsByServer.get(serverId) ?? 0,
          timestamp: snapshotDate,
          uuid: deterministicBucksAnalyticsEventId(
            "snapshot",
            serverId,
            snapshotDay,
          ),
          analytics,
        });
      },
    );
  });

  logger.info("Bryan Bucks analytics backfill complete", {
    dryRun,
    seedOnly,
    launchBoundary: LAUNCH_BOUNDARY.toISOString(),
    earliestPool: earliestPool?.createdAt.toISOString() ?? null,
    accounts: accounts.length,
    directBets: directBets.length,
    parlayBets: parlayBets.length,
    weeklyParlayBets: weeklyParlayBets.length,
    pools: pools.length,
    parlayMarkets: parlayMarkets.length,
    weeklyMarkets: weeklyMarkets.length,
    ledgerEntries: ledgerEntries.length,
    planned,
    skipped,
  });
}

try {
  await main();
} finally {
  await shutdownProductAnalytics();
  await prisma.$disconnect();
}
