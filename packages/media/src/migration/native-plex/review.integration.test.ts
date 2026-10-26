import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeFileFixture } from "#automation/native-recovery/test-fixture.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { createNativePlexObserver } from "./review.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const f = await nativeFileFixture(
    harness.database(),
    harness.context().cipher,
  );
  directories.push(f.file.directory);
  return f;
}

test("native review records actual paired observations before a new-epoch storage grant exists", async () => {
  const f = await fixture();
  const db = harness.database();
  const storage = await db.mediaStorageAuthority.findMany({
    orderBy: { rootPath: "asc" },
  });
  const lease = await db.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.published.attempt.id },
  });
  expect(storage).toHaveLength(2);
  expect(
    storage.every((row) => row.recoveryEpoch < f.runtime.recoveryEpoch),
  ).toBe(true);
  expect(lease.recoveryEpoch).toBeLessThan(f.runtime.recoveryEpoch);
  await f.observe();
  expect(
    await db.nativePlexProofBatch.count({
      where: { operationId: f.prepareInput.operationId },
    }),
  ).toBe(1);
  expect(f.wire.calls.at(-1)?.pathname).toBe("/status/sessions");
  expect(
    await db.mediaStorageAuthority.findMany({ orderBy: { rootPath: "asc" } }),
  ).toEqual(storage);
  expect(
    await db.legacyWriterLease.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toEqual(lease);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    }),
  ).toEqual(attempt);
  expect(
    await db.nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
});

test("native apply observation projects only command IDs while preserving the original stored apply command", async () => {
  const f = await fixture();
  const approval = await f.review();
  const db = harness.database();
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: f.planId },
  });
  const command = Object.freeze({
    planId: f.planId,
    operationId: z.uuid().parse(approval.operationId),
    planHash: z.string().parse(plan.planHash),
  });
  const original = await db.operation.findUniqueOrThrow({
    where: { id: command.operationId },
  });
  expect(original.payload).toMatchObject(command);
  await createNativePlexObserver(f.observerContext)(
    command,
    bindingTestExecution(),
  );
  expect(
    await db.nativePlexProofBatch.count({
      where: { operationId: command.operationId },
    }),
  ).toBe(1);
  expect(f.wire.calls.at(-1)?.pathname).toBe("/status/sessions");
  expect(command).toEqual({
    planId: f.planId,
    operationId: approval.operationId,
    planHash: plan.planHash,
  });
  const current = await db.operation.findUniqueOrThrow({
    where: { id: original.id },
  });
  expect(current.payload).toEqual(original.payload);
  expect(current.kind).toBe(original.kind);
  expect(current.targetId).toBe(original.targetId);
});

test.each(["writer_revocation", "storage_revocation", "changed_root"] as const)(
  "native review refuses %s arriving during its final actual sessions request",
  async (change) => {
    const f = await fixture();
    const db = harness.database();
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: f.prepareInput.operationId },
    });
    let reached = false;
    f.observerContext.plex = f.wire.create(async (url) => {
      if (url.pathname !== "/status/sessions") return;
      reached = true;
      if (change === "writer_revocation") {
        await db.legacyWriterLease.update({
          where: { id: "singleton" },
          data: {
            recoveryEpoch: f.runtime.recoveryEpoch,
            observedAt: new Date(),
            revokedAt: new Date(),
          },
        });
      } else {
        await db.mediaStorageAuthority.update({
          where: { rootPath: "/data/movies" },
          data:
            change === "storage_revocation"
              ? {
                  recoveryEpoch: f.runtime.recoveryEpoch,
                  observedAt: new Date(),
                  revokedAt: new Date(),
                }
              : { volumePath: "/changed-storage-identity" },
        });
      }
      return;
    });
    if (change === "changed_root")
      await expect(f.observe()).rejects.toThrow(
        "Native recovery storage has no matching durable owner-approved receipt",
      );
    else
      await expect(f.observe()).rejects.toMatchObject({
        reason: "ownership_changed",
      });
    expect(reached).toBe(true);
    expect(
      await db.nativePlexProofBatch.count({
        where: { operationId: f.prepareInput.operationId },
      }),
    ).toBe(0);
    expect(
      await db.nativeRecoveryObservation.count({ where: { planId: f.planId } }),
    ).toBe(0);
    expect(
      await db.operation.findUniqueOrThrow({ where: { id: operation.id } }),
    ).toEqual(operation);
    expect(
      await db.nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
    ).toBe(0);
  },
);
