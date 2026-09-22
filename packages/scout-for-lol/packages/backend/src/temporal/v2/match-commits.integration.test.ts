import { afterAll, describe, expect, test, vi } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
  SCOUT_V2_MATCH_RECEIPT_KINDS,
  SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
  scoutV2ClientMatchTerminalEvidenceCodec,
  scoutV2MatchStageConflictEvidenceCodec,
} from "@scout-for-lol/temporal/match-receipts-v2";
import type * as DatabaseModule from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

/**
 * The stage-receipt attestation against real receipt rows.
 *
 * The property under test is that a contested stage receipt leaves something
 * DURABLE behind. The Workflow fails the run that met the conflict, but a
 * failed run is invisible to the next execution's resume read; the marker
 * this Activity records is what that read surfaces, and it is the only thing
 * standing between the next execution and a cursor advanced over drift.
 */

const { prisma } = createTestDatabase("scout-v2-match-commits");

vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

const { recordClientMatchTerminalV2, recordMatchReceiptsV2 } =
  await import("#src/temporal/v2/match-commits.ts");
const { readMatchPipelineStateV2 } =
  await import("#src/temporal/v2/match-reads.ts");
const { listReceipts, recordReceipt } =
  await import("#src/database/durable/receipt-repository.ts");
const { buildMatchReceipt } =
  await import("#src/durable/match/receipt-evidence.ts");
const { observeMatch } =
  await import("#src/database/durable/observation-repository.ts");

afterAll(async () => {
  await prisma.$disconnect();
});

const RECORDED_AT = IsoInstantSchema.parse("2026-09-16T10:00:00.000Z");

/** A stage receipt someone else wrote with evidence this core cannot produce. */
async function seedForeignStageReceipt(matchId: RiotMatchId): Promise<void> {
  expect(
    await recordReceipt(
      prisma,
      buildMatchReceipt({
        matchId,
        kind: SCOUT_V2_MATCH_RECEIPT_KINDS.settlement,
        scope: { kind: "global" },
        recordedAt: RECORDED_AT,
        evidence: { kind: "not-this-core's-evidence", version: 1, data: {} },
      }),
    ),
  ).toEqual({ outcome: "applied" });
}

async function seedObservation(matchId: RiotMatchId): Promise<void> {
  expect(
    await observeMatch(prisma, {
      matchId,
      platformRoute: "NA1",
      policy: "FULL",
      owner: { kind: "temporal-v2" },
      promotion: null,
      gameCreatedAt: RECORDED_AT,
      observedAt: RECORDED_AT,
      deliveryMode: "live",
      artifacts: { match: null, timeline: null },
    }),
  ).toEqual({ outcome: "applied" });
}

async function kindsOf(matchId: RiotMatchId): Promise<string[]> {
  const records = await listReceipts(prisma, { matchId });
  return records.map((record) => record.receipt.kind);
}

async function expectDurableMarker(
  matchId: RiotMatchId,
  kind: string,
  parseEvidence: (input: unknown) => unknown,
): Promise<void> {
  const records = await listReceipts(prisma, { matchId });
  const marker = records.find((record) => record.receipt.kind === kind);
  expect(marker).toBeDefined();
  expect(parseEvidence(JSON.parse(marker?.evidence ?? "null"))).toEqual({
    riotMatchId: matchId,
  });

  const resume = await readMatchPipelineStateV2({ riotMatchId: matchId });
  expect(resume.kind).toBe("present");
  if (resume.kind !== "present") {
    throw new Error(`Expected pipeline state for ${matchId}`);
  }
  expect(resume.state.receiptKinds).toContain(kind);
}

describe("recordMatchReceiptsV2", () => {
  test("attests cleanly and records no marker when nothing is contested", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8201");

    const result = await recordMatchReceiptsV2({
      stage: "dev",
      riotMatchId: matchId,
      kinds: [
        SCOUT_V2_MATCH_RECEIPT_KINDS.settlement,
        SCOUT_V2_MATCH_RECEIPT_KINDS.progression,
      ],
    });

    expect(result.receipts.map((receipt) => receipt.commit)).toEqual([
      { outcome: "applied" },
      { outcome: "applied" },
    ]);
    expect(await kindsOf(matchId)).not.toContain(
      SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
    );
  });

  test("records the durable marker when a stage receipt is contested", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8202");
    await seedObservation(matchId);
    await seedForeignStageReceipt(matchId);

    const result = await recordMatchReceiptsV2({
      stage: "dev",
      riotMatchId: matchId,
      kinds: [
        SCOUT_V2_MATCH_RECEIPT_KINDS.settlement,
        SCOUT_V2_MATCH_RECEIPT_KINDS.progression,
      ],
    });

    // Reported honestly — the conflict is in the result — AND made durable.
    expect(result.receipts.map((receipt) => receipt.commit)).toEqual([
      { outcome: "conflict", reason: "receipt-evidence-mismatch" },
      { outcome: "applied" },
    ]);
    await expectDurableMarker(
      matchId,
      SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
      (evidence) => scoutV2MatchStageConflictEvidenceCodec.parse(evidence),
    );
  });

  test("a second contested attestation is not a conflict about a conflict", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8203");
    await seedForeignStageReceipt(matchId);

    await recordMatchReceiptsV2({
      stage: "dev",
      riotMatchId: matchId,
      kinds: [SCOUT_V2_MATCH_RECEIPT_KINDS.settlement],
    });
    // The evidence names the match alone, so the second write is
    // already-applied and the Activity does not fail on its own marker.
    await expect(
      recordMatchReceiptsV2({
        stage: "dev",
        riotMatchId: matchId,
        kinds: [SCOUT_V2_MATCH_RECEIPT_KINDS.settlement],
      }),
    ).resolves.toBeDefined();

    const kinds = await kindsOf(matchId);
    expect(
      kinds.filter(
        (kind) => kind === SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
      ),
    ).toHaveLength(1);
  });
});

describe("recordClientMatchTerminalV2", () => {
  test("surfaces an operator-review marker recorded before observation", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8205");

    await expect(
      recordClientMatchTerminalV2({ riotMatchId: matchId }),
    ).resolves.toEqual({ outcome: "applied" });
    await expect(
      readMatchPipelineStateV2({ riotMatchId: matchId }),
    ).resolves.toEqual({ kind: "terminal" });
  });

  test("persists an idempotent operator-review marker in pipeline state", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8204");
    await seedObservation(matchId);

    await expect(
      recordClientMatchTerminalV2({ riotMatchId: matchId }),
    ).resolves.toEqual({ outcome: "applied" });
    await expect(
      recordClientMatchTerminalV2({ riotMatchId: matchId }),
    ).resolves.toEqual({ outcome: "already-applied" });

    await expectDurableMarker(
      matchId,
      SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
      (evidence) => scoutV2ClientMatchTerminalEvidenceCodec.parse(evidence),
    );
  });
});
