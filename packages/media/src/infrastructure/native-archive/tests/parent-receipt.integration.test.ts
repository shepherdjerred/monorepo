import { rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeCompensationFixture } from "#automation/native-compensation/test-fixture.ts";
import { compensationRecord } from "#infrastructure/native-compensation/records.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { ArchiveReceiptProjection } from "#infrastructure/native-archive/receipt-projection.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { NativePlexProofRefSchema } from "#shared/plex-binding/native.ts";
import { loadNativePlexProofBatch } from "#infrastructure/plex-binding/native/native.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let activity: NativeCompensationActivityInput;

beforeAll(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
  );
  await fixture.prepare();
  activity = await fixture.apply();
  await fixture.observe(activity);
  expect(
    await fixture.activities.compensateNativePublicationFiles(activity),
  ).toEqual({
    status: "compensated",
    reason: null,
  });
}, 60_000);

afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test("same-transaction compensation reads share complete native parents while reading mutable continuation state afresh", async () => {
  const db = harness.database();
  const before =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    });
  const rollback = new Error("rollback deliberate continuation version change");
  await expect(
    db.$transaction(async (tx) => {
      const budget = new PublicationAuthorityReadBudget();
      const projection = new ArchiveReceiptProjection(tx, budget);
      const pairs = vi.spyOn(tx.nativePlexProofBatch, "findUniqueOrThrow");
      try {
        const first = await compensationRecord(
          tx,
          activity.continuationId,
          budget,
          projection,
        );
        const pairedReads = pairs.mock.calls.length;
        expect(pairedReads).toBeGreaterThan(0);
        const remaining = budget.take;
        await tx.nativePublicationCompensationContinuation.update({
          where: { id: activity.continuationId },
          data: { version: { increment: 1 } },
        });
        const second = await compensationRecord(
          tx,
          activity.continuationId,
          budget,
          projection,
        );
        expect(second.row.version).toBe(first.row.version + 1);
        expect(second.descriptor).toEqual(first.descriptor);
        expect(second.completion).toEqual(first.completion);
        expect(pairs).toHaveBeenCalledTimes(pairedReads);
        expect(budget.take).toBeLessThan(remaining);
      } finally {
        pairs.mockRestore();
      }
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    }),
  ).toEqual(before);
});

test("a shared compensation parent validator refuses a changed raw receipt and a different counter", async () => {
  await harness.database().$transaction(async (tx) => {
    const budget = new PublicationAuthorityReadBudget();
    const projection = new ArchiveReceiptProjection(tx, budget);
    const record = await compensationRecord(
      tx,
      activity.continuationId,
      budget,
      projection,
    );
    await expect(
      projection.validateQueried(
        tx,
        {
          ...record.row.receipt,
          planHash: "f".repeat(64),
        },
        budget,
      ),
    ).rejects.toThrow("Archive queried immutable receipt changed within phase");
    await expect(
      compensationRecord(
        tx,
        activity.continuationId,
        new PublicationAuthorityReadBudget(),
        projection,
      ),
    ).rejects.toThrow("another transaction or budget");
  });
});

test("a completed parent closure cannot cross a transaction boundary", async () => {
  const db = harness.database();
  const previous = await db.$transaction(async (tx) => {
    const budget = new PublicationAuthorityReadBudget();
    const projection = new ArchiveReceiptProjection(tx, budget);
    await compensationRecord(tx, activity.continuationId, budget, projection);
    return { budget, projection };
  });
  await expect(
    db.$transaction((tx) =>
      compensationRecord(
        tx,
        activity.continuationId,
        previous.budget,
        previous.projection,
      ),
    ),
  ).rejects.toThrow("another transaction or budget");
});

test("execution batch readback shares only immutable parents while charging and rereading its current continuation", async () => {
  const db = harness.database();
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: activity.operationId },
  });
  const ref = z
    .object({ nativePlexProof: NativePlexProofRefSchema })
    .parse(operation.result).nativePlexProof;
  const rollback = new Error("rollback execution readback version probe");
  await expect(
    db.$transaction(async (tx) => {
      const budget = new PublicationAuthorityReadBudget();
      const projection = new ArchiveReceiptProjection(tx, budget);
      const batches = vi.spyOn(tx.nativePlexProofBatch, "findUniqueOrThrow");
      const continuations = vi.spyOn(
        tx.nativePublicationCompensationContinuation,
        "findUniqueOrThrow",
      );
      try {
        const first = await loadNativePlexProofBatch(tx, ref, ref.parent, {
          budget,
          receiptProjection: projection,
        });
        const initialBatchReads = batches.mock.calls.length;
        const initialContinuationReads = continuations.mock.calls.length;
        expect(initialBatchReads).toBeGreaterThan(1);
        const remaining = budget.take;
        const changed =
          await tx.nativePublicationCompensationContinuation.update({
            where: { id: activity.continuationId },
            data: { version: { increment: 1 } },
          });
        const second = await loadNativePlexProofBatch(tx, ref, ref.parent, {
          budget,
          receiptProjection: projection,
        });
        expect(second.ref).toEqual(first.ref);
        expect(batches).toHaveBeenCalledTimes(initialBatchReads + 1);
        expect(continuations).toHaveBeenCalledTimes(
          initialContinuationReads + 1,
        );
        const current = continuations.mock.results.at(-1);
        if (current?.type !== "return")
          throw new Error("Execution readback continuation result missing");
        const currentRow = await current.value;
        expect(currentRow.version).toBe(changed.version);
        // One actual five-row batch read plus the fresh continuation row.
        expect(remaining - budget.take).toBe(6);
        const queried = batches.mock.calls.length;
        await expect(
          loadNativePlexProofBatch(tx, ref, ref.parent, {
            budget: new PublicationAuthorityReadBudget(),
            receiptProjection: projection,
          }),
        ).rejects.toThrow("another transaction or budget");
        expect(batches).toHaveBeenCalledTimes(queried);
      } finally {
        try {
          batches.mockRestore();
        } finally {
          continuations.mockRestore();
        }
      }
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
