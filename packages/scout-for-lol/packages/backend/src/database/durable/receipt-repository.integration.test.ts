import { afterAll, afterEach, expect, test, vi } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { SCOUT_MATCH_RECEIPT_KINDS } from "@scout-for-lol/temporal/match-receipts";
import configuration from "#src/configuration.ts";
import {
  listRecentAppliedReceiptTimes,
  recordReceipt,
} from "#src/database/durable/receipt-repository.ts";
import {
  matchProcessingReceiptRecordToRow,
  type MatchProcessingReceiptRecord,
} from "#src/database/durable/receipt-row.ts";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";

const { prisma, dbPath } = createTestDatabase("receipt-writer-origin");
const FIRST_BUILD = "a".repeat(40);
const NEXT_BUILD = "b".repeat(40);
const RECORDED_AT = IsoInstantSchema.parse("2025-01-01T00:00:00.000Z");

function receipt(match: string): MatchProcessingReceiptRecord {
  return {
    matchId: RiotMatchIdSchema.parse(match),
    receipt: {
      kind: SCOUT_MATCH_RECEIPT_KINDS.archive,
      version: 1,
      scope: { kind: "global" },
      recordedAt: RECORDED_AT,
    },
    evidence: "{}",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await dropTestDatabase(prisma, dbPath);
});

test("the origin migration creates a valid index in database timestamp order", async () => {
  const indexes = await prisma.$queryRaw<
    { valid: boolean; definition: string }[]
  >`
    SELECT indisvalid AS valid, pg_get_indexdef(indexrelid) AS definition
    FROM pg_index
    WHERE indexrelid = to_regclass('"MatchProcessingReceipt_writerGitSha_createdAt_id_idx"')
  `;
  expect(indexes).toEqual([
    {
      valid: true,
      definition: expect.stringContaining(
        '("writerGitSha", "createdAt" DESC, id DESC)',
      ),
    },
  ]);
});

test("attributes the unique insert to its first writer across duplicate and conflicting builds", async () => {
  const build = vi.spyOn(configuration, "gitSha", "get");
  const record = receipt("NA1_91001");
  build.mockReturnValue(FIRST_BUILD);
  expect(await recordReceipt(prisma, record)).toEqual({ outcome: "applied" });
  const original = await prisma.matchProcessingReceipt.findFirstOrThrow({
    where: { riotMatchId: record.matchId },
  });
  expect(original.writerGitSha).toBe(FIRST_BUILD);
  expect(original.recordedAt.toISOString()).toBe(RECORDED_AT);
  expect(original.createdAt.getTime()).toBeGreaterThan(Date.parse(RECORDED_AT));
  expect(await listRecentAppliedReceiptTimes(prisma)).toContainEqual(
    original.createdAt,
  );

  build.mockReturnValue(NEXT_BUILD);
  await expect(recordReceipt(prisma, record)).resolves.toEqual({
    outcome: "already-applied",
  });
  await expect(
    recordReceipt(prisma, { ...record, evidence: '{"changed":true}' }),
  ).resolves.toEqual({
    outcome: "conflict",
    reason: "receipt-evidence-mismatch",
  });
  expect(await listRecentAppliedReceiptTimes(prisma)).toEqual([]);
  expect(
    await prisma.matchProcessingReceipt.findMany({
      where: { riotMatchId: record.matchId },
    }),
  ).toEqual([original]);
});

test("preserves unknown origin for old writers and validates Git SHA on current inserts", async () => {
  const legacy = receipt("NA1_91002");
  const invalid = receipt("NA1_91003");
  await prisma.matchProcessingReceipt.create({
    data: matchProcessingReceiptRecordToRow(legacy),
  });
  const build = vi.spyOn(configuration, "gitSha", "get");
  build.mockReturnValue("A".repeat(40));
  expect(await recordReceipt(prisma, invalid)).toEqual({ outcome: "applied" });
  expect(await listRecentAppliedReceiptTimes(prisma)).toEqual([]);

  build.mockReturnValue(NEXT_BUILD);
  await expect(recordReceipt(prisma, legacy)).resolves.toEqual({
    outcome: "already-applied",
  });
  expect(
    await prisma.matchProcessingReceipt.findMany({
      where: { riotMatchId: { in: [legacy.matchId, invalid.matchId] } },
      select: { writerGitSha: true },
    }),
  ).toEqual([{ writerGitSha: null }, { writerGitSha: null }]);
  await expect(
    prisma.matchProcessingReceipt.create({
      data: {
        ...matchProcessingReceiptRecordToRow(receipt("NA1_91004")),
        writerGitSha: "A".repeat(40),
      },
    }),
  ).rejects.toThrow(/MatchProcessingReceipt_writerGitSha_check/u);
});
