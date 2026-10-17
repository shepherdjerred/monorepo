import { afterEach, beforeEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { restoreNativeFixtureAgain } from "#automation/native-compensation/native-grant-fixture.ts";
import {
  captureInterruptedPublicationWork,
  nativeCompensationLifecycle,
} from "#infrastructure/publication-proof/lifecycle.ts";
import { nativeAttempt } from "#infrastructure/native-recovery/snapshots.ts";
import { compensatedCaptionFixture } from "./caption.test-support.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof compensatedCaptionFixture>> | undefined;
beforeEach(async () => {
  fixture = await compensatedCaptionFixture(
    harness.database(),
    harness.context(),
  );
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.f.file.directory, { recursive: true, force: true });
});

test("a later interrupted publication preserves both attempts and consumes only the exact earlier completed settlement", async () => {
  if (fixture === undefined)
    throw new Error("Completed compensation fixture missing");
  const { f } = fixture;
  const db = harness.database();
  const original = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.interrupted.attempt.id },
  });
  const acquired = await f.file.acquisition(
    "Later interrupted publication with settled predecessor history",
  );
  const files = createMediaFileActivities(f.file.context);
  expect(await files.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  const checkpoint = f.file.context.checkpoint;
  const interrupted = new Error(
    "Actual second publication interrupted before database commit",
  );
  f.file.context.checkpoint = async (phase) => {
    await checkpoint(phase);
    if (phase === "publication-before-commit") throw interrupted;
  };
  try {
    await expect(files.promoteMediaFiles(acquired.input)).rejects.toBe(
      interrupted,
    );
  } finally {
    f.file.context.checkpoint = checkpoint;
  }
  const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: acquired.attempt.id },
  });
  await restoreNativeFixtureAgain(db, f);
  const current = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const lifecycle = await db.$transaction(async (tx) =>
    nativeCompensationLifecycle(tx, {
      mediaIds: acquired.attempt.mediaIds,
      assetIds: [f.asset.id],
      interrupted: await captureInterruptedPublicationWork(tx, transition.id),
    }),
  );
  expect(lifecycle.attempts).toContainEqual(nativeAttempt(original));
  expect(lifecycle.attempts).toContainEqual(nativeAttempt(current));
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: original.id },
    }),
  ).toEqual(original);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: current.id },
    }),
  ).toEqual(current);
});
