import { afterAll, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { queueNativeArchiveCleanup } from "#infrastructure/native-archive/continuation.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { CleanupNativeArchiveInputSchema } from "#shared/native-recovery/archive.ts";
import { createNativeArchiveCleanupObserver } from "#migration/native-archive/cleanup.ts";
import { nativeArchiveFixture } from "./test-fixture.ts";
import {
  sharedTvDownloadName,
  sharedTvFileFixture,
} from "./fixtures/shared-tv.ts";
import { fileCoverage } from "#automation/files/inspection.ts";
import { createNativeArchiveFileActivities } from "./activities.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const db = harness.database();
  const f = await nativeArchiveFixture(db, harness.cipher, {
    chain: 3,
    selected: "all",
    publicationAgeDays: 8,
    fileFactory: () => sharedTvFileFixture(db),
  });
  directories.push(f.file.directory);
  return { ...f, db };
}

test("synthetic attempt suffix cannot look like a third episode", () => {
  const attemptId = "e1234567-1234-4123-8123-123456789012";
  const media = [1, 2].map((episodeNumber) => ({
    id: `episode-${String(episodeNumber)}`,
    kind: "episode",
    title: "Coastlines",
    seasonNumber: 1,
    episodeNumber,
    year: 2026,
  }));
  expect(fileCoverage(`Coastlines.S01E01E02.${attemptId}.mkv`, media)).toEqual(
    [],
  );
  expect(fileCoverage(sharedTvDownloadName(attemptId), media)).toEqual([
    "episode-1",
    "episode-2",
  ]);
});

test("actual shared-TV A→B→C recovery binds both leaves and one held leaf prevents the shared archive unlink", async () => {
  const f = await fixture();
  const ids = [...f.published.entry.mediaIds].sort();
  expect(ids).toHaveLength(2);
  const originalAttempts = await f.db.acquisitionAttempt.findMany({
    where: { id: { in: f.publications.map((item) => item.attempt.id) } },
    orderBy: { id: "asc" },
  });
  const proof = await f.prepare();
  expect(proof.scope.files).toHaveLength(3);
  for (const file of proof.scope.files)
    expect(file).toMatchObject({
      libraryKind: "tv",
      edition: "default",
      editionRootId: f.file.media.parentId,
      mediaIds: ids,
    });
  await f.apply();
  const holds = await f.db.recoveryHold.findMany({
    where: { edition: "default", mediaId: { in: ids } },
    orderBy: { mediaId: "asc" },
  });
  expect(holds).toHaveLength(2);
  expect(
    holds.every(
      (hold) =>
        hold.releasedAt === null &&
        hold.recoveryEpoch === f.runtime.recoveryEpoch,
    ),
  ).toBe(true);
  expect(
    await f.db.acquisitionAttempt.findMany({
      where: { id: { in: originalAttempts.map((item) => item.id) } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(originalAttempts);
  await f.db.recoveryHold.updateMany({
    where: { edition: "default", mediaId: { in: ids } },
    data: { releasedAt: new Date(), releasedById: f.prior.actor.id },
  });
  await f.db.mediaIntent.updateMany({
    where: { edition: "default", mediaId: { in: ids } },
    data: { automationEpoch: f.runtime.recoveryEpoch, desiredPresence: true },
  });
  const second = z.uuid().parse(ids[1]);
  await f.db.mediaIntent.update({
    where: { mediaId_edition: defaultScope(second) },
    data: { generation: { increment: 1 } },
  });
  const row = await f.db.nativeArchiveCleanupContinuation.findFirstOrThrow({
    where: { originalCleanupId: f.first.id },
  });
  const operationId = await f.db.$transaction((tx) =>
    queueNativeArchiveCleanup(tx, {
      continuationId: row.id,
      expectedVersion: row.version,
    }),
  );
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(operationId) },
  });
  const input = CleanupNativeArchiveInputSchema.parse(operation.payload);
  expect(input.generations).toEqual({
    [z.uuid().parse(ids[0])]: 0,
    [second]: 1,
  });
  await createNativeArchiveCleanupObserver(f.observerContext)(input);
  const pin = await f.db.retentionHold.create({
    data: { mediaId: second, userId: f.file.user.id, isPin: true },
  });
  const activities = createNativeArchiveFileActivities(f.context, f.execution);
  expect(await activities.cleanupNativeArchiveFiles(input)).toEqual({
    status: "protected",
    reason: "archive_media_held",
  });
  const archive = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.first.assetId },
  });
  expect(await readFile(nativeLocalPath(f.context, archive.path), "utf8")).toBe(
    f.publications[0]?.content,
  );
  await f.db.retentionHold.delete({ where: { id: pin.id } });
  await createNativeArchiveCleanupObserver(f.observerContext)(input);
  expect(await activities.cleanupNativeArchiveFiles(input)).toEqual({
    status: "cleaned",
  });
  expect(
    await readFile(nativeLocalPath(f.context, f.canonicalPath), "utf8"),
  ).toBe(f.published.content);
});

test.each(["missing_asset_root", "mixed_leaf_root"] as const)(
  "%s cannot produce a new shared-TV native archive review",
  async (condition) => {
    const f = await fixture();
    if (condition === "missing_asset_root")
      await f.db.libraryAsset.update({
        where: { id: f.first.assetId },
        data: { editionRootId: null },
      });
    else {
      const foreign = await f.db.mediaItem.create({
        data: { kind: "series", title: "Unrelated series", tmdbId: 998_878 },
      });
      await f.db.$transaction((tx) =>
        lockDefaultScopes(tx, [defaultScope(foreign.id)], {
          createMissing: true,
        }),
      );
      const second = z
        .uuid()
        .parse(f.published.entry.mediaIds.find((id) => id !== f.file.media.id));
      await f.db.mediaIntent.update({
        where: { mediaId_edition: defaultScope(second) },
        data: { editionRootId: foreign.id },
      });
    }
    await expect(
      f.service.prepare(f.prior.actor, crypto.randomUUID(), {
        restoreOperationId: f.restore.id,
        recoveryEpoch: f.runtime.recoveryEpoch,
        runtimeVersion: f.runtime.version,
        activation: "activate",
        cleanupIds: [f.first.id],
      }),
    ).rejects.toMatchObject({ code: "lineage_unresolved" });
    expect(
      await f.db.nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
    ).toBe(0);
    const archive = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.first.assetId },
    });
    expect(
      await readFile(nativeLocalPath(f.context, archive.path), "utf8"),
    ).toBe(f.publications[0]?.content);
  },
);
