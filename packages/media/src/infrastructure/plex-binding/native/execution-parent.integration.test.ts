import { rm } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeCompensationFixture } from "#automation/native-compensation/test-fixture.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { observePairedCompensationExecution } from "#migration/native-plex/compensation.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { ArchiveReceiptProjection } from "#infrastructure/native-archive/receipt-projection.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  NativePlexProofRefSchema,
  NativePlexProofBatchSchema,
  NativePlexNetworkEnvelopeSchema,
} from "#shared/plex-binding/native.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import {
  loadNativePlexExecutionSnapshot,
  assertNativePlexExecutionSnapshot,
} from "./native-execution-parent.ts";
import { persistNativeExecutionPlexProofBatch } from "./native-commit.ts";
import { parseNativePlexNetwork } from "./native-evidence.ts";
import { proofQueryAudit } from "./query-budget.test-support.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let activity: NativeCompensationActivityInput;
let source: Awaited<ReturnType<typeof observedSource>>;

beforeAll(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
  );
  await fixture.prepare();
  activity = await fixture.apply();
}, 60_000);
beforeEach(async () => {
  source = await observedSource();
});
afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

/** Inputs come from a real paired producer, never hand-created permission rows. */
async function observedSource() {
  const execution = bindingTestExecution();
  expect(
    await observePairedCompensationExecution(
      fixture.observerContext,
      activity,
      execution,
    ),
  ).toEqual({ status: "ready", reason: null });
  const db = harness.database();
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: activity.operationId },
  });
  const ref = NativePlexProofRefSchema.parse(
    nativePlexNetworkPointer(operation.result),
  );
  const row = await db.nativePlexProofBatch.findUniqueOrThrow({
    where: { id: ref.batchId },
    include: { networkObservation: true, plexObservation: true },
  });
  expect(identityHash(row.batch)).toBe(ref.batchHash);
  expect(identityHash(row.networkObservation.evidence)).toBe(
    ref.network.evidenceHash,
  );
  expect(identityHash(row.plexObservation.evidence)).toBe(
    ref.plex.evidenceHash,
  );
  const batch = NativePlexProofBatchSchema.parse(row.batch);
  const envelope = NativePlexNetworkEnvelopeSchema.parse(
    row.plexObservation.evidence,
  );
  return {
    execution,
    ref,
    operation,
    input: {
      parent: ref.parent,
      networkEvidence: parseNativePlexNetwork(
        ref.parent,
        row.networkObservation.evidence,
      ),
      plexObservation: envelope.observation,
      timing: {
        startedAt: batch.startedAt,
        completedAt: batch.completedAt,
        sessionsCheckedAt: batch.sessionsCheckedAt,
        expiresAt: batch.expiresAt,
      },
      expectedOperationResultHash: identityHash(operation.result),
    },
    freshness: plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: Math.min(execution.expiresAtMs, Date.parse(batch.expiresAt)),
      guards: [execution],
    }),
  };
}

function nativePlexNetworkPointer(result: unknown) {
  return z.object({ nativePlexProof: NativePlexProofRefSchema }).parse(result)
    .nativePlexProof;
}

test("final actual execution snapshot queries only fresh command plus four-model batch, then closes on pointer write", async () => {
  await harness.database().$transaction(async (tx) => {
    const budget = new PublicationAuthorityReadBudget();
    const projection = new ArchiveReceiptProjection(tx, budget);
    const audit = proofQueryAudit(tx);
    try {
      const loaded = await loadNativePlexExecutionSnapshot(
        tx,
        activity,
        budget,
        projection,
      );
      const rows = await audit.returned();
      const remaining = budget.take;
      const ref = await persistNativeExecutionPlexProofBatch(tx, source.input, {
        freshness: source.freshness,
        budget,
        projection,
        executionSnapshot: loaded.snapshot,
      });
      expect((await audit.returned()) - rows).toBe(5);
      expect(remaining - budget.take).toBe(5);
      expect(ref.batchId).not.toBe(source.ref.batchId);
      expect(loaded.snapshot.phase.closed).toBe(true);
      await expect(
        assertNativePlexExecutionSnapshot(tx, loaded.snapshot, {
          operation: loaded.snapshot.phase.operation,
          parent: loaded.proofParent,
          budget,
        }),
      ).rejects.toThrow("snapshot changed");
    } finally {
      audit.restore();
    }
  });
});

