import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import { readyArchiveCleanup } from "#automation/native-archive/cleanup-test-support.ts";

const observation = vi.hoisted(
  (): { afterStat: ((filename: string) => void) | null } => ({
    afterStat: null,
  }),
);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const result = await actual.lstat(...args);
      observation.afterStat?.(String(args[0]));
      return result;
    },
  };
});
const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof readyArchiveCleanup>> | undefined;
beforeEach(async () => {
  fixture = await readyArchiveCleanup(harness.database(), harness.cipher);
});
afterEach(async () => {
  observation.afterStat = null;
  vi.restoreAllMocks();
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test.each(["invocation", "lease", "storage", "network"] as const)(
  "archive cleanup preserves bytes when %s expires during the final unlink stat",
  async (kind) => {
    if (fixture === undefined)
      throw new Error("Archive cleanup fixture missing");
    const f = fixture;
    const db = harness.database();
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.first.assetId },
    });
    const filename = nativeLocalPath(f.context, asset.path);
    const bytes = await readFile(filename);
    const expiresAt = new Date(Date.now() + 30_000);
    if (kind === "lease")
      await db.legacyWriterLease.update({
        where: { id: "singleton" },
        data: { expiresAt },
      });
    if (kind === "storage")
      await db.mediaStorageAuthority.update({
        where: { rootPath: "/data/movies" },
        data: { expiresAt },
      });
    const network = await db.nativeRecoveryObservation.findFirstOrThrow({
      where: { kind: "archive_cleanup_network", planId: f.planId },
      orderBy: { createdAt: "desc" },
    });
    let reached = false;
    const cancellation = new Error(
      "Invocation expired after final archive stat",
    );
    const unlinkSpy = vi.spyOn(ContentProof.prototype, "unlink");
    unlinkSpy.mockImplementation(async function (
      this: ContentProof,
      path,
      beforeEffect,
    ) {
      expect(path).toBe(filename);
      unlinkSpy.mockRestore();
      let count = 0;
      observation.afterStat = (actual) => {
        if (actual !== filename || path !== filename || ++count !== 2) return;
        reached = true;
        if (kind !== "invocation")
          vi.spyOn(Date, "now").mockReturnValue(
            (kind === "network" ? network.expiresAt : expiresAt).getTime() + 1,
          );
      };
      try {
        await this.unlink(path, beforeEffect);
      } finally {
        observation.afterStat = null;
      }
    });
    const activities = createNativeArchiveFileActivities(f.context, () => {
      const execution = f.execution();
      return {
        ...execution,
        assertActive: () => {
          execution.assertActive();
          if (kind === "invocation" && reached) throw cancellation;
        },
      };
    });
    const result = activities.cleanupNativeArchiveFiles(f.input);
    if (kind === "invocation") await expect(result).rejects.toBe(cancellation);
    else await expect(result).resolves.toMatchObject({ status: "protected" });
    expect(reached).toBe(true);
    expect(await readFile(filename)).toEqual(bytes);
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).toEqual(asset);
    expect(
      await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.continuation.id },
      }),
    ).toMatchObject({ completion: null });
  },
);
