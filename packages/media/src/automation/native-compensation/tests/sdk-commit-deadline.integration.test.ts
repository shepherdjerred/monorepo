import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeCompensationFixture } from "#automation/native-compensation/test-fixture.ts";
import { compensationInvocation } from "#automation/native-compensation/execution.ts";
import { executeNativeCompensation } from "#automation/native-compensation/execute.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { publicationReferences } from "#automation/publication-proof/participants.ts";
import { inspectPublicationRecords } from "#filesystem/publication-proof/records.ts";
import { NativeCompensationDescriptorSchema } from "#shared/native-recovery/compensation.ts";
import type {
  NativeCompensationActivityInput,
  NativeCompensationExecutionContext,
} from "#shared/native-recovery/compensation-runtime.ts";
import { readCompletedNativeCompensationState } from "#infrastructure/native-compensation/state.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let activity: NativeCompensationActivityInput;
beforeEach(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
  );
  await fixture.prepare();
  activity = await fixture.apply();
  await fixture.observe(activity);
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

/** A short original SDK clock, born after actual preparation; never refreshed. */
function originalExecution(): NativeCompensationExecutionContext {
  const expiresAtMs = Date.now() + 2000;
  const monotonicDeadline = performance.now() + 2000;
  const signal = new AbortController().signal;
  const assertActive = () => {
    signal.throwIfAborted();
    if (Date.now() >= expiresAtMs || performance.now() >= monotonicDeadline)
      throw new Error("Original compensation SDK deadline expired");
  };
  return {
    expiresAtMs,
    signal,
    assertActive,
    checkpoint: () => {
      assertActive();
      return Promise.resolve();
    },
  };
}

