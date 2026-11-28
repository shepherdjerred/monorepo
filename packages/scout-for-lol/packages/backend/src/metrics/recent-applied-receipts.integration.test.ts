import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { SCOUT_MATCH_RECEIPT_KINDS } from "@scout-for-lol/temporal/match-receipts";
import configuration from "#src/configuration.ts";
import {
  collectDurablePipelineMetrics,
  scoutDurableRecentAppliedReceiptTimestamp,
} from "#src/metrics/durable-pipeline.ts";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";

const { prisma, dbPath } = createTestDatabase("recent-applied-receipts");
const BUILD = "a".repeat(40);
const OTHER_BUILD = "b".repeat(40);
const ACCEPTED_AT_MS = Date.parse("2026-11-28T01:00:00.250Z");

beforeEach(async () => {
  await prisma.matchProcessingReceipt.deleteMany();
  vi.spyOn(configuration, "gitSha", "get").mockReturnValue(BUILD);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await dropTestDatabase(prisma, dbPath);
});

async function seedReceipt(
  matchNumber: number,
  createdOffsetMs: number,
  writerGitSha: string | null = BUILD,
): Promise<void> {
  await prisma.matchProcessingReceipt.create({
    data: {
      riotMatchId: RiotMatchIdSchema.parse(`NA1_${String(matchNumber)}`),
      kind: SCOUT_MATCH_RECEIPT_KINDS.archive,
      version: 1,
      scopeKind: "global",
      scopeKey: "global",
      // Deliberately later than every creation time. Receipt evidence may
      // describe a different clock or time than the database write.
      recordedAt: new Date(ACCEPTED_AT_MS + 86_400_000),
      createdAt: new Date(ACCEPTED_AT_MS + createdOffsetMs),
      writerGitSha,
    },
  });
}

async function exportedRanks() {
  const metric = await scoutDurableRecentAppliedReceiptTimestamp.get();
  return metric.values.map(({ labels, value }) => ({
    rank: labels.rank,
    value,
  }));
}

test("the first sweep exports at most five exact-build timestamps in database order", async () => {
  for (const [index, offset] of [
    500, -1000, 100, 0, 1000, 2000, 3000,
  ].entries()) {
    await seedReceipt(91_000 + index, offset);
  }
  await seedReceipt(92_000, 5000, OTHER_BUILD);
  await seedReceipt(93_000, 6000, null);

  await collectDurablePipelineMetrics(prisma);
  const ranks = await exportedRanks();
  expect(ranks).toEqual(
    [3000, 2000, 1000, 500, 100].map((offset, index) => ({
      rank: String(index + 1),
      value: (ACCEPTED_AT_MS + offset) / 1000,
    })),
  );
  expect(
    ranks.filter(({ value }) => value > ACCEPTED_AT_MS / 1000),
  ).toHaveLength(5);

  await prisma.matchProcessingReceipt.deleteMany({
    where: { riotMatchId: RiotMatchIdSchema.parse("NA1_91002") },
  });
  await collectDurablePipelineMetrics(prisma);
  const afterRemoval = await exportedRanks();
  expect(afterRemoval.at(-1)).toEqual({
    rank: "5",
    value: ACCEPTED_AT_MS / 1000,
  });
  expect(
    afterRemoval.filter(({ value }) => value > ACCEPTED_AT_MS / 1000),
  ).toHaveLength(4);
});

test("omits absent ranks and clears observed ranks when the durable query fails", async () => {
  await collectDurablePipelineMetrics(prisma);
  expect(await exportedRanks()).toEqual([]);

  await seedReceipt(94_001, 100);
  await collectDurablePipelineMetrics(prisma);
  expect(await exportedRanks()).toEqual([
    { rank: "1", value: (ACCEPTED_AT_MS + 100) / 1000 },
  ]);

  const degraded = createTestDatabase("missing-receipt-writer-index-column");
  try {
    await degraded.prisma.$executeRawUnsafe(
      'ALTER TABLE "MatchProcessingReceipt" DROP COLUMN "writerGitSha"',
    );
    await collectDurablePipelineMetrics(degraded.prisma);
    expect(await exportedRanks()).toEqual([]);
  } finally {
    await dropTestDatabase(degraded.prisma, degraded.dbPath);
  }
});
