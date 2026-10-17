import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { prepareMediaRestore } from "./recovery.ts";
import { requireActiveRuntime } from "#automation/runtime.ts";

const { database, fixture } = automationTestHarness();

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
