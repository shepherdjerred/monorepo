import { afterEach, beforeEach, expect, test } from "vitest";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { createNativeCompensationFileActivities } from "./activities.ts";
import { nativeCompensationFixture } from "./test-fixture.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>> | undefined;
let activity: NativeCompensationActivityInput | undefined;
beforeEach(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
  );
  await fixture.prepare();
  activity = await fixture.apply();
  await fixture.observe(activity);
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});
function current() {
  if (fixture === undefined || activity === undefined)
    throw new Error("Prepared protection fixture missing");
  return { f: fixture, input: activity, db: harness.database() };
}

test.each(["same_bytes_foreign_inode", "unexplained_missing_predecessor"])(
  "%s produces visible protection without compensation or historical mutation",
  async (scenario) => {
    const { f, input, db } = current();
    const canonical = workerFilePath(f.file.context, f.canonicalPath);
    const successor = await readFile(canonical);
    if (scenario === "same_bytes_foreign_inode") {
      const foreign = path.join(f.file.directory, "foreign-same-bytes");
      await writeFile(foreign, successor);
      await rename(foreign, canonical);
    } else {
      const entry = f.transition.intent;
      // The exact actual plan determines the predecessor rollback location.
      const original = PublicationIntentSchema.parse(entry).entries[0];
      if (original === undefined)
        throw new Error("Original intent entry missing");
      await rm(
        path.join(
          f.file.context.roots[original.entry.libraryKind].control,
          "rollback",
          original.entry.operationId,
        ),
      );
    }
    expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
      status: "protected",
      reason: "compensation_physical_identity_protected",
    });
    expect(await readFile(canonical)).toEqual(successor);
    const row =
      await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: input.continuationId },
      });
    expect(row.state).toBe("protected");
    expect(row.executionEvidence).toBeNull();
    expect(row.completion).toBeNull();
    expect(
      await db.mediaPublicationTransition.findUniqueOrThrow({
        where: { id: f.transition.id },
      }),
    ).toEqual(f.beforeRestore.transition);
    expect(
      await db.acquisitionReservation.count({
        where: { attemptId: f.interrupted.attempt.id },
      }),
    ).toBe(1);
  },
);

test("an invocation expiring while a canonical row lock is held cannot persist execution or mutate files", async () => {
  const { f, input, db } = current();
  const canonical = workerFilePath(f.file.context, f.canonicalPath);
  const before = await readFile(canonical);
  const { promise: barrier, resolve: release } =
    Promise.withResolvers<boolean>();
  const { promise: acquired, resolve: locked } =
    Promise.withResolvers<boolean>();
  const holder = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id=${f.file.media.id} FOR UPDATE`;
    locked(true);
    await barrier;
  });
  await acquired;
  let expired = false;
  const failure = new Error("Synthetic SDK deadline expired after lock wait");
  const activities = createNativeCompensationFileActivities(f.context, () => ({
    signal: new AbortController().signal,
    checkpoint: () => Promise.resolve(),
    assertActive: () => {
      if (expired) throw failure;
    },
  }));
  const running = activities.compensateNativePublicationFiles(input);
  // A separate connection observes the actual Activity blocked on the held row.
  try {
    for (let count = 0; count < 100; count++) {
      const blocked = await db.$queryRaw<
        { waiting: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()) AS waiting`;
      if (blocked[0]?.waiting === true) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (count === 99)
        throw new Error("Activity never reached actual held lock");
    }
    expired = true;
  } finally {
    release(true);
    await holder;
  }
  await expect(running).rejects.toBe(failure);
  expect(await readFile(canonical)).toEqual(before);
  expect(
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    }),
  ).toMatchObject({ executionEvidence: null, completion: null });
  expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
    status: "compensated",
    reason: null,
  });
});
