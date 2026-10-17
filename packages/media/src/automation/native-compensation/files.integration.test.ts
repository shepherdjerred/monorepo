import { afterAll, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { automationTestHarness } from "#testing/automation.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { NativeCompensationCompletionSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { nativeCompensationFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("actual complete video ACK followed by PG rollback restores the exact predecessor without rewriting birth history", async () => {
  const db = harness.database();
  const f = await nativeCompensationFixture(db, harness.context().cipher);
  directories.push(f.file.directory);
  const originalAttempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.interrupted.attempt.id },
  });
  const originalTransition =
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: f.transition.id },
    });
  expect(originalTransition.outcome).toBeNull();
  expect(originalTransition).toEqual(f.beforeRestore.transition);
  expect(originalAttempt).toEqual(f.beforeRestore.attempt);
  await f.prepare();
  const input = await f.apply();
  await f.observe(input);
  expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
    status: "compensated",
    reason: null,
  });
  const row =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    });
  const completion = NativeCompensationCompletionSchema.parse(row.completion);
  expect(completion.predecessorBindings).toHaveLength(1);
  const rejected = completion.retainedArtifacts.find(
    (item) =>
      item.assetId !== f.asset.id &&
      item.role === "rollback" &&
      item.physical.state === "present",
  );
  if (rejected?.physical.state !== "present")
    throw new Error("Durable retained successor proof missing");
  const retainedBytes = await readFile(
    path.join(
      f.file.context.roots[rejected.libraryKind][rejected.physical.root],
      rejected.physical.path,
    ),
  );
  expect(retainedBytes.toString()).toBe(f.interrupted.content);
  expect(createHash("sha256").update(retainedBytes).digest("hex")).toBe(
    rejected.physical.sha256,
  );
  expect(row.fenceRelease).toBeNull();
  expect(row.verifiedPublication).toBeNull();
  const media = await db.mediaItem.findUniqueOrThrow({
    where: { id: f.file.media.id },
  });
  expect(media.availability).toBe("importing");
  expect(
    await db.assetCoverage.findMany({
      where: { mediaId: f.file.media.id, current: true },
      select: { assetId: true },
    }),
  ).toEqual([{ assetId: f.asset.id }]);
  expect(
    await readFile(workerFilePath(f.file.context, f.canonicalPath), "utf8"),
  ).toBe(f.published.content);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: originalAttempt.id },
    }),
  ).toEqual(originalAttempt);
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: originalTransition.id },
    }),
  ).toEqual(originalTransition);
  expect(
    await db.acquisitionReservation.count({
      where: { attemptId: originalAttempt.id },
    }),
  ).toBe(0);
  expect(
    await db.recoveryHold.count({
      where: { mediaId: f.file.media.id, releasedAt: null },
    }),
  ).toBe(1);
  expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
    status: "compensated",
    reason: null,
  });
  expect(
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: row.id },
    }),
  ).toEqual(row);
});
