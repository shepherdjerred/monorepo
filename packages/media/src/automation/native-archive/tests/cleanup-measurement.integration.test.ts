import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { readyArchiveCleanup } from "#automation/native-archive/cleanup-test-support.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof readyArchiveCleanup>> | undefined;
beforeEach(async () => {
  fixture = await readyArchiveCleanup(harness.database(), harness.cipher);
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test("owner revocation commits during read-only measurement and blocks the first execution grant", async () => {
  if (fixture === undefined)
    throw new Error("Archive measurement fixture missing");
  const f = fixture,
    db = harness.database();
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.first.assetId },
  });
  const filename = nativeLocalPath(f.context, asset.path);
  const bytes = await readFile(filename);
  let measured = false;
  const activities = createNativeArchiveFileActivities(
    {
      ...f.context,
      files: {
        ...f.context.files,
        checkpoint: async (phase) => {
          await f.context.files.checkpoint(phase);
          if (phase !== "native-archive-cleanup-measured") return;
          measured = true;
          // This is a separate committed writer while the Files invocation holds no PG locks.
          await db.mediaUser.update({
            where: { id: f.prior.actor.id },
            data: { restricted: true },
          });
        },
      },
    },
    f.execution,
  );
  await expect(
    activities.cleanupNativeArchiveFiles(f.input),
  ).resolves.toMatchObject({ status: "protected" });
  expect(measured).toBe(true);
  expect(await readFile(filename)).toEqual(bytes);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
  ).toEqual(asset);
  expect(
    await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: f.continuation.id },
    }),
  ).toMatchObject({ executionEvidence: null, completion: null });
});

test("committed execution CAS resumes with a new measurement and exact immutable parents", async () => {
  if (fixture === undefined)
    throw new Error("Archive measurement fixture missing");
  const f = fixture,
    db = harness.database();
  const before = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: f.continuation.id },
  });
  const stopped = new Error("Stop after actual execution commit");
  const interrupted = createNativeArchiveFileActivities(
    {
      ...f.context,
      files: {
        ...f.context.files,
        checkpoint: async (phase) => {
          await f.context.files.checkpoint(phase);
          if (phase === "native-archive-execution-committed") throw stopped;
        },
      },
    },
    f.execution,
  );
  await expect(interrupted.cleanupNativeArchiveFiles(f.input)).rejects.toBe(
    stopped,
  );
  const committed = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow(
    { where: { id: before.id } },
  );
  expect(committed.executionEvidence).not.toBeNull();
  expect(committed.version).toBe(before.version + 1);
  expect(committed.descriptor).toEqual(before.descriptor);
  expect(committed.descriptorHash).toBe(before.descriptorHash);
  expect(committed.completion).toBeNull();
  await expect(
    f.activities.cleanupNativeArchiveFiles(f.input),
  ).resolves.toEqual({ status: "cleaned" });
  const complete = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: before.id },
  });
  expect(complete.descriptor).toEqual(before.descriptor);
  expect(complete.executionEvidence).toEqual(committed.executionEvidence);
  expect(complete.completion).not.toBeNull();
  // Historical acknowledgement is still the first path and does not grant another CAS.
  await expect(
    f.activities.cleanupNativeArchiveFiles(f.input),
  ).resolves.toEqual({ status: "cleaned" });
  expect(
    await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: before.id },
    }),
  ).toEqual(complete);
});

test.each([
  { state: "completed", elapsedAt: "lookup" },
  { state: "unfinished", elapsedAt: "lookup" },
  { state: "completed", elapsedAt: "entry" },
  { state: "unfinished", elapsedAt: "entry" },
] as const)(
  "$state strict ACK retains the SDK bound across 61 seconds elapsed at $elapsedAt without renewing fresh proof",
  async ({ state, elapsedAt }) => {
    if (fixture === undefined)
      throw new Error("Archive delayed ACK fixture missing");
    const f = fixture,
      db = harness.database();
    if (state === "completed")
      expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
        status: "cleaned",
      });
    const before = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: f.continuation.id },
    });
    const sdk = f.execution();
    const wall = Date.now.bind(Date),
      monotonic = performance.now.bind(performance);
    let elapsed = elapsedAt === "entry" ? 61_000 : 0,
      actualReads = 0;
    const delayed = queryFixtureDatabase(db, {
      query: {
        nativeArchiveCleanupContinuation: {
          async findUniqueOrThrow({ args, query }) {
            const result = await query(args);
            if (args.select?.state === true) {
              actualReads++;
              // Delegate the real query, then model elapsed pool/query time.
              // The original SDK budget remains active; no callback or result is replaced.
              elapsed = 61_000;
            }
            return result;
          },
        },
      },
    });
    const forbidden = () =>
      Promise.reject(
        new Error("Fresh authority/IO must not run during strict ACK"),
      );
    const purge = vi.fn(forbidden),
      checkpoint = vi.fn(forbidden),
      plexAccess = vi.fn(forbidden);
    const storage = vi.fn(forbidden),
      exclusion = vi.fn(forbidden);
    const activities = createNativeArchiveFileActivities(
      {
        ...f.context,
        files: {
          ...f.context.files,
          db: delayed,
          checkpoint,
          plexAccess,
          enabled: { ...f.context.files.enabled, purge },
          verifyStorageAuthority: storage,
          verifyPlexExclusion: exclusion,
        },
      },
      () => sdk,
    );
    const wallSpy = vi
      .spyOn(Date, "now")
      .mockImplementation(() => wall() + elapsed);
    const monoSpy = vi
      .spyOn(performance, "now")
      .mockImplementation(() => monotonic() + elapsed);
    try {
      const result = await activities.cleanupNativeArchiveFiles(f.input);
      expect(actualReads).toBe(1);
      expect(elapsed).toBe(61_000);
      expect(() => sdk.assertActive()).not.toThrow();
      expect(result).toEqual(
        state === "completed"
          ? { status: "cleaned" }
          : { status: "protected", reason: "verification_expired" },
      );
      for (const callback of [
        purge,
        checkpoint,
        plexAccess,
        storage,
        exclusion,
      ])
        expect(callback).not.toHaveBeenCalled();
    } finally {
      monoSpy.mockRestore();
      wallSpy.mockRestore();
    }
    const after = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: before.id },
    });
    if (state === "completed") expect(after).toEqual(before);
    else
      expect(after).toMatchObject({
        state: "protected",
        executionEvidence: null,
        completion: null,
      });
  },
);
