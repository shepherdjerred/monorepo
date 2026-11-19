import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { serializable } from "#automation/store.ts";
import { seasonPublicationFixture } from "#automation/publication-proof/season-fixture.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { captureExistingPlexBindingExpected } from "#infrastructure/plex-binding/cold.ts";
import {
  preparePlexBindingLockScope,
  lockPlexBindingScope,
} from "#infrastructure/plex-binding/authority.ts";
import { queuePlexBindingReverification } from "#infrastructure/plex-binding/store.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { ReverifyPlexBindingInputSchema } from "#shared/plex-binding/activities.ts";
import { createPlexBindingActivities } from "./activities.ts";
import { bindingTestExecution } from "./test-fixture.ts";
import { tvBindingContext } from "./tv.test-fixture.ts";

const harness = automationTestHarness();
let directory: string | undefined;
let prepared: Awaited<ReturnType<typeof prepare>>;
beforeAll(async () => {
  prepared = await prepare();
}, 60_000);
afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

async function prepare() {
  const db = harness.database();
  const file = await seasonPublicationFixture(db, 100);
  directory = file.directory;
  // Independent real acquisitions keep producer work scoped; the one cold
  // consumer below must still discover and bind the complete 100-asset union.
  const attemptIds: string[] = [];
  for (let offset = 0; offset < file.mediaIds.length; offset += 25) {
    const published = await file.published(
      file.mediaIds.slice(offset, offset + 25),
    );
    attemptIds.push(published.attempt.id);
  }
  const attempts = await db.acquisitionAttempt.findMany({
    where: { id: { in: attemptIds } },
    orderBy: { id: "asc" },
  });
  expect(attempts).toHaveLength(4);
  const plan = attempts.flatMap((attempt) =>
    FilePlanSchema.parse(attempt.filePlan),
  );
  expect(plan).toHaveLength(100);
  expect(new Set(plan.flatMap((entry) => entry.mediaIds)).size).toBe(100);
  expect(new Set(plan.map((entry) => entry.assetId)).size).toBe(100);
  expect(
    await db.libraryAsset.count({
      where: {
        id: { in: plan.map((entry) => entry.assetId) },
        state: "published",
        owned: true,
      },
    }),
  ).toBe(100);
  const tv = await tvBindingContext(db, harness.context(), file.mediaIds);
  const execution = bindingTestExecution();
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: execution.expiresAtMs,
    guards: [execution],
  });
  const access = await tv.context.plexAccess("show");
  const queued = await serializable(db, async (tx) => {
    const expected = await captureExistingPlexBindingExpected(tx, {
      assetIds: plan.map((entry) => entry.assetId).sort(),
      access: [access],
    });
    const scope = await preparePlexBindingLockScope(tx, expected);
    await lockPlexBindingScope(tx, scope, freshness);
    const result = await queuePlexBindingReverification(tx, {
      expected,
      renewalBucket: Math.floor(execution.observed.wall / 3_600_000),
    });
    freshness.assertActive();
    return result;
  });
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: queued.operationId },
  });
  return {
    file,
    attempts,
    plan,
    tv,
    input: ReverifyPlexBindingInputSchema.parse(operation.payload),
  };
}

test("one actual cold consumer binds all100 independently produced TV files with no native25 truncation", async () => {
  const db = harness.database();
  const { file, attempts, plan, tv, input } = prepared;
  expect(input.assetIds).toHaveLength(100);
  expect(
    await createPlexBindingActivities(tv.context).reverify(
      input,
      bindingTestExecution(),
    ),
  ).toEqual({ status: "verified", bindingCount: 100 });
  const access = await tv.context.plexAccess("show");
  const current = await db.$transaction((tx) =>
    readCurrentPlexBindings(
      tx,
      plan.flatMap((entry) =>
        entry.mediaIds.map((mediaId) => ({
          scope: { mediaId, edition: "default" },
          assetId: entry.assetId,
          access,
        })),
      ),
    ),
  );
  expect(current).toHaveLength(100);
  expect(current.every((row) => row.status === "current")).toBe(true);
  expect(
    await db.acquisitionAttempt.findMany({
      where: { id: { in: attempts.map((attempt) => attempt.id) } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(attempts);
  expect(
    await db.plexBindingCurrent.count({
      where: { mediaId: { in: file.mediaIds }, evidenceId: { not: null } },
    }),
  ).toBe(100);
  expect(
    await db.libraryAsset.count({
      where: { id: { in: input.assetIds }, plexPublishedAt: { not: null } },
    }),
  ).toBe(0);
});
