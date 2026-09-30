import { afterAll, describe, expect, test } from "vitest";
import {
  RecoveryBatchIdSchema,
  type RecoveryBatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  abandonBatch,
  beginProcessing,
  beginScan,
  operatorReleasePolicy,
  recordProcessingProgress,
} from "@scout-for-lol/domain/recovery/batch-transitions.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  matchRecoveryBatchRowToRecord,
  type MatchRecoveryBatchRecord,
} from "#src/database/durable/recovery-row.ts";
import {
  advanceRecoveryCursor,
  createRecoveryBatch,
  getRecoveryBatch,
  transitionRecoveryBatch,
} from "#src/database/durable/recovery-repository.ts";

const { prisma } = createTestDatabase("durable-recovery-repository");

afterAll(async () => {
  await prisma.$disconnect();
});

const AT = new Date("2026-09-07T10:00:00.000Z");

function batch(
  id: string,
  overrides: Partial<{ policy: string; workflowId: string | null }> = {},
): MatchRecoveryBatchRecord {
  return matchRecoveryBatchRowToRecord({
    recoveryBatchId: id,
    policy: "normal",
    state: "planned",
    cursorPosition: null,
    pagesScanned: null,
    pageBudget: null,
    discoveredCount: null,
    succeededCount: null,
    suppressedCount: null,
    failedCount: null,
    abandonReason: null,
    workflowId: null,
    createdAt: AT,
    ...overrides,
  });
}

function batchId(id: string): RecoveryBatchId {
  return RecoveryBatchIdSchema.parse(id);
}

describe("createRecoveryBatch", () => {
  test("applies once and answers an identical retry with already-applied", async () => {
    const record = batch("rb-create-1");
    expect(await createRecoveryBatch(prisma, record)).toEqual({
      outcome: "applied",
    });
    expect(await createRecoveryBatch(prisma, record)).toEqual({
      outcome: "already-applied",
    });
  });

  test("conflicts when the batch id exists with different facts", async () => {
    await createRecoveryBatch(prisma, batch("rb-create-2"));
    expect(
      await createRecoveryBatch(
        prisma,
        batch("rb-create-2", { policy: "no-external" }),
      ),
    ).toEqual({ outcome: "conflict", reason: "batch-differs" });
  });

  test("conflicts when another batch already adopted the workflow id", async () => {
    await createRecoveryBatch(
      prisma,
      batch("rb-create-3", { workflowId: "wf-shared" }),
    );
    expect(
      await createRecoveryBatch(
        prisma,
        batch("rb-create-4", { workflowId: "wf-shared" }),
      ),
    ).toEqual({
      outcome: "conflict",
      reason: "workflow-adopted-by-another-batch",
    });
  });
});

async function scanningBatch(id: string): Promise<void> {
  await createRecoveryBatch(prisma, batch(id));
  const began = await transitionRecoveryBatch(prisma, {
    recoveryBatchId: batchId(id),
    transition: (value) => beginScan(value, { pageBudget: 3 }),
  });
  expect(began.outcome).toBe("applied");
}

describe("advanceRecoveryCursor", () => {
  test("advances page by page, guarded by the expected position", async () => {
    await scanningBatch("rb-scan-1");
    const id = batchId("rb-scan-1");

    const advanced = await advanceRecoveryCursor(prisma, {
      recoveryBatchId: id,
      expectedPosition: undefined,
      nextPosition: "p1",
    });
    expect(advanced.outcome).toBe("applied");
    // A delayed retry of the same advance is idempotent.
    expect(
      await advanceRecoveryCursor(prisma, {
        recoveryBatchId: id,
        expectedPosition: undefined,
        nextPosition: "p1",
      }),
    ).toEqual({ outcome: "already-applied" });
    // An advance from a stale view of the cursor conflicts.
    expect(
      await advanceRecoveryCursor(prisma, {
        recoveryBatchId: id,
        expectedPosition: undefined,
        nextPosition: "p2",
      }),
    ).toEqual({ outcome: "conflict", reason: "stale-cursor" });

    const stored = await getRecoveryBatch(prisma, { recoveryBatchId: id });
    expect(stored?.batch.state).toEqual({
      kind: "scanning",
      cursor: { position: "p1", pagesScanned: 1, pageBudget: 3 },
    });
  });

  test("exactly one of two concurrent advances from the same position applies", async () => {
    await scanningBatch("rb-scan-2");
    const id = batchId("rb-scan-2");
    const outcomes = await Promise.all([
      advanceRecoveryCursor(prisma, {
        recoveryBatchId: id,
        expectedPosition: undefined,
        nextPosition: "worker-a-p1",
      }),
      advanceRecoveryCursor(prisma, {
        recoveryBatchId: id,
        expectedPosition: undefined,
        nextPosition: "worker-b-p1",
      }),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "applied",
      "conflict",
    ]);
    const stored = await getRecoveryBatch(prisma, { recoveryBatchId: id });
    expect(stored?.batch.state.kind).toBe("scanning");
  });

  test("advancing a batch that was never created fails loudly", async () => {
    await expect(
      advanceRecoveryCursor(prisma, {
        recoveryBatchId: batchId("rb-ghost"),
        expectedPosition: undefined,
        nextPosition: "p1",
      }),
    ).rejects.toThrow(/never created/);
  });
});

