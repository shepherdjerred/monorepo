import { lstat, readFile, rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { readyArchiveCleanup } from "#automation/native-archive/cleanup-test-support.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import { archivePurgeManifest } from "#automation/native-archive/purge-manifest.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { NativeArchiveExecutionSchema } from "#shared/native-recovery/archive.ts";
import { readCompletedNativeArchiveCleanup } from "#infrastructure/plex-binding/native/native-archive-ack.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof readyArchiveCleanup>>;
beforeAll(async () => {
  fixture = await readyArchiveCleanup(harness.database(), harness.cipher);
}, 60_000);
afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test("shorter storage authority expires during actual archive completion SQL: durable purge journals survive but database completion and terminal ACK roll back", async () => {
  const f = fixture;
  const db = harness.database();
  const before = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: f.input.continuationId },
  });
  const original = {
    assets: await db.libraryAsset.findMany({ orderBy: { id: "asc" } }),
    subtitles: await db.subtitleAsset.findMany({ orderBy: { id: "asc" } }),
    cleanups: await db.upgradeCleanup.findMany({ orderBy: { id: "asc" } }),
    attempts: await db.acquisitionAttempt.findMany({ orderBy: { id: "asc" } }),
    receipt: await db.nativeRecoveryReceipt.findUniqueOrThrow({
      where: { id: before.receiptId },
      include: { plan: true },
    }),
  };
  const storage = await db.mediaStorageAuthority.findUniqueOrThrow({
    where: { rootPath: "/data/movies" },
  });
  let shortened = false;
  const context = {
    ...f.context,
    files: {
      ...f.context.files,
      checkpoint: async (phase: string) => {
        await f.context.files.checkpoint(phase);
        if (phase !== "native-archive-execution-committed") return;
        if (shortened)
          throw new Error(
            "Archive storage deadline may only be shortened once",
          );
        const expiresAt = new Date(Date.now() + 2000);
        expect(expiresAt.getTime()).toBeLessThan(storage.expiresAt.getTime());
        const changed = await db.mediaStorageAuthority.updateMany({
          where: {
            rootPath: storage.rootPath,
            recoveryEpoch: f.input.recoveryEpoch,
            revokedAt: null,
            expiresAt: storage.expiresAt,
          },
          data: { expiresAt },
        });
        expect(changed.count).toBe(1);
        shortened = true;
      },
    },
  };
  const activities = createNativeArchiveFileActivities(context, f.execution);
  let sequence = false,
    routine = false,
    trigger = false;
  try {
    await db.$executeRawUnsafe(
      'CREATE SEQUENCE "native_archive_deadline_wait"',
    );
    sequence = true;
    await db.$executeRawUnsafe(`CREATE FUNCTION native_archive_deadline_wait() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE sql_deadline NUMERIC; storage_deadline NUMERIC;
      BEGIN
        IF NEW."completion" IS NOT NULL AND OLD."completion" IS NULL THEN
          sql_deadline := NULLIF(current_setting('media.plex_deadline_ms',true),'')::numeric;
          SELECT floor(extract(epoch FROM "expiresAt") * 1000) INTO storage_deadline
            FROM "MediaStorageAuthority" WHERE "rootPath"='/data/movies';
          IF sql_deadline IS NULL OR storage_deadline IS NULL OR sql_deadline <> storage_deadline THEN
            RAISE EXCEPTION 'Archive completion SQL did not retain the exact shorter storage deadline';
          END IF;
          PERFORM nextval('"native_archive_deadline_wait"');
          PERFORM pg_sleep(GREATEST(0, (storage_deadline - extract(epoch FROM clock_timestamp()) * 1000) / 1000)::double precision + 0.025);
        END IF;
        RETURN NEW;
      END $$`);
    routine = true;
    await db.$executeRawUnsafe(
      'CREATE TRIGGER native_archive_deadline_wait BEFORE UPDATE ON "NativeArchiveCleanupContinuation" FOR EACH ROW EXECUTE FUNCTION native_archive_deadline_wait()',
    );
    trigger = true;

    expect(await activities.cleanupNativeArchiveFiles(f.input)).toEqual({
      status: "protected",
      reason: "archive_authority_expired",
    });
    expect(shortened).toBe(true);
    expect(
      await db.$queryRaw<
        { is_called: boolean }[]
      >`SELECT is_called FROM "native_archive_deadline_wait"`,
    ).toEqual([{ is_called: true }]);
    const current = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow(
      { where: { id: before.id } },
    );
    expect(current).toMatchObject({ state: "protected", completion: null });
    expect(current.descriptor).toEqual(before.descriptor);
    expect(current.descriptorHash).toBe(before.descriptorHash);
    const execution = NativeArchiveExecutionSchema.parse(
      current.executionEvidence,
    );
    expect(execution.participants.length).toBeGreaterThan(1);
    expect(
      await db.$transaction((tx) =>
        readCompletedNativeArchiveCleanup(tx, f.input),
      ),
    ).toBeNull();
    expect({
      assets: await db.libraryAsset.findMany({ orderBy: { id: "asc" } }),
      subtitles: await db.subtitleAsset.findMany({ orderBy: { id: "asc" } }),
      cleanups: await db.upgradeCleanup.findMany({ orderBy: { id: "asc" } }),
      attempts: await db.acquisitionAttempt.findMany({
        orderBy: { id: "asc" },
      }),
      receipt: await db.nativeRecoveryReceipt.findUniqueOrThrow({
        where: { id: before.receiptId },
        include: { plan: true },
      }),
    }).toEqual(original);

    // The already-authorized video and sidecar unlinks are durable. A rolled-back
    // database completion must neither pretend those bytes remain nor grant ACK.
    const verifyPlexExclusion = f.context.files.verifyPlexExclusion;
    if (verifyPlexExclusion === undefined)
      throw new Error(
        "Archive journal inspection requires its actual exclusion verifier",
      );
    for (const item of execution.participants) {
      const expected = archivePurgeManifest(f.context, current.id, item);
      const operations = new FileOperations(
        f.context.files.roots[item.libraryKind],
        {
          verifyPlexExclusion,
          authorize: () =>
            Promise.reject(
              new Error("Deadline evidence read cannot mutate files"),
            ),
        },
      );
      expect(await operations.readManifest(expected.operationId)).toEqual({
        ...expected,
        phase: "complete",
      });
      await expect(
        lstat(nativeLocalPath(f.context, item.canonicalPath)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(
      await readFile(nativeLocalPath(f.context, f.canonicalPath), "utf8"),
    ).toBe(f.published.content);
    const expiredStorage = await db.mediaStorageAuthority.findUniqueOrThrow({
      where: { rootPath: storage.rootPath },
    });
    expect(expiredStorage.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    // No retry or timestamp restoration: a later effect needs fresh explicit authority.
  } finally {
    if (trigger)
      await db.$executeRawUnsafe(
        'DROP TRIGGER native_archive_deadline_wait ON "NativeArchiveCleanupContinuation"',
      );
    if (routine)
      await db.$executeRawUnsafe(
        "DROP FUNCTION native_archive_deadline_wait()",
      );
    if (sequence)
      await db.$executeRawUnsafe(
        'DROP SEQUENCE "native_archive_deadline_wait"',
      );
  }
});
