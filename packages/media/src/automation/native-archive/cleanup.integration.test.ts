import { afterAll, expect, test } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { queueNativeArchiveCleanup } from "#infrastructure/native-archive/continuation.ts";
import { createNativeArchiveCleanupObserver } from "#migration/native-archive/cleanup.ts";
import {
  CleanupNativeArchiveInputSchema,
  NativeArchiveCompletionSchema,
} from "#shared/native-recovery/archive.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { nativeArchiveFixture } from "./test-fixture.ts";
import { createNativeArchiveFileActivities } from "./activities.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test.each(["oldest_first", "newest_first"] as const)(
  "actual joint A→B→C authority expires both archives %s without rewriting historical plans",
  async (order) => {
    const db = harness.database();
    const f = await nativeArchiveFixture(db, harness.context().cipher, {
      chain: 3,
      selected: "all",
      publicationAgeDays: 8,
      withArchiveSubtitles: true,
    });
    directories.push(f.file.directory);
    const originalCleanups = await db.upgradeCleanup.findMany({
      orderBy: { id: "asc" },
    });
    const originalAttempts = await db.acquisitionAttempt.findMany({
      orderBy: { id: "asc" },
    });
    await f.prepare();
    await f.apply();
    // This physical executor test supplies the existing household authority boundary explicitly.
    // Backend integration tests exercise the separate real household declarations/receipt path.
    await db.recoveryHold.updateMany({
      where: { mediaId: f.file.media.id, edition: "default" },
      data: { releasedAt: new Date(), releasedById: f.prior.actor.id },
    });
    await db.mediaIntent.updateMany({
      where: { mediaId: f.file.media.id, edition: "default" },
      data: { automationEpoch: f.runtime.recoveryEpoch, desiredPresence: true },
    });
    const cleanups =
      order === "oldest_first" ? f.cleanups : [...f.cleanups].reverse();
    const activities = createNativeArchiveFileActivities(
      f.context,
      f.execution,
    );
    for (const cleanup of cleanups) {
      const row = await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
        where: { originalCleanupId: cleanup.id },
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
      await createNativeArchiveCleanupObserver(f.observerContext)(input);
      expect(await activities.cleanupNativeArchiveFiles(input)).toEqual({
        status: "cleaned",
      });
      expect(await activities.cleanupNativeArchiveFiles(input)).toEqual({
        status: "cleaned",
      });
      const completed =
        await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
          where: { id: row.id },
        });
      const receipt = NativeArchiveCompletionSchema.parse(completed.completion);
      expect(receipt.asset.assetId).toBe(cleanup.assetId);
      expect(
        receipt.journals.every((journal) => journal.phase === "complete"),
      ).toBe(true);
    }
    expect(
      await db.upgradeCleanup.findMany({ orderBy: { id: "asc" } }),
    ).toEqual(originalCleanups);
    expect(
      await db.acquisitionAttempt.findMany({ orderBy: { id: "asc" } }),
    ).toEqual(originalAttempts);
    expect(
      await readFile(nativeLocalPath(f.context, f.canonicalPath), "utf8"),
    ).toBe(f.published.content);
  },
);