describe("processing counts", () => {
  test("count progress is guarded, idempotent, and monotone in Postgres", async () => {
    await scanningBatch("rb-proc-1");
    const id = batchId("rb-proc-1");
    const began = await transitionRecoveryBatch(prisma, {
      recoveryBatchId: id,
      transition: (value) => beginProcessing(value, { discovered: 3 }),
    });
    expect(began.outcome).toBe("applied");

    const counts = { discovered: 3, succeeded: 2, suppressed: 0, failed: 1 };
    const progressed = await transitionRecoveryBatch(prisma, {
      recoveryBatchId: id,
      transition: (value) => recordProcessingProgress(value, { counts }),
    });
    expect(progressed.outcome).toBe("applied");
    expect(
      await transitionRecoveryBatch(prisma, {
        recoveryBatchId: id,
        transition: (value) => recordProcessingProgress(value, { counts }),
      }),
    ).toEqual({ outcome: "already-applied" });
    expect(
      await transitionRecoveryBatch(prisma, {
        recoveryBatchId: id,
        transition: (value) =>
          recordProcessingProgress(value, {
            counts: { ...counts, succeeded: 1 },
          }),
      }),
    ).toEqual({ outcome: "conflict", reason: "counts-regressed" });

    const stored = await getRecoveryBatch(prisma, { recoveryBatchId: id });
    expect(stored?.batch.state).toEqual({ kind: "processing", counts });
  });
});

describe("policy and terminal transitions", () => {
  test("releases no-external to stale-private-only but never to normal", async () => {
    await createRecoveryBatch(
      prisma,
      batch("rb-policy-1", { policy: "no-external" }),
    );
    const id = batchId("rb-policy-1");
    const released = await transitionRecoveryBatch(prisma, {
      recoveryBatchId: id,
      transition: (value) =>
        operatorReleasePolicy(value, { to: "stale-private-only" }),
    });
    expect(released.outcome).toBe("applied");
    expect(
      await transitionRecoveryBatch(prisma, {
        recoveryBatchId: id,
        transition: (value) => operatorReleasePolicy(value, { to: "normal" }),
      }),
    ).toEqual({ outcome: "conflict", reason: "policy-release-forbidden" });
    const stored = await getRecoveryBatch(prisma, { recoveryBatchId: id });
    expect(stored?.batch.policy).toBe("stale-private-only");
  });

  test("abandonment persists its reason and stays terminal", async () => {
    await createRecoveryBatch(prisma, batch("rb-abandon-1"));
    const id = batchId("rb-abandon-1");
    const abandoned = await transitionRecoveryBatch(prisma, {
      recoveryBatchId: id,
      transition: (value) =>
        abandonBatch(value, { reason: "operator-cancelled" }),
    });
    expect(abandoned.outcome).toBe("applied");
    expect(
      await transitionRecoveryBatch(prisma, {
        recoveryBatchId: id,
        transition: (value) => beginScan(value, { pageBudget: 3 }),
      }),
    ).toEqual({ outcome: "conflict", reason: "terminal-state" });
  });
});
