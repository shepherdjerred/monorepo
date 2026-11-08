import { afterAll, expect, test } from "vitest";
import { rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { NativePublishedScopeV2Schema } from "#shared/native-recovery/lifecycle.ts";
import { nativeFileFixture } from "./test-fixture.ts";
import { settleTerminalPublication } from "./terminal-test-support.ts";
import { nativeLocalPath, prepareNativeFiles } from "./files.ts";
import { applyPreparedNative } from "./apply.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function fixture(kind: "purged" | "cancelled") {
  const result = await nativeFileFixture(
    harness.database(),
    harness.context().cipher,
    "removed",
    {
      serverMachineId: "fixture-server",
      publication: preparePhysicalPublication,
      settle: settleTerminalPublication(harness.database(), kind, {
        context: harness.context(),
      }),
    },
  );
  directories.push(result.file.directory);
  return result;
}

test.each(["purged", "cancelled"] as const)(
  "actual upgrade %s history restores published authority without granting archives",
  async (kind) => {
    const f = await fixture(kind);
    const db = harness.database();
    const approval = await f.review();
    const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
      where: { id: f.planId },
    });
    const scope = NativePublishedScopeV2Schema.parse(plan.scope);
    expect(scope.terminalDependencies).toHaveLength(1);
    await f.observe();
    await f.activities.applyNativeRecoveryFiles({
      planId: f.planId,
      operationId: z.uuid().parse(approval.operationId),
    });
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({ ownershipEpoch: 1, state: "published" });
    const historical = await db.libraryAsset.findMany({
      where: {
        id: {
          in: scope.terminalDependencies
            .flatMap((item) => item.assetIds)
            .filter((id) => id !== f.asset.id),
        },
      },
    });
    expect(historical).toHaveLength(1);
    expect(historical[0]).toMatchObject({
      ownershipEpoch: 0,
      state: kind === "purged" ? "purged" : "rejected",
    });
    expect(
      await db.upgradeCleanup.findMany({
        where: {
          id: { in: scope.terminalDependencies.map((item) => item.cleanupId) },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: kind, recoveryEpoch: 0 }),
      ]),
    );
  },
);

