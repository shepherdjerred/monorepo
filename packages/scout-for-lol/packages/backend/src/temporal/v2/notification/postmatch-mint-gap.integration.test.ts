import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  HOUR_MS,
  MINUTE_MS,
  clearGapTables,
  seedOwedMatch,
  seedReceipt,
} from "#src/database/durable/pipeline-gaps.test-fixtures.ts";
import { scoutDurablePostmatchMintGaps } from "#src/metrics/durable-pipeline.ts";
import { gaugeValue } from "#src/testing/gauge-values.ts";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import {
  POSTMATCH_MINT_GAP_GRACE_MS,
  POSTMATCH_MINT_GAP_LOOKBACK_MS,
  collectPostmatchMintGapMetrics,
} from "#src/temporal/v2/notification/postmatch-mint-gap.ts";
import { scoutV2NotificationRenderReceiptKind } from "#src/temporal/v2/notification-receipts.ts";

/**
 * The zero-mint sweep, run against a real Postgres.
 *
 * The predicate itself is pinned in `pipeline-gaps.integration.test.ts`. What
 * this proves is the wiring the sweep owns: the windows it passes, the render
 * receipt kind it takes from the notification lane's own vocabulary, and the
 * sentinel it writes when the read fails.
 */

const { prisma } = createTestDatabase("postmatch-mint-gap-sweep");

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearGapTables(prisma);
  scoutDurablePostmatchMintGaps.reset();
});

const NOW = Date.now();

describe("postmatch mint gap sweep against Postgres", () => {
  test("publishes zero, not absence, when every finished match minted", async () => {
    await collectPostmatchMintGapMetrics(prisma);
    expect(await gaugeValue(scoutDurablePostmatchMintGaps, {})).toBe(0);
  });

  test("counts finished matches inside its windows and clears on the backfill receipt", async () => {
    const inside = {
      observedAt: new Date(NOW - 2 * HOUR_MS),
      completedAt: new Date(NOW - POSTMATCH_MINT_GAP_GRACE_MS - MINUTE_MS),
    };
    await seedOwedMatch(prisma, { matchId: "NA1_9701", ...inside });
    await seedOwedMatch(prisma, { matchId: "NA1_9702", ...inside });
    // Observed just before the lookback: a gap old enough to stop paging.
    await seedOwedMatch(prisma, {
      matchId: "NA1_9703",
      observedAt: new Date(NOW - POSTMATCH_MINT_GAP_LOOKBACK_MS - MINUTE_MS),
      completedAt: new Date(NOW - POSTMATCH_MINT_GAP_LOOKBACK_MS),
    });

    await collectPostmatchMintGapMetrics(prisma);
    expect(await gaugeValue(scoutDurablePostmatchMintGaps, {})).toBe(2);

    // The operator's remediation: the silent backfill writes this receipt and
    // no intent. The kind comes from the lane's table, so a rename there that
    // the sweep did not follow would leave this at 2.
    await seedReceipt(prisma, {
      matchId: "NA1_9701",
      kind: scoutV2NotificationRenderReceiptKind("postmatch"),
    });
    await collectPostmatchMintGapMetrics(prisma);
    expect(await gaugeValue(scoutDurablePostmatchMintGaps, {})).toBe(1);
  });

  test("a failing read writes -1 instead of failing the scrape", async () => {
    const degraded = createTestDatabase("postmatch-mint-gap-degraded");
    try {
      await degraded.prisma.$executeRawUnsafe(
        'DROP TABLE "MatchNotificationIntent"',
      );
      await expect(
        collectPostmatchMintGapMetrics(degraded.prisma),
      ).resolves.toBeUndefined();
    } finally {
      await dropTestDatabase(degraded.prisma, degraded.dbPath);
    }
    expect(await gaugeValue(scoutDurablePostmatchMintGaps, {})).toBe(-1);
  });
});
