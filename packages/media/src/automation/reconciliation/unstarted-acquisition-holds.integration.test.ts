import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { settleUnstartedAcquisitionHolds } from "./downloads.ts";

const { database } = automationTestHarness();

test("unstarted acquisition settlement updates only reconcile_media holds", async () => {
  const db = database();
  const release = await db.releaseCandidate.create({
    data: {
      providerId: "knaben",
      providerReleaseId: crypto.randomUUID(),
      title: "Fixture",
      attributes: {},
      evaluation: {},
    },
  });
  const held = await operation(db, "reconcile_media", "acquisition_disabled");
  const otherKind = await operation(
    db,
    "acquire_release",
    "acquisition_disabled",
  );
  const movieKind = await operation(
    db,
    "reconcile_movie_edition_v4",
    "acquisition_disabled",
  );
  const otherReason = await operation(
    db,
    "reconcile_media",
    "runtime_protected",
  );
  const attemptOwner = await operation(
    db,
    "reconcile_media",
    "acquisition_disabled",
  );
  const coordinator = await operation(
    db,
    "reconcile_media",
    "acquisition_disabled",
  );
  await db.acquisitionAttempt.create({
    data: {
      operationId: attemptOwner.id,
      coordinatorOperationId: coordinator.id,
      releaseId: release.id,
      mediaIds: [],
      generations: {},
      state: "completed",
    },
  });

  expect(await settleUnstartedAcquisitionHolds(db)).toBe(1);

  await expect(stored(db, held.id)).resolves.toMatchObject({
    status: "completed",
    result: { reason: "runtime_observe" },
  });
  for (const unchanged of [
    otherKind,
    movieKind,
    otherReason,
    attemptOwner,
    coordinator,
  ]) {
    await expect(stored(db, unchanged.id)).resolves.toMatchObject({
      status: "reconciling",
      result: unchanged.result,
    });
  }
});

function operation(
  db: ReturnType<typeof database>,
  kind: string,
  reason: string,
) {
  return db.operation.create({
    data: {
      kind,
      payload: {},
      status: "reconciling",
      result: { reason },
    },
  });
}

function stored(db: ReturnType<typeof database>, id: string) {
  return db.operation.findUniqueOrThrow({ where: { id } });
}
