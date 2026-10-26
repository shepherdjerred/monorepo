import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { PrismaRecovery } from "#infrastructure/recovery/service.ts";
import { CleanupNativeArchiveInputSchema } from "#shared/native-recovery/archive.ts";
import { observePairedArchiveCleanup } from "#migration/native-plex/archive.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import { queueNativeArchiveCleanup } from "./continuation.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
test("real household review releases archive hold; closed coordinator retry preserves original cleanup authority", async () => {
  const db = harness.database();
  const f = await nativeArchiveFixture(db, harness.context().cipher, {
    chain: 2,
    publicationAgeDays: 8,
  });
  directories.push(f.file.directory);
  await f.prepare();
  await f.apply();
  const continuation =
    await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
      where: { originalCleanupId: f.first.id },
    });
  const oldCleanup = await db.upgradeCleanup.findUniqueOrThrow({
    where: { id: f.first.id },
  });
  const operationId = z.uuid().parse(
    await db.$transaction((tx) =>
      queueNativeArchiveCleanup(tx, {
        continuationId: continuation.id,
        expectedVersion: continuation.version,
      }),
    ),
  );
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const input = CleanupNativeArchiveInputSchema.parse(operation.payload);
  const observe = (command: typeof input) =>
    observePairedArchiveCleanup(
      f.observerContext,
      command,
      bindingTestExecution(),
    );
  expect(await observe(input)).toMatchObject({ status: "protected" });
  const blocked = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: continuation.id },
  });
  expect(blocked.executionEvidence).toBeNull();
  expect(
    await db.$transaction((tx) =>
      queueNativeArchiveCleanup(tx, {
        continuationId: blocked.id,
        expectedVersion: blocked.version,
      }),
    ),
  ).toBeNull();
  for (const user of await db.mediaUser.findMany()) {
    const relevant = [f.prior.actor.id, f.file.user.id].includes(user.id);
    const mapping = {
      serverMachineId: "server",
      kind: "account",
      homeUserId: null,
      permittedSectionIds: relevant ? ["1"] : ["2"],
      permittedMediaKinds: relevant ? ["movie"] : ["series"],
      plexRestricted: false,
      verifiedAt: new Date(),
    };
    await db.plexIdentityMapping.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...mapping },
      update: { ...mapping, version: { increment: 1 } },
    });
  }
  const household = new PrismaRecovery(db, "server");
  const prepared = await household.prepare(f.prior.actor, crypto.randomUUID(), {
    mediaIds: [f.file.media.id],
  });
  const id = z.uuid().parse(prepared.recoveryReviewId);
  const initial = await household.detail(f.prior.actor, id);
  expect(initial.scope.blockers).toEqual([]);
  expect(initial.scope.nativeReceipts).toHaveLength(1);
  for (const actor of [f.prior.actor, f.file.user])
    await household.respond(actor, crypto.randomUUID(), id, {
      scopeHash: initial.scopeHash,
      declarations: [{ mediaId: f.file.media.id, intent: "request" }],
      acknowledgePending: true,
    });
  const reviewed = await household.detail(f.prior.actor, id);
  await household.release(f.prior.actor, crypto.randomUUID(), id, {
    expectedVersion: reviewed.version,
    scopeHash: reviewed.scopeHash,
    responseHash: z.string().parse(reviewed.responseHash),
    confirmHouseholdBaseline: true,
    confirmExistingPins: true,
    acknowledgeMissingHistory: true,
  });
  const current = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: blocked.id },
  });
  expect(
    await db.$transaction((tx) =>
      queueNativeArchiveCleanup(tx, {
        continuationId: current.id,
        expectedVersion: current.version,
        previousWorkflowClosed: {
          operationId: crypto.randomUUID(),
          workflowId: `media-operation-${operationId}`,
          status: "COMPLETED",
        },
      }),
    ),
  ).toBeNull();
  const retryId = z.uuid().parse(
    await db.$transaction((tx) =>
      queueNativeArchiveCleanup(tx, {
        continuationId: current.id,
        expectedVersion: current.version,
        previousWorkflowClosed: {
          operationId,
          workflowId: `media-operation-${operationId}`,
          status: "COMPLETED",
        },
      }),
    ),
  );
  expect(retryId).not.toBe(operationId);
  const retryOperation = await db.operation.findUniqueOrThrow({
    where: { id: retryId },
  });
  const retry = CleanupNativeArchiveInputSchema.parse(retryOperation.payload);
  await expect(observe(input)).rejects.toThrow(
    "Archive coordinator or raw descriptor changed",
  );
  expect(await observe(retry)).toEqual({ status: "ready" });
  expect(
    await createNativeArchiveFileActivities(
      f.context,
      f.execution,
    ).cleanupNativeArchiveFiles(retry),
  ).toEqual({ status: "cleaned" });
  const settled = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: current.id },
  });
  expect(settled.descriptor).toEqual(continuation.descriptor);
  expect(settled.receiptId).toBe(continuation.receiptId);
  expect(
    await db.upgradeCleanup.findUniqueOrThrow({ where: { id: f.first.id } }),
  ).toEqual(oldCleanup);
});
