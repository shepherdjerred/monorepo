import { afterAll, afterEach, expect, test } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { queueNativeArchiveCleanup } from "#infrastructure/native-archive/continuation.ts";
import { observeArchiveCleanup } from "./fixtures/observe.ts";
import {
  CleanupNativeArchiveInputSchema,
  NativeArchiveCompletionSchema,
} from "#shared/native-recovery/archive.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { nativeArchiveFixture } from "./test-fixture.ts";
import { createNativeArchiveFileActivities } from "./activities.ts";

const harness = automationTestHarness();
const directories: string[] = [];
let pendingCase: Promise<void> | undefined;
// A timeout aborts the test signal, not arbitrary promises. Drain the already
// started stage before the next case can mutate this shared private database.
afterEach(async () => {
  if (pendingCase !== undefined) await Promise.allSettled([pendingCase]);
  pendingCase = undefined;
});
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test.for(["oldest_first", "newest_first"] as const)(
  "actual joint A→B→C authority expires both archives %s without rewriting historical plans",
  async (order, testContext) => {
    const started = { wall: Date.now(), monotonic: performance.now() };
    const stages: {
      name: string;
      startedWallMs: number;
      startedMonotonicMs: number;
      endedWallMs?: number;
      endedMonotonicMs?: number;
    }[] = [];
    const report = (reason: "aborted" | "failed") => {
      console.warn(
        "archive-cleanup-stage-diagnostic",
        JSON.stringify({
          order,
          reason,
          wallElapsedMs: Date.now() - started.wall,
          monotonicElapsedMs: performance.now() - started.monotonic,
          stages,
        }),
      );
    };
    const aborted = () => report("aborted");
    testContext.signal.addEventListener("abort", aborted, { once: true });
    testContext.onTestFailed(() => report("failed"));
    testContext.onTestFinished(() => {
      testContext.signal.removeEventListener("abort", aborted);
    });
    const stage: Stage = async (name, work) => {
      testContext.signal.throwIfAborted();
      const timing = {
        name,
        startedWallMs: Date.now() - started.wall,
        startedMonotonicMs: performance.now() - started.monotonic,
      };
      stages.push(timing);
      try {
        const result = await work();
        testContext.signal.throwIfAborted();
        return result;
      } finally {
        Object.assign(timing, {
          endedWallMs: Date.now() - started.wall,
          endedMonotonicMs: performance.now() - started.monotonic,
        });
      }
    };
    pendingCase = runJointCleanup(order, stage);
    await pendingCase;
  },
);

type Stage = <T>(name: string, work: () => Promise<T>) => Promise<T>;

async function runJointCleanup(
  order: "oldest_first" | "newest_first",
  stage: Stage,
) {
  const db = harness.database();
  const f = await stage("fixture", async () => {
    const fixture = await nativeArchiveFixture(db, harness.context().cipher, {
      chain: 3,
      selected: "all",
      publicationAgeDays: 8,
      withArchiveSubtitles: true,
    });
    // Register ownership before the post-stage abort check can throw.
    directories.push(fixture.file.directory);
    return fixture;
  });
  const { originalCleanups, originalAttempts } = await stage(
    "historical-snapshots",
    async () => {
      const cleanups = await db.upgradeCleanup.findMany({
        orderBy: { id: "asc" },
      });
      const attempts = await db.acquisitionAttempt.findMany({
        orderBy: { id: "asc" },
      });
      return { originalCleanups: cleanups, originalAttempts: attempts };
    },
  );
  await stage("paired-prepare", () => f.prepare());
  await stage("paired-apply", () => f.apply());
  // This physical executor test supplies the existing household authority boundary explicitly.
  // Backend integration tests exercise the separate real household declarations/receipt path.
  await stage("household-precondition", async () => {
    await db.recoveryHold.updateMany({
      where: { mediaId: f.file.media.id, edition: "default" },
      data: { releasedAt: new Date(), releasedById: f.prior.actor.id },
    });
    await db.mediaIntent.updateMany({
      where: { mediaId: f.file.media.id, edition: "default" },
      data: { automationEpoch: f.runtime.recoveryEpoch, desiredPresence: true },
    });
  });
  const cleanups =
    order === "oldest_first" ? f.cleanups : [...f.cleanups].reverse();
  const activities = createNativeArchiveFileActivities(f.context, f.execution);
  for (const [index, cleanup] of cleanups.entries()) {
    const prefix = `archive-${String(index + 1)}`;
    const { row, input } = await stage(`${prefix}-queue`, async () => {
      const continuation =
        await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
          where: { originalCleanupId: cleanup.id },
        });
      const operationId = await db.$transaction((tx) =>
        queueNativeArchiveCleanup(tx, {
          continuationId: continuation.id,
          expectedVersion: continuation.version,
        }),
      );
      const operation = await db.operation.findUniqueOrThrow({
        where: { id: z.uuid().parse(operationId) },
      });
      const command = CleanupNativeArchiveInputSchema.parse(operation.payload);
      return { row: continuation, input: command };
    });
    await stage(`${prefix}-network`, () =>
      observeArchiveCleanup(f.observerContext, input),
    );
    expect(
      await stage(`${prefix}-files`, () =>
        activities.cleanupNativeArchiveFiles(input),
      ),
    ).toEqual({
      status: "cleaned",
    });
    expect(
      await stage(`${prefix}-ack`, () =>
        activities.cleanupNativeArchiveFiles(input),
      ),
    ).toEqual({
      status: "cleaned",
    });
    await stage(`${prefix}-completion`, async () => {
      const completed =
        await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
          where: { id: row.id },
        });
      const receipt = NativeArchiveCompletionSchema.parse(completed.completion);
      expect(receipt.asset.assetId).toBe(cleanup.assetId);
      expect(
        receipt.journals.every((journal) => journal.phase === "complete"),
      ).toBe(true);
    });
  }
  await stage("historical-and-current-byte-assertions", async () => {
    expect(
      await db.upgradeCleanup.findMany({ orderBy: { id: "asc" } }),
    ).toEqual(originalCleanups);
    expect(
      await db.acquisitionAttempt.findMany({ orderBy: { id: "asc" } }),
    ).toEqual(originalAttempts);
    expect(
      await readFile(nativeLocalPath(f.context, f.canonicalPath), "utf8"),
    ).toBe(f.published.content);
  });
}
