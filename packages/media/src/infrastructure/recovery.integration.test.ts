import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { prepareMediaRestore } from "./recovery.ts";
import { requireActiveRuntime } from "#automation/runtime.ts";

const { database, fixture } = automationTestHarness();

test("restoring rows that lost a later requester creates an independent unreleased hold even when file bytes did not change", async () => {
  const data = await fixture();
  const db = database();
  const asset = await db.libraryAsset.create({
    data: {
      path: `/fixture/${crypto.randomUUID()}.mkv`,
      owned: true,
      ownershipEpoch: 0,
      state: "published",
      checksum: "a".repeat(64),
      sizeBytes: 10,
      properties: {},
      coverage: { create: { mediaId: data.media.id, current: true } },
    },
  });
  const later = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Post-backup requester",
    },
  });
  await db.mediaRequest.create({
    data: { userId: later.id, mediaId: data.media.id },
  });
  // Restoring the older snapshot loses this later claim but preserves identical file evidence.
  await db.mediaRequest.delete({
    where: {
      userId_mediaId_edition: {
        edition: "default",
        userId: later.id,
        mediaId: data.media.id,
      },
    },
  });
  await prepareMediaRestore(db, {
    recoveryId: crypto.randomUUID(),
    expectedEpoch: 0,
    reason: "Isolated older backup",
  });
  expect(
    await db.recoveryHold.findUniqueOrThrow({
      where: targetWhere(defaultScope(data.media.id)),
    }),
  ).toMatchObject({
    recoveryEpoch: 1,
    releasedAt: null,
    reason: "recovery_request_history_unconfirmed",
  });
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
  ).toMatchObject({ checksum: "a".repeat(64), ownershipEpoch: 0 });
});

test("restored active backup is placed into observe with a new epoch exactly once before workers reconnect", async () => {
  await fixture();
  const db = database();
  expect(await requireActiveRuntime(db)).toEqual({ active: true, epoch: 0 });
  const input = {
    recoveryId: crypto.randomUUID(),
    expectedEpoch: 0,
    reason: "Restored isolated backup",
  };
  const receipts = await Promise.all([
    prepareMediaRestore(db, input),
    prepareMediaRestore(db, input),
  ]);
  expect(receipts[0]).toEqual(receipts[1]);
  expect(await requireActiveRuntime(db)).toEqual({ active: false, epoch: 1 });
  expect(
    await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toMatchObject({ mode: "observe", ownershipConfirmed: false });
  await expect(
    prepareMediaRestore(db, { ...input, reason: "different" }),
  ).rejects.toMatchObject({ code: "recovery_conflict" });
  await expect(
    prepareMediaRestore(db, { ...input, recoveryId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ code: "recovery_epoch_conflict" });
  await prepareMediaRestore(db, {
    ...input,
    recoveryId: crypto.randomUUID(),
    expectedEpoch: 1,
  });
  await expect(prepareMediaRestore(db, input)).rejects.toMatchObject({
    code: "recovery_changed",
  });
});
