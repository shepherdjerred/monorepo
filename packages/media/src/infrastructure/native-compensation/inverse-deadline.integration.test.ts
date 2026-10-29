import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "#automation/native-compensation/test-fixture.ts";
import { createNativeCompensationFileActivities } from "#automation/native-compensation/activities.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { publicationReferences } from "#automation/publication-proof/participants.ts";
import { inspectPublicationRecords } from "#filesystem/publication-proof/records.ts";
import { NativeCompensationDescriptorSchema } from "#shared/native-recovery/compensation.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { readCompletedNativeCompensationState } from "./state.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let activity: NativeCompensationActivityInput;
beforeAll(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
  );
  await fixture.prepare();
  activity = await fixture.apply();
  await fixture.observe(activity);
}, 60_000);
afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test("shorter storage authority expires during actual inverse completion SQL: durable inverse ACKs survive but database completion and terminal ACK roll back", async () => {
  const db = harness.database();
  const f = fixture;
  const before =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    });
  const descriptor = NativeCompensationDescriptorSchema.parse(
    before.descriptor,
  );
  const plan = descriptor.scope.intent.entries.map((item) => item.entry);
  const originalStorage = await db.mediaStorageAuthority.findUniqueOrThrow({
    where: { rootPath: "/data/movies" },
  });
  let shortened = false;
  const context = {
    ...f.context,
    files: {
      ...f.context.files,
      checkpoint: async (phase: string) => {
        await f.context.files.checkpoint(phase);
        if (phase !== "native-compensation-execution-committed") return;
        if (shortened)
          throw new Error("Storage deadline may only be shortened once");
        const expiresAt = new Date(Date.now() + 2000);
        expect(expiresAt.getTime()).toBeLessThan(
          originalStorage.expiresAt.getTime(),
        );
        const changed = await db.mediaStorageAuthority.updateMany({
          where: {
            rootPath: originalStorage.rootPath,
            recoveryEpoch: activity.recoveryEpoch,
            revokedAt: null,
            expiresAt: originalStorage.expiresAt,
          },
          data: { expiresAt },
        });
        expect(changed.count).toBe(1);
        shortened = true;
      },
    },
  };
  const activities = createNativeCompensationFileActivities(
    context,
    testCompensationExecution,
  );
  let sequence = false,
    routine = false,
    trigger = false;
  try {
    await db.$executeRawUnsafe(
      'CREATE SEQUENCE "native_inverse_deadline_wait"',
    );
    sequence = true;
    await db.$executeRawUnsafe(`CREATE FUNCTION native_inverse_deadline_wait() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE sql_deadline NUMERIC; storage_deadline NUMERIC;
      BEGIN
        IF NEW."completion" IS NOT NULL AND OLD."completion" IS NULL THEN
          sql_deadline := NULLIF(current_setting('media.plex_deadline_ms',true),'')::numeric;
          SELECT floor(extract(epoch FROM "expiresAt") * 1000) INTO storage_deadline
            FROM "MediaStorageAuthority" WHERE "rootPath"='/data/movies';
          IF sql_deadline IS NULL OR storage_deadline IS NULL OR sql_deadline <> storage_deadline THEN
            RAISE EXCEPTION 'Inverse completion SQL did not retain the exact shorter storage deadline';
          END IF;
          PERFORM nextval('"native_inverse_deadline_wait"');
          PERFORM pg_sleep(GREATEST(0, (storage_deadline - extract(epoch FROM clock_timestamp()) * 1000) / 1000)::double precision + 0.025);
        END IF;
        RETURN NEW;
      END $$`);
    routine = true;
    await db.$executeRawUnsafe(
      'CREATE TRIGGER native_inverse_deadline_wait BEFORE UPDATE ON "NativePublicationCompensationContinuation" FOR EACH ROW EXECUTE FUNCTION native_inverse_deadline_wait()',
    );
    trigger = true;
    expect(await activities.compensateNativePublicationFiles(activity)).toEqual(
      {
        status: "protected",
        reason: "publication_authority_expired",
      },
    );
    expect(shortened).toBe(true);
    expect(
      await db.$queryRaw<
        { is_called: boolean }[]
      >`SELECT is_called FROM "native_inverse_deadline_wait"`,
    ).toEqual([{ is_called: true }]);
    const current =
      await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: activity.continuationId },
      });
    expect(current).toMatchObject({
      state: "protected",
      completion: null,
      verifiedPublication: null,
      fenceRelease: null,
    });
    expect(current.executionEvidence).not.toBeNull();
    expect(current.descriptor).toEqual(before.descriptor);
    expect(current.descriptorHash).toBe(before.descriptorHash);
    expect(
      await db.$transaction((tx) =>
        readCompletedNativeCompensationState(tx, activity),
      ),
    ).toBeNull();
    expect(
      await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.interrupted.attempt.id },
      }),
    ).toEqual(f.beforeRestore.attempt);
    expect(
      await db.mediaPublicationTransition.findUniqueOrThrow({
        where: { id: f.transition.id },
      }),
    ).toEqual(f.beforeRestore.transition);
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({
      version: f.asset.version,
      ownershipEpoch: f.asset.ownershipEpoch,
    });
    expect(
      await db.acquisitionReservation.count({
        where: { attemptId: f.interrupted.attempt.id },
      }),
    ).toBe(1);

    // Filesystem ACKs precede the failed database completion and are intentionally durable.
    const observed = await inspectPublicationRecords(
      f.context.files.roots.movies,
      {
        transitionId: f.transition.id,
        continuationId: activity.continuationId,
        maxRecords: plan.reduce(
          (sum, entry) => sum + 12 + entry.previousSidecars.length * 8,
          0,
        ),
        maxRecordBytes:
          Buffer.byteLength(JSON.stringify(publicationReferences(plan))) * 64 +
          262_144,
        checkpoint: () => Promise.resolve(),
      },
    );
    expect(
      observed.records.some(
        ({ record }) => record.effect.step === "rollback_publish_rename",
      ),
    ).toBe(true);
    expect(
      observed.records.some(
        ({ record }) => record.effect.step === "journal_complete",
      ),
    ).toBe(true);
    const retained = observed.records.find(
      ({ record }) =>
        record.subtitleId === null &&
        record.effect.step === "rollback_rejected_link",
    )?.record.effect;
    if (retained?.step !== "rollback_rejected_link" || retained.target === null)
      throw new Error("Actual durable rejected-successor link missing");
    expect(
      await readFile(
        path.join(
          f.context.files.roots.movies[retained.target.root],
          retained.target.path,
        ),
        "utf8",
      ),
    ).toBe(f.interrupted.content);
    expect(
      await readFile(workerFilePath(f.file.context, f.canonicalPath), "utf8"),
    ).toBe(f.published.content);
    await observed.assertUnchanged();
    // No retry is granted by restoring timestamps: the real storage authority remains expired.
    const expiredStorage = await db.mediaStorageAuthority.findUniqueOrThrow({
      where: { rootPath: "/data/movies" },
    });
    expect(expiredStorage.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  } finally {
    if (trigger)
      await db.$executeRawUnsafe(
        'DROP TRIGGER native_inverse_deadline_wait ON "NativePublicationCompensationContinuation"',
      );
    if (routine)
      await db.$executeRawUnsafe(
        "DROP FUNCTION native_inverse_deadline_wait()",
      );
    if (sequence)
      await db.$executeRawUnsafe(
        'DROP SEQUENCE "native_inverse_deadline_wait"',
      );
  }
});