test("a purged backup reappearing after proof prevents the native grant", async () => {
  const f = await fixture("purged");
  const approval = await f.review();
  await f.observe();
  const prepared = await prepareNativeFiles(f.context, {
    planId: f.planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  const scope = NativePublishedScopeV2Schema.parse(prepared.scope);
  const dependency = scope.terminalDependencies[0]?.files[0];
  if (dependency === undefined) throw new Error("Terminal dependency missing");
  await writeFile(
    nativeLocalPath(f.context, dependency.canonicalPath),
    "unexpected returned archive",
  );
  await expect(
    applyPreparedNative(
      f.context,
      { planId: f.planId, operationId: z.uuid().parse(approval.operationId) },
      prepared,
    ),
  ).rejects.toThrow("Previously absent media path was created");
  expect(
    await harness
      .database()
      .nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
});

test("terminal state alone cannot replace the exact completed purge journal", async () => {
  const f = await fixture("purged");
  await f.observe();
  const plan = await harness
    .database()
    .nativeRecoveryPlan.findUniqueOrThrow({ where: { id: f.planId } });
  const scope = NativePublishedScopeV2Schema.parse(plan.scope);
  const expected = scope.terminalDependencies[0]?.journals[0];
  if (expected === undefined) throw new Error("Purge journal missing");
  const filename = path.join(
    f.file.roots.control,
    "journal",
    `${expected.operationId}.json`,
  );
  const manifest = ManifestSchema.parse(
    JSON.parse(await readFile(filename, "utf8")),
  );
  await writeFile(
    filename,
    JSON.stringify({ ...manifest, sha256: "f".repeat(64) }),
  );
  await expect(prepareNativeFiles(f.context, f.prepareInput)).rejects.toThrow(
    "does not prove the recorded effect",
  );
  expect(
    await harness
      .database()
      .nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
});

test("a changed settled cleanup row invalidates owner review before any grant", async () => {
  const f = await fixture("cancelled");
  const approval = await f.review();
  await f.observe();
  const prepared = await prepareNativeFiles(f.context, {
    planId: f.planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  const scope = NativePublishedScopeV2Schema.parse(prepared.scope);
  const cleanupId = z.uuid().parse(scope.terminalDependencies[0]?.cleanupId);
  await harness.database().upgradeCleanup.update({
    where: { id: cleanupId },
    data: { state: "completed", version: { increment: 1 } },
  });
  await expect(
    applyPreparedNative(
      f.context,
      { planId: f.planId, operationId: z.uuid().parse(approval.operationId) },
      prepared,
    ),
  ).rejects.toThrow("cancelled cleanup graph is inconsistent");
  expect(
    await harness
      .database()
      .nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
});

test("a second restored backup follows the exact native receipt after a settled rollback", async () => {
  const f = await fixture("cancelled");
  const first = await f.review();
  await f.observe();
  await f.activities.applyNativeRecoveryFiles({
    planId: f.planId,
    operationId: z.uuid().parse(first.operationId),
  });
  const db = harness.database();
  const recoveryId = crypto.randomUUID();
  await prepareMediaRestore(db, {
    recoveryId,
    expectedEpoch: 1,
    reason: "Repeated terminal rollback restore",
  });
  const proofs = await grantTestExclusionProofs(
    db,
    f.prior.actor.id,
    z.string().parse(f.file.context.serverMachineId),
  );
  for (const proof of proofs) {
    const roots =
      f.context.files.roots[
        proof.libraryRoot === "/data/movies" ? "movies" : "tv"
      ];
    await writeFile(
      path.join(roots.library, ".plexignore"),
      proof.rootMarkerAfter,
    );
    await writeFile(
      path.join(roots.control, ".plexignore"),
      proof.controlMarkerAfter,
    );
  }
  const restore = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `restore-observe:${recoveryId}` },
  });
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const receipt = await db.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { planId: f.planId },
  });
  await expect(
    db.nativeRecoveryReceipt.update({
      where: { id: receipt.id },
      data: { planHash: "f".repeat(64) },
    }),
  ).rejects.toThrow("immutable");
  const command = await f.service.prepare(f.prior.actor, crypto.randomUUID(), {
    restoreOperationId: restore.id,
    recoveryEpoch: 2,
    runtimeVersion: runtime.version,
    activation: "activate",
    assetIds: [f.asset.id],
  });
  const planId = z.uuid().parse(command.nativeRecoveryId);
  await f.observe({ planId, operationId: z.uuid().parse(command.operationId) });
  await f.activities.prepareNativeRecoveryFiles({
    planId,
    operationId: z.uuid().parse(command.operationId),
  });
  const detail = await f.service.detail(f.prior.actor, planId);
  const approval = await f.service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    planId,
    {
      expectedVersion: detail.version,
      planHash: z.string().parse(detail.planHash),
      recoveryEpoch: 2,
      runtimeVersion: runtime.version,
      acknowledgePhysicalOwnershipOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSubtitlePolicies: true,
    },
  );
  await f.observe({
    planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  await f.activities.applyNativeRecoveryFiles({
    planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ version: f.asset.version + 2, ownershipEpoch: 2 });
  const scope = NativePublishedScopeV2Schema.parse(detail.scope);
  expect(
    await db.upgradeCleanup.findUniqueOrThrow({
      where: { id: z.uuid().parse(scope.terminalDependencies[0]?.cleanupId) },
    }),
  ).toMatchObject({ state: "cancelled", recoveryEpoch: 0 });
  expect(
    await db.acquisitionAttempt.findMany({
      where: { mediaIds: { has: f.file.media.id } },
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ state: "rolled_back", recoveryEpoch: 0 }),
    ]),
  );
});