test.each(["budget", "raw_ancestor", "scope", "closed"] as const)(
  "final snapshot rejects %s without a new batch",
  async (change) => {
    const db = harness.database();
    const before = await db.nativePlexProofBatch.count({
      where: { operationId: activity.operationId },
    });
    await expect(
      db.$transaction(async (tx) => {
        const budget = new PublicationAuthorityReadBudget();
        const projection = new ArchiveReceiptProjection(tx, budget);
        const loaded = await loadNativePlexExecutionSnapshot(
          tx,
          activity,
          budget,
          projection,
        );
        if (loaded.snapshot.kind !== "compensation")
          throw new Error("Wrong actual fixture lifecycle");
        if (change === "raw_ancestor") {
          const record = loaded.snapshot.phase.chain[0];
          if (record === undefined) throw new Error("Actual receipt missing");
          record.row.descriptorHash = "0".repeat(64);
        }
        if (change === "scope")
          loaded.snapshot.phase.authority.networkScope.request.runtimeVersion++;
        if (change === "closed") loaded.snapshot.phase.closed = true;
        const suppliedBudget =
          change === "budget" ? new PublicationAuthorityReadBudget() : budget;
        await persistNativeExecutionPlexProofBatch(tx, source.input, {
          freshness: source.freshness,
          budget: suppliedBudget,
          projection:
            change === "budget"
              ? new ArchiveReceiptProjection(tx, suppliedBudget)
              : projection,
          executionSnapshot: loaded.snapshot,
        });
      }),
    ).rejects.toThrow("snapshot changed");
    expect(
      await db.nativePlexProofBatch.count({
        where: { operationId: activity.operationId },
      }),
    ).toBe(before);
    expect(
      await db.operation.findUniqueOrThrow({
        where: { id: activity.operationId },
      }),
    ).toEqual(source.operation);
  },
);

test("execution snapshot cannot cross a transaction even on the same original budget", async () => {
  const db = harness.database();
  const budget = new PublicationAuthorityReadBudget();
  const loaded = await db.$transaction((tx) =>
    loadNativePlexExecutionSnapshot(tx, activity, budget),
  );
  await expect(
    db.$transaction((tx) =>
      persistNativeExecutionPlexProofBatch(tx, source.input, {
        freshness: source.freshness,
        budget,
        projection: new ArchiveReceiptProjection(tx, budget),
        executionSnapshot: loaded.snapshot,
      }),
    ),
  ).rejects.toThrow("another transaction/budget");
});

test("a real newer operation proof cannot replace the original observed pointer during final persistence", async () => {
  const first = source;
  const newer = await observedSource();
  expect(newer.ref.batchId).not.toBe(first.ref.batchId);
  const db = harness.database();
  const before = await db.nativePlexProofBatch.count({
    where: { operationId: activity.operationId },
  });
  await expect(
    db.$transaction(async (tx) => {
      const budget = new PublicationAuthorityReadBudget();
      const projection = new ArchiveReceiptProjection(tx, budget);
      const loaded = await loadNativePlexExecutionSnapshot(
        tx,
        activity,
        budget,
        projection,
      );
      await persistNativeExecutionPlexProofBatch(tx, first.input, {
        freshness: first.freshness,
        budget,
        projection,
        executionSnapshot: loaded.snapshot,
      });
    }),
  ).rejects.toMatchObject({ reason: "scope_changed" });
  expect(
    await db.nativePlexProofBatch.count({
      where: { operationId: activity.operationId },
    }),
  ).toBe(before);
  expect(
    await db.operation.findUniqueOrThrow({
      where: { id: activity.operationId },
    }),
  ).toEqual(newer.operation);
});

test("the original shortened SDK minimum still expires after full phase capture", async () => {
  await expect(
    harness.database().$transaction(async (tx) => {
      const budget = new PublicationAuthorityReadBudget();
      const projection = new ArchiveReceiptProjection(tx, budget);
      const loaded = await loadNativePlexExecutionSnapshot(
        tx,
        activity,
        budget,
        projection,
      );
      const original = plexBindingFreshness({
        observed: source.execution.observed,
        expiresAtMs: Math.min(source.freshness.expiresAtMs, Date.now() + 100),
        guards: [source.freshness],
      });
      await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.15)`;
      await persistNativeExecutionPlexProofBatch(tx, source.input, {
        freshness: original,
        budget,
        projection,
        executionSnapshot: loaded.snapshot,
      });
    }),
  ).rejects.toMatchObject({ reason: "verification_expired" });
});
