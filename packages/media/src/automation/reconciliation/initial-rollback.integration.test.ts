import { expect, test } from "vitest";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { readFile, rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { FilePlanSchema } from "#automation/files/types.ts";

const { database, context } = automationTestHarness();

test("two actual Retries after initial rollback search and reserve new attempts without touching quarantined versions", async () => {
  const db = database();
  const f = await fileFixture(db);
  try {
    await db.qualityProfileVersion.create({
      data: {
        profileId: f.profile.id,
        version: f.profile.version,
        rules: QualityRulesSchema.parse(f.profile.rules),
      },
    });
    await db.mediaProvider.create({
      data: { id: "knaben", enabled: true, seedingPolicy: { kind: "public" } },
    });
    const initial = await f.acquisition();
    await db.operation.create({
      data: {
        id: initial.input.operationId,
        kind: "acquire_release",
        status: "running",
        payload: {},
      },
    });
    const ctx = context();
    let searches = 0;
    ctx.providers = {
      withProvider: async (_id, work) =>
        await work({
          search: async () => {
            searches++;
            return [
              {
                providerId: "knaben",
                providerReleaseId: crypto.randomUUID(),
                title: "Test.Film.2026.1080p.WEB-DL.H264.ENG",
                sizeBytes: initial.content.length,
                seeders: 5,
                infoHash: "a".repeat(40),
                detailsUrl: "https://fixture.invalid/release",
                download: {
                  kind: "magnet",
                  value: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
                },
              },
            ];
          },
        }),
    };
    const files = createMediaFileActivities(f.context);
    let input = initial.input;
    const attempts = new Set([initial.attempt.id]);
    const quarantined: { path: string; content: string }[] = [];
    for (let pass = 0; pass < 3; pass++) {
      expect(await files.inspectAndStageMedia(input)).toEqual({
        status: "staged",
      });
      expect(await files.promoteMediaFiles(input)).toEqual({
        status: "published",
      });
      const promoted = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      });
      const entry = FilePlanSchema.parse(promoted.filePlan)[0];
      if (entry === undefined) throw new Error("Missing file plan");
      expect(await files.rollbackMediaPromotion(input)).toEqual({
        status: "protected",
        reason: "new_publications_quarantined",
      });
      expect(
        await db.acquisitionReservation.count({
          where: { attemptId: input.attemptId },
        }),
      ).toBe(0);
      expect(
        await createPublicationActivities(ctx).publishRolledBackMedia(input),
      ).toEqual({ status: "blocked", reason: "rollback_no_previous_version" });
      const asset = await db.libraryAsset.findUniqueOrThrow({
        where: { id: entry.assetId },
      });
      expect(asset.state).toBe("rejected");
      quarantined.push({ path: asset.path, content: initial.content });
      for (const saved of quarantined)
        expect(await readFile(saved.path, "utf8")).toBe(saved.content);
      if (pass === 2) break;
      await db.operation.update({
        where: { id: input.operationId },
        data: { status: "reconciling" },
      });
      const media = await db.mediaItem.findUniqueOrThrow({
        where: { id: f.media.id },
      });
      await grantTestRequesterAccess(db, f.user.id, "fixture-server");
      const retry = await new PrismaMediaCommands(db, {
        keepDays: 30,
        serverMachineId: "fixture-server",
      }).act(f.user, crypto.randomUUID(), f.media.id, {
        action: "retry",
        expectedVersion: media.version,
      });
      if (retry.operationId === undefined)
        throw new Error("Retry operation missing");
      const intent = await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId: f.media.id },
      });
      const resumed = await createAcquisitionActivities(
        ctx,
      ).reconcileMediaIntent({
        operationId: retry.operationId,
        mediaId: f.media.id,
        generation: intent.generation,
      });
      expect(resumed.status).toBe("acquire");
      if (resumed.attemptId === null) throw new Error("New attempt missing");
      expect(attempts.has(resumed.attemptId)).toBe(false);
      attempts.add(resumed.attemptId);
      input = { operationId: retry.operationId, attemptId: resumed.attemptId };
      // Supply the same already-downloaded fixture bytes to the newly reserved attempt.
      await db.acquisitionAttempt.update({
        where: { id: input.attemptId },
        data: { state: "ready", torrentId: initial.attempt.torrentId },
      });
    }
    expect(searches).toBe(2);
    expect(attempts.size).toBe(3);
    expect(quarantined).toHaveLength(3);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("empty rollback receipt cannot release an old-epoch reservation", async () => {
  const db = database();
  const f = await fileFixture(db);
  try {
    const initial = await f.acquisition();
    const files = createMediaFileActivities(f.context);
    await files.inspectAndStageMedia(initial.input);
    await files.promoteMediaFiles(initial.input);
    await files.rollbackMediaPromotion(initial.input);
    await db.acquisitionReservation.create({
      data: {
        mediaId: f.media.id,
        attemptId: initial.attempt.id,
        generation: 0,
      },
    });
    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { recoveryEpoch: 1 },
    });
    expect(
      await createPublicationActivities(context()).publishRolledBackMedia(
        initial.input,
      ),
    ).toEqual({ status: "blocked", reason: "recovery_epoch_changed" });
    expect(
      await db.acquisitionReservation.count({
        where: { attemptId: initial.attempt.id },
      }),
    ).toBe(1);
    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { recoveryEpoch: 0 },
    });
    expect(
      await createPublicationActivities(context()).publishRolledBackMedia(
        initial.input,
      ),
    ).toMatchObject({ reason: "rollback_no_previous_version" });
    expect(
      await db.acquisitionReservation.count({
        where: { attemptId: initial.attempt.id },
      }),
    ).toBe(0);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