async function installCommitObservation(
  execution: NativeCompensationExecutionContext,
  delay: boolean,
) {
  const db = harness.database();
  const continuationId = z.uuid().parse(activity.continuationId);
  const deadline = String(
    z.number().int().positive().parse(execution.expiresAtMs),
  );
  await db.$executeRawUnsafe(
    'CREATE SEQUENCE "compensation_sdk_commit_visits"',
  );
  // The literal inputs are a validated UUID, safe integer, and boolean. The
  // sleeper observes the real physical completion transaction only, not the
  // earlier execution-record transaction. It never implements the fence itself.
  await db.$executeRawUnsafe(`CREATE FUNCTION compensation_sdk_commit_observe() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM "NativePublicationCompensationContinuation"
        WHERE id='${continuationId}'::text AND completion IS NOT NULL) THEN
        IF NEW."deadlineMs" <> ${deadline} OR
          current_setting('media.plex_deadline_ms')::numeric <> ${deadline} THEN
          RAISE EXCEPTION 'Compensation commit did not retain the original SDK minimum';
        END IF;
        PERFORM nextval('compensation_sdk_commit_visits');
        IF ${delay ? "TRUE" : "FALSE"} THEN
          PERFORM pg_sleep(GREATEST(0, (${deadline} - extract(epoch FROM clock_timestamp()) * 1000) / 1000)::double precision + 0.025);
        END IF;
      END IF;
      RETURN NULL;
    END $$`);
  await db.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER aa_compensation_sdk_commit_observe
    AFTER INSERT OR UPDATE ON "PlexDeadlineValidation"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION compensation_sdk_commit_observe()`);
  const triggers = await db.$queryRaw<
    {
      name: string;
      deferred: boolean;
      initiallyDeferred: boolean;
      enabled: string;
    }[]
  >`SELECT tgname AS name, tgdeferrable AS deferred, tginitdeferred AS "initiallyDeferred", tgenabled::text AS enabled
    FROM pg_trigger WHERE tgrelid='"PlexDeadlineValidation"'::regclass
      AND tgname IN ('aa_compensation_sdk_commit_observe','plex_validate_transaction_deadline') ORDER BY tgname`;
  expect(triggers).toEqual([
    {
      name: "aa_compensation_sdk_commit_observe",
      deferred: true,
      initiallyDeferred: true,
      enabled: "O",
    },
    {
      name: "plex_validate_transaction_deadline",
      deferred: true,
      initiallyDeferred: true,
      enabled: "O",
    },
  ]);
}

async function removeCommitObservation() {
  const db = harness.database();
  await db.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS aa_compensation_sdk_commit_observe ON "PlexDeadlineValidation"',
  );
  await db.$executeRawUnsafe(
    "DROP FUNCTION IF EXISTS compensation_sdk_commit_observe()",
  );
  await db.$executeRawUnsafe(
    'DROP SEQUENCE IF EXISTS "compensation_sdk_commit_visits"',
  );
}

async function assertDurableInverse() {
  const db = harness.database();
  const row =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    });
  const descriptor = NativeCompensationDescriptorSchema.parse(row.descriptor);
  const plan = descriptor.scope.intent.entries.map((item) => item.entry);
  const observed = await inspectPublicationRecords(
    fixture.context.files.roots.movies,
    {
      transitionId: fixture.transition.id,
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
      ({ record }) => record.effect.step === "journal_complete",
    ),
  ).toBe(true);
  expect(
    observed.records.some(
      ({ record }) => record.effect.step === "rollback_publish_rename",
    ),
  ).toBe(true);
  const retained = observed.records.find(
    ({ record }) =>
      record.subtitleId === null &&
      record.effect.step === "rollback_rejected_link",
  )?.record.effect;
  if (retained?.step !== "rollback_rejected_link" || retained.target === null)
    throw new Error("Actual retained successor ACK missing");
  expect(
    await readFile(
      path.join(
        fixture.context.files.roots.movies[retained.target.root],
        retained.target.path,
      ),
      "utf8",
    ),
  ).toBe(fixture.interrupted.content);
  expect(
    await readFile(
      workerFilePath(fixture.file.context, fixture.canonicalPath),
      "utf8",
    ),
  ).toBe(fixture.published.content);
  await observed.assertUnchanged();
}

test.each([false, true])(
  "actual inverse completion respects original SDK deadline at deferred COMMIT, delay=%s",
  async (delay) => {
    const db = harness.database();
    const before =
      await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: activity.continuationId },
      });
    let beforeCommit = false;
    const context = {
      ...fixture.context,
      files: {
        ...fixture.context.files,
        checkpoint: async (phase: string) => {
          await fixture.context.files.checkpoint(phase);
          if (phase === "native-compensation-before-commit")
            beforeCommit = true;
        },
      },
    };
    const execution = originalExecution();
    try {
      await installCommitObservation(execution, delay);
      const running = executeNativeCompensation(
        compensationInvocation(context, execution),
        activity,
      );
      if (delay)
        await expect(running).rejects.toThrow(
          "Plex authority deadline missing or expired",
        );
      else await running;
      expect(beforeCommit).toBe(true);
      // A sequence is nontransactional: this proves the actual deferred event ran
      // after the final JavaScript checks, even though its transaction rolled back.
      expect(
        await db.$queryRaw`SELECT is_called FROM compensation_sdk_commit_visits`,
      ).toEqual([{ is_called: true }]);
      expect(
        await db.$queryRaw`SELECT * FROM "PlexDeadlineValidation"`,
      ).toEqual([]);
      const current =
        await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: activity.continuationId },
        });
      expect(current.descriptor).toEqual(before.descriptor);
      expect(current.descriptorHash).toBe(before.descriptorHash);
      expect(current.executionEvidence).not.toBeNull();
      const completed = await db.$transaction((tx) =>
        readCompletedNativeCompensationState(tx, activity),
      );
      if (delay) {
        expect(current.completion).toBeNull();
        expect(current.verifiedPublication).toBeNull();
        expect(current.fenceRelease).toBeNull();
        expect(completed).toBeNull();
        expect(
          await db.acquisitionAttempt.findUniqueOrThrow({
            where: { id: fixture.interrupted.attempt.id },
          }),
        ).toEqual(fixture.beforeRestore.attempt);
        expect(
          await db.mediaPublicationTransition.findUniqueOrThrow({
            where: { id: fixture.transition.id },
          }),
        ).toEqual(fixture.beforeRestore.transition);
        expect(
          await db.acquisitionReservation.count({
            where: { attemptId: fixture.interrupted.attempt.id },
          }),
        ).toBe(1);
      } else {
        expect(current.state).toBe("compensated");
        expect(current.completion).not.toBeNull();
        expect(completed).not.toBeNull();
      }
      await assertDurableInverse();
    } finally {
      await removeCommitObservation();
    }
  },
);
