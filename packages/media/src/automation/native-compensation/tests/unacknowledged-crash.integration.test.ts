import { afterEach, beforeEach, expect, test } from "vitest";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import { nativeCompensationFixture } from "#automation/native-compensation/test-fixture.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>> | undefined;
beforeEach(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
    { unacknowledgedKill: true },
  );
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test("SIGKILL after an actual sidecar link but before durable ACK protects the unacknowledged mutation", async () => {
  const f = fixture;
  if (f === undefined) throw new Error("Unacknowledged crash fixture missing");
  const db = harness.database();
  const item = PublicationIntentSchema.parse(f.transition.intent).entries[0];
  const sidecar = item?.entry.previousSidecars[0];
  if (item === undefined || sidecar === undefined)
    throw new Error("Actual sidecar descriptor missing");
  const roots = f.file.context.roots[item.entry.libraryKind];
  const source = path.join(roots.library, sidecar.libraryPath);
  const target = path.join(roots.control, "quarantine", sidecar.quarantineId);
  const before = await stat(source);
  const linked = await stat(target);
  expect({ dev: linked.dev, ino: linked.ino }).toEqual({
    dev: before.dev,
    ino: before.ino,
  });
  expect(await readFile(target)).toEqual(await readFile(source));
  const records = path.join(
    roots.control,
    "publication-transitions",
    f.transition.id,
    "publication",
  );
  expect(await readdir(records)).toEqual([]);
  await expect(f.prepare()).rejects.toBeInstanceOf(FileOperationConflict);
  expect(await readdir(records)).toEqual([]);
  expect(
    await db.nativeRecoveryReceipt.count({ where: { planId: f.input.planId } }),
  ).toBe(0);
  expect(
    await db.nativePublicationCompensationContinuation.count({
      where: { transitionId: f.transition.id },
    }),
  ).toBe(0);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.interrupted.attempt.id },
    }),
  ).toEqual(f.beforeRestore.attempt);
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: f.transition.id },
    }),
  ).toEqual(f.beforeRestore.transition);
  expect(await stat(target)).toMatchObject({
    dev: before.dev,
    ino: before.ino,
  });
});
