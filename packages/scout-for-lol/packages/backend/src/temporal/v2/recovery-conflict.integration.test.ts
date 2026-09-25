import { afterAll, expect, test, vi } from "vitest";
import {
  ArtifactDescriptorSchema,
  type ArtifactDescriptor,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  IsoInstantSchema,
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { ScoutStageSchema } from "@scout-for-lol/temporal/contracts";
import type { ScoutRecoveryBatchRefV2 } from "@scout-for-lol/temporal/contracts-v2";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { createRecoveryBatch } from "#src/database/durable/recovery-repository.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";

/**
 * A recovery item that comes back in CONFLICT names itself in a receipt.
 *
 * A conflict means two producers disagree about what is true of a match, which
 * is a person's problem rather than a retry's — and a tally that counted it
 * without naming it would tell an operator that three matches need attention
 * while making them scan the batch's whole range to find out which three. This
 * pins the naming.
 *
 * The conflict itself is only reachable through a race. `listRecoverableMatches`
 * anti-joins observations in SQL and `recoverArchivedMatch` re-reads the
 * observation before it writes, so a match that reaches `observeMatch` has had
 * no observation twice over; only an insert landing between those two reads
 * produces one. That window is real in production and unreachable from a
 * single-threaded test, so the observation REPOSITORY is replaced — a
 * collaborator of the code under test, not the code under test — while the batch
 * rows, the receipt rows, the anti-join that finds the item and the conflict
 * receipt itself all run against Postgres.
 */
const riot = vi.hoisted(() => ({
  gameCreation: Date.parse("2026-09-11T09:00:00.000Z"),
}));

vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2MatchContext: (riotMatchId: string) =>
    Promise.resolve({
      matchId: riotMatchId,
      riotMatchId,
      matchData: { info: { gameCreation: riot.gameCreation } },
      trackedPlayers: [],
    }),
}));

vi.mock("#src/database/durable/observation-repository.ts", () => ({
  // No observation when the item is read, and a losing write when it lands:
  // exactly the shape of the race, and nothing else.
  getObservation: () => Promise.resolve(null),
  observeMatch: () =>
    Promise.resolve({ outcome: "conflict", reason: "observation-differs" }),
}));

const testDatabase = createTestDatabase("temporal-v2-recovery-conflict");
Bun.env["DATABASE_URL"] = testDatabase.dbUrl;
const { prisma } = testDatabase;

const { prisma: activityPrisma } = await import("#src/database/index.ts");
const { listReceipts } =
  await import("#src/database/durable/receipt-repository.ts");
const { SCOUT_V2_RECOVERY_CONFLICT_RECEIPT_KIND } =
  await import("#src/temporal/v2/recovery-receipts.ts");
const {
  buildReceipt,
  rawArchiveEvidenceCodec,
  rawArchiveEvidenceOf,
  rawArchiveReceiptKind,
} = await import("#src/report-lake/durable-receipts.ts");
const { processRecoveryPageV2, scanRecoveryPageV2 } =
  await import("#src/temporal/v2/recovery.ts");

afterAll(async () => {
  await prisma.$disconnect();
  await activityPrisma.$disconnect();
});

const STAGE = ScoutStageSchema.parse("dev");
const BATCH_ID = RecoveryBatchIdSchema.parse("recovery-conflict-01");
const CONFLICTED = RiotMatchIdSchema.parse("NA1_870001");
const BATCH_CREATED_AT = new Date("2026-09-11T10:00:00.000Z");

function descriptorFor(riotMatchId: RiotMatchId): ArtifactDescriptor {
  return ArtifactDescriptorSchema.parse({
    kind: "match",
    key: `games/2026/09/11/${riotMatchId}/match.json`,
    digest: "c".repeat(64),
    bytes: 2048,
    contentType: "application/json",
    capturedAt: "2026-09-11T09:05:00.000Z",
  });
}

test("names a conflicted match in the batch's audit trail", async () => {
  await recordReceipt(
    prisma,
    buildReceipt({
      matchId: CONFLICTED,
      kind: rawArchiveReceiptKind("match"),
      evidence: rawArchiveEvidenceCodec.serialize(
        rawArchiveEvidenceOf(descriptorFor(CONFLICTED)),
      ),
      recordedAt: new Date("2026-09-11T09:30:00.000Z"),
    }),
  );
  expect(
    await createRecoveryBatch(prisma, {
      batch: {
        id: BATCH_ID,
        policy: "normal",
        createdAt: IsoInstantSchema.parse(BATCH_CREATED_AT.toISOString()),
        state: { kind: "planned" },
      },
      workflowId: null,
    }),
  ).toEqual({ outcome: "applied" });

  const ref: ScoutRecoveryBatchRefV2 = {
    stage: STAGE,
    recoveryBatchId: BATCH_ID,
  };
  const scan = await scanRecoveryPageV2(ref);
  expect(scan.discovered).toBe(1);
  const processed = await processRecoveryPageV2(ref);

  // The tally still counts it, because `failed` is what a conflict IS to a
  // batch whose whole job is counting outcomes — failing the Activity would
  // strand every other item in the range.
  expect(processed.counts).toMatchObject({ discovered: 1, failed: 1 });

  // The id is on the receipt row, reachable through the `(kind, recordedAt)`
  // index rather than by scanning the batch's whole range.
  const receipts = await listReceipts(prisma, { matchId: CONFLICTED });
  expect(
    receipts.filter(
      (record) =>
        record.receipt.kind === SCOUT_V2_RECOVERY_CONFLICT_RECEIPT_KIND,
    ),
  ).toHaveLength(1);
}, 30_000);

test("a replayed processing page records the conflict once", async () => {
  // The evidence is derived from the match id alone, so a retried Activity
  // writes byte-identical evidence and the repository answers already-applied
  // rather than a conflict about a conflict. The re-run also exercises the
  // shortfall guard: the tally is already whole, so there is no gap to close
  // and the rule must add nothing rather than drive `suppressed` negative.
  await processRecoveryPageV2({ stage: STAGE, recoveryBatchId: BATCH_ID });

  const receipts = await listReceipts(prisma, { matchId: CONFLICTED });
  expect(
    receipts.filter(
      (record) =>
        record.receipt.kind === SCOUT_V2_RECOVERY_CONFLICT_RECEIPT_KIND,
    ),
  ).toHaveLength(1);
}, 30_000);
