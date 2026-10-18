import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { seasonPublicationFixture } from "#automation/publication-proof/season-fixture.ts";
import { nativeStorageFixture } from "#automation/native-recovery/test-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import { PrismaNativeCompensation } from "#infrastructure/native-compensation/service.ts";
import { inspectPublicationRecords } from "#filesystem/publication-proof/records.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeStorageFixture>>;
let transitionId: string;
let directory: string | undefined;

beforeAll(async () => {
  const db = harness.database();
  fixture = await nativeStorageFixture(
    db,
    harness.context().cipher,
    "seeding",
    {
      fileFactory: async () => {
        const file = await seasonPublicationFixture(db);
        directory = file.directory;
        return file;
      },
      beforeRestore: async ({ file, published }) => {
        const original = await db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: published.attempt.id },
        });
        expect(FilePlanSchema.parse(original.filePlan)).toHaveLength(26);
        const inspect = file.context.inspect;
        if (inspect === undefined)
          throw new Error("Season fixture probe missing");
        file.context.inspect = async (name) => {
          const result = await inspect(name);
          return {
            ...result,
            streams: result.streams.map((stream) =>
              stream.codec_type === "video"
                ? { ...stream, width: 3840, height: 1600 }
                : stream,
            ),
          };
        };
        const upgrade = await file.acquisition(
          "Actual complete season successor D",
        );
        const activities = createMediaFileActivities(file.context);
        expect(await activities.inspectAndStageMedia(upgrade.input)).toEqual({
          status: "staged",
        });
        const checkpoint = file.context.checkpoint;
        const interruption = new Error(
          "Stop after the first real durable effect acknowledgement",
        );
        file.context.checkpoint = async (phase) => {
          await checkpoint(phase);
          if (phase === "publication-effect-ack:move_link") throw interruption;
        };
        try {
          await expect(
            activities.promoteMediaFiles(upgrade.input),
          ).rejects.toBe(interruption);
        } finally {
          file.context.checkpoint = checkpoint;
        }
        const transition =
          await db.mediaPublicationTransition.findUniqueOrThrow({
            where: { attemptId: upgrade.attempt.id },
          });
        const intent = PublicationIntentSchema.parse(transition.intent);
        expect(intent.entries).toHaveLength(26);
        expect(
          new Set(
            intent.entries.flatMap(({ entry }) => [
              entry.assetId,
              entry.previousAssetId,
            ]),
          ).size,
        ).toBe(52);
        expect(
          intent.entries.every(({ predecessor }) => predecessor !== null),
        ).toBe(true);
        expect(transition.outcome).toBeNull();
        const durable = await inspectPublicationRecords(file.context.roots.tv, {
          transitionId: transition.id,
          continuationId: null,
          maxRecords: 26 * 20,
          maxRecordBytes: 4_194_304,
          checkpoint: () => Promise.resolve(),
        });
        expect(durable.records.length).toBeGreaterThan(0);
        expect(
          durable.records.some(
            ({ record }) => record.effect.step === "move_link",
          ),
        ).toBe(true);
        transitionId = transition.id;
      },
    },
  );
}, 60_000);

afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

test("a restored 26-entry upgrade protects its whole 52-video union before creating compensation authority", async () => {
  const db = harness.database();
  const before = {
    plans: await db.nativeRecoveryPlan.count(),
    holds: await db.recoveryHold.findMany({ orderBy: { mediaId: "asc" } }),
    continuations: await db.nativePublicationCompensationContinuation.count(),
    transition: await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: transitionId },
    }),
  };
  const service = new PrismaNativeCompensation(db, () => Promise.resolve(null));
  await expect(
    service.prepare(fixture.prior.actor, crypto.randomUUID(), {
      lifecycleKind: "publication_compensation",
      transitionId,
      restoreOperationId: fixture.restore.id,
      recoveryEpoch: fixture.runtime.recoveryEpoch,
      runtimeVersion: fixture.runtime.version,
      activation: "activate",
    }),
  ).rejects.toMatchObject({ reason: "compensation_scope_exceeds_limit" });
  expect(await db.nativeRecoveryPlan.count()).toBe(before.plans);
  expect(
    await db.recoveryHold.findMany({ orderBy: { mediaId: "asc" } }),
  ).toEqual(before.holds);
  expect(await db.nativePublicationCompensationContinuation.count()).toBe(
    before.continuations,
  );
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: transitionId },
    }),
  ).toEqual(before.transition);
});
