import { afterAll, describe, expect, test } from "vitest";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  matchObservationRowToRecord,
  type MatchObservationRecord,
} from "#src/database/durable/observation-row.ts";
import {
  matchProcessingReceiptRowToRecord,
  type MatchProcessingReceiptRecord,
} from "#src/database/durable/receipt-row.ts";
import {
  getObservation,
  getProcessingState,
  observeMatch,
  promoteObservation,
} from "#src/database/durable/observation-repository.ts";
import {
  listReceipts,
  recordReceipt,
} from "#src/database/durable/receipt-repository.ts";

const { prisma } = createTestDatabase("durable-observation-repository");

afterAll(async () => {
  await prisma.$disconnect();
});

const AT = new Date("2026-09-07T10:00:00.000Z");
const LATER = new Date("2026-09-07T11:00:00.000Z");
const PROMOTED_AT = IsoInstantSchema.parse("2026-09-07T12:00:00.000Z");

function observation(
  gameId: number,
  overrides: Partial<{
    processingPolicy: string;
    pipelineOwner: string | null;
    promotedAt: Date | null;
  }> = {},
): MatchObservationRecord {
  return matchObservationRowToRecord({
    riotMatchId: `NA1_${String(gameId)}`,
    platformRoute: "NA1",
    processingPolicy: "ARCHIVE_ONLY",
    pipelineOwner: null,
    promotedAt: null,
    gameCreatedAt: AT,
    observedAt: LATER,
    matchObjectKey: null,
    matchDigest: null,
    timelineObjectKey: null,
    timelineDigest: null,
    ...overrides,
  });
}

function receipt(
  gameId: number,
  scopeKind: "global" | "guild",
): MatchProcessingReceiptRecord {
  return matchProcessingReceiptRowToRecord({
    riotMatchId: `NA1_${String(gameId)}`,
    kind: "report-posted",
    version: 1,
    scopeKind,
    scopeGuildId: scopeKind === "guild" ? "100000000000000001" : null,
    scopeAccountId: null,
    scopeKey: scopeKind === "guild" ? "guild:100000000000000001" : "global",
    evidence: null,
    recordedAt: AT,
  });
}

describe("observeMatch", () => {
  test("applies once and answers an identical retry with already-applied", async () => {
    const record = observation(101);
    expect(await observeMatch(prisma, record)).toEqual({ outcome: "applied" });
    expect(await observeMatch(prisma, record)).toEqual({
      outcome: "already-applied",
    });
    expect(await getObservation(prisma, { matchId: record.matchId })).toEqual(
      record,
    );
  });

  test("exactly one of two concurrent identical observers applies", async () => {
    const record = observation(102);
    const outcomes = await Promise.all([
      observeMatch(prisma, record),
      observeMatch(prisma, record),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "already-applied",
      "applied",
    ]);
  });

  test("a different pipeline claiming an owned match conflicts", async () => {
    const legacy = observation(103, { pipelineOwner: "LEGACY_V1" });
    const temporal = observation(103, { pipelineOwner: "TEMPORAL_V2" });
    const outcomes = await Promise.all([
      observeMatch(prisma, legacy),
      observeMatch(prisma, temporal),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "applied",
      "conflict",
    ]);
    const stored = await getObservation(prisma, { matchId: legacy.matchId });
    expect(stored?.owner.kind).not.toBe("unowned");
  });

  test("an assigned observer claims an unowned observation", async () => {
    const unowned = observation(104);
    const claimed = observation(104, { pipelineOwner: "TEMPORAL_V2" });
    expect(await observeMatch(prisma, unowned)).toEqual({
      outcome: "applied",
    });
    expect(await observeMatch(prisma, claimed)).toEqual({
      outcome: "applied",
    });
    const stored = await getObservation(prisma, { matchId: unowned.matchId });
    expect(stored?.owner).toEqual({ kind: "temporal-v2" });
    // The claim is one-way: observing again without an owner is a no-op.
    expect(await observeMatch(prisma, unowned)).toEqual({
      outcome: "already-applied",
    });
  });

  test("disagreeing observation facts conflict", async () => {
    const record = observation(105);
    const differing = observation(105, { processingPolicy: "FULL" });
    expect(await observeMatch(prisma, record)).toEqual({ outcome: "applied" });
    expect(await observeMatch(prisma, differing)).toEqual({
      outcome: "conflict",
      reason: "observation-differs",
    });
  });
});

describe("promoteObservation", () => {
  test("promotes at most once and conflicts on a born-FULL match", async () => {
    const record = observation(110);
    await observeMatch(prisma, record);
    expect(
      await promoteObservation(prisma, {
        matchId: record.matchId,
        promotedAt: PROMOTED_AT,
      }),
    ).toEqual({ outcome: "applied" });
    expect(
      await promoteObservation(prisma, {
        matchId: record.matchId,
        promotedAt: PROMOTED_AT,
      }),
    ).toEqual({ outcome: "already-applied" });

    const bornFull = observation(111, { processingPolicy: "FULL" });
    await observeMatch(prisma, bornFull);
    expect(
      await promoteObservation(prisma, {
        matchId: bornFull.matchId,
        promotedAt: PROMOTED_AT,
      }),
    ).toEqual({ outcome: "conflict", reason: "promotion-target-born-full" });
  });

  test("promoting an unobserved match fails loudly", async () => {
    const ghost = observation(112);
    await expect(
      promoteObservation(prisma, {
        matchId: ghost.matchId,
        promotedAt: PROMOTED_AT,
      }),
    ).rejects.toThrow(/never observed/);
  });
});

describe("receipts and state assembly", () => {
  test("recordReceipt is idempotent by scope identity", async () => {
    await observeMatch(prisma, observation(120));
    const globalReceipt = receipt(120, "global");
    expect(await recordReceipt(prisma, globalReceipt)).toEqual({
      outcome: "applied",
    });
    expect(await recordReceipt(prisma, globalReceipt)).toEqual({
      outcome: "already-applied",
    });
  });

  test("exactly one of two concurrent identical receipt writers applies", async () => {
    await observeMatch(prisma, observation(121));
    const guildReceipt = receipt(121, "guild");
    const outcomes = await Promise.all([
      recordReceipt(prisma, guildReceipt),
      recordReceipt(prisma, guildReceipt),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "already-applied",
      "applied",
    ]);
  });

  test("assembles the domain MatchProcessingState with its receipts", async () => {
    const record = observation(122, { pipelineOwner: "TEMPORAL_V2" });
    await observeMatch(prisma, record);
    await recordReceipt(prisma, receipt(122, "global"));
    await recordReceipt(prisma, receipt(122, "guild"));

    const state = await getProcessingState(prisma, {
      matchId: record.matchId,
      receiptKind: "report-posted",
      receiptVersion: 1,
    });
    expect(state?.owner).toEqual({ kind: "temporal-v2" });
    expect(state?.receipts).toHaveLength(2);

    const listed = await listReceipts(prisma, { matchId: record.matchId });
    expect(listed).toHaveLength(2);
    expect(
      await getProcessingState(prisma, {
        matchId: record.matchId,
        receiptKind: "report-posted",
        receiptVersion: 2,
      }),
    ).toMatchObject({ receipts: [] });
  });

  test("returns null for a match that was never observed", async () => {
    const ghost = observation(123);
    expect(
      await getProcessingState(prisma, {
        matchId: ghost.matchId,
        receiptKind: "report-posted",
        receiptVersion: 1,
      }),
    ).toBeNull();
  });
});
