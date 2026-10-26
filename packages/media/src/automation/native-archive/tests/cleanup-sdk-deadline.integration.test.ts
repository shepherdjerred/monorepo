import path from "node:path";
import { lstat, readFile, rm } from "node:fs/promises";
import { afterEach, beforeEach, expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { readyArchiveCleanup } from "#automation/native-archive/cleanup-test-support.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { archivePurgeManifest } from "#automation/native-archive/purge-manifest.ts";
import { NativeArchiveExecutionSchema } from "#shared/native-recovery/archive.ts";
import { readCompletedNativeArchiveCleanup } from "#infrastructure/plex-binding/native/native-archive-ack.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof readyArchiveCleanup>> | undefined;
beforeEach(async () => {
  fixture = await readyArchiveCleanup(harness.database(), harness.cipher);
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test("a deferred COMMIT crossing the original SDK bound preserves durable purges without completion or terminal ACK", async () => {
  if (fixture === undefined)
    throw new Error("Archive SDK deadline fixture missing");
  const f = fixture,
    db = harness.database();
  const original = {
    assets: await db.libraryAsset.findMany({ orderBy: { id: "asc" } }),
    subtitles: await db.subtitleAsset.findMany({ orderBy: { id: "asc" } }),
    cleanups: await db.upgradeCleanup.findMany({ orderBy: { id: "asc" } }),
    attempts: await db.acquisitionAttempt.findMany({ orderBy: { id: "asc" } }),
  };
  const before = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: f.input.continuationId },
  });
  // Born after fixture construction, and retained unchanged through every transaction.
  const expiresAtMs = Date.now() + 2000;
  const monotonicDeadline = performance.now() + 2000;
  const expired = new Error(
    "Original SDK minimum expired during deferred COMMIT",
  );
  let activeChecks = 0;
  const activities = createNativeArchiveFileActivities(f.context, () => ({
    ...f.execution(),
    expiresAtMs,
    assertActive: () => {
      if (Date.now() >= expiresAtMs || performance.now() >= monotonicDeadline)
        throw expired;
      activeChecks++;
    },
  }));
  let sequence = false,
    routine = false,
    trigger = false;
  try {
    await db.$executeRawUnsafe('CREATE SEQUENCE "archive_sdk_commit_wait"');
    sequence = true;
    await db.$executeRawUnsafe(`CREATE FUNCTION archive_sdk_commit_wait() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE sql_deadline NUMERIC;
      BEGIN
        IF EXISTS(SELECT 1 FROM "NativeArchiveCleanupContinuation" WHERE id='${before.id}' AND completion IS NOT NULL) THEN
          sql_deadline := NULLIF(current_setting('media.plex_deadline_ms',true),'')::numeric;
          IF sql_deadline IS NULL OR sql_deadline <> ${String(expiresAtMs)} OR NEW."deadlineMs" <> ${String(expiresAtMs)} THEN
            RAISE EXCEPTION 'Archive COMMIT did not retain its exact earlier original SDK deadline';
          END IF;
          PERFORM nextval('"archive_sdk_commit_wait"');
          PERFORM pg_sleep(GREATEST(0, (${String(expiresAtMs)} - extract(epoch FROM clock_timestamp()) * 1000) / 1000)::double precision + 0.025);
        END IF;
        RETURN NEW;
      END $$`);
    routine = true;
    // Same deferred row event as the production guard, ordered before it. The
    // record-only commit is unaffected; only a real completed physical phase waits.
    await db.$executeRawUnsafe(
      'CREATE CONSTRAINT TRIGGER aa_test_archive_sdk_delay AFTER INSERT OR UPDATE ON "PlexDeadlineValidation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION archive_sdk_commit_wait()',
    );
    trigger = true;
    await expect(activities.cleanupNativeArchiveFiles(f.input)).rejects.toBe(
      expired,
    );
    expect(activeChecks).toBeGreaterThan(0);
    // Sequences are nontransactional: this proves the actual COMMIT hook ran,
    // independently of the rolled-back completion row and the SDK catch guard.
    expect(
      await db.$queryRaw<
        { is_called: boolean }[]
      >`SELECT is_called FROM "archive_sdk_commit_wait"`,
    ).toEqual([{ is_called: true }]);
    const current = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow(
      { where: { id: before.id } },
    );
    expect(current.completion).toBeNull();
    expect(current.state).not.toBe("cleaned");
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
    }).toEqual(original);
    for (const item of execution.participants) {
      const expected = archivePurgeManifest(f.context, current.id, item);
      const journal = path.join(
        f.context.files.roots[item.libraryKind].control,
        "journal",
        `${expected.operationId}.json`,
      );
      expect(JSON.parse(await readFile(journal, "utf8"))).toEqual({
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
  } finally {
    if (trigger)
      await db.$executeRawUnsafe(
        'DROP TRIGGER aa_test_archive_sdk_delay ON "PlexDeadlineValidation"',
      );
    if (routine)
      await db.$executeRawUnsafe("DROP FUNCTION archive_sdk_commit_wait()");
    if (sequence)
      await db.$executeRawUnsafe('DROP SEQUENCE "archive_sdk_commit_wait"');
  }
});
