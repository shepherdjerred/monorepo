import { afterEach, beforeEach, expect, test } from "vitest";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { archiveCaptionFixture } from "#infrastructure/native-archive/caption.test-support.ts";
import { queueNativeArchiveCleanup } from "#infrastructure/native-archive/continuation.ts";
import { createNativeArchiveCleanupObserver } from "#migration/native-archive/cleanup.ts";
import { CleanupNativeArchiveInputSchema } from "#shared/native-recovery/archive.ts";
import { reconcileCompensationHousehold } from "#automation/native-compensation/fixtures/household.ts";
import { testCompensationExecution } from "#automation/native-compensation/test-fixture.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof archiveCaptionFixture>> | undefined;
beforeEach(async () => {
  fixture = await archiveCaptionFixture(
    harness.database(),
    harness.context(),
    false,
    8,
  );
  await fixture.observer(fixture.plan.id);
  await fixture.files.applyNativeArchiveFiles(fixture.applyInput);
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.f.file.directory, { recursive: true, force: true });
});

test("archive cleanup refuses a substituted supplementary caption journal before any unlink", async () => {
  if (fixture === undefined)
    throw new Error("Actual archive caption fixture missing");
  const f = fixture;
  const db = harness.database();
  await reconcileCompensationHousehold(db, {
    owner: f.f.prior.actor,
    requester: f.f.file.user,
    mediaIds: f.f.published.entry.mediaIds,
    kind: "movie",
    serverMachineId: "server",
  });
  const row = await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
    where: { originalCleanupId: f.cleanup.id, receipt: { planId: f.plan.id } },
  });
  const operationId = await db.$transaction((tx) =>
    queueNativeArchiveCleanup(tx, {
      continuationId: row.id,
      expectedVersion: row.version,
    }),
  );
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(operationId) },
  });
  const input = CleanupNativeArchiveInputSchema.parse(operation.payload);
  await createNativeArchiveCleanupObserver({
    ...f.f.observerContext,
    archiveExecution: () => {
      const execution = testCompensationExecution();
      return {
        ...execution,
        checkpoint: () => execution.checkpoint("archive-cleanup"),
      };
    },
  })(input);
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.cleanup.assetId },
  });
  const archive = nativeLocalPath(f.f.context, asset.path);
  const bytes = await readFile(archive);
  const journal = path.join(
    f.f.file.roots.control,
    "journal",
    `${f.operation.id}.json`,
  );
  await writeFile(`${journal}.substitute`, await readFile(journal));
  await rename(`${journal}.substitute`, journal);
  expect(await f.files.cleanupNativeArchiveFiles(input)).toEqual({
    status: "protected",
    reason: "archive_physical_identity_protected",
  });
  expect(await readFile(archive)).toEqual(bytes);
  expect(
    await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: row.id },
    }),
  ).toMatchObject({
    state: "protected",
    executionEvidence: null,
    completion: null,
  });
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
  ).toEqual(asset);
});
