import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { queueLifecycleNotifications } from "./events.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { rm } from "node:fs/promises";
import { FilePlanSchema } from "#automation/files/types.ts";
import { QualityRulesSchema } from "#shared/api.ts";

const { database, fixture, context } = automationTestHarness();

test("actual committed import Retry publishes once using adopted authority without rewriting file evidence", async () => {
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
    await db.notificationPreference.create({
      data: { userId: f.user.id, emailEnabled: true },
    });
    const acquired = await f.acquisition();
    await db.operation.create({
      data: {
        id: acquired.input.operationId,
        idempotencyKey: crypto.randomUUID(),
        userId: f.user.id,
        kind: "acquire_release",
        targetId: f.media.id,
        status: "reconciling",
        payload: {},
      },
    });
    const files = createMediaFileActivities(f.context);
    expect(await files.inspectAndStageMedia(acquired.input)).toEqual({
      status: "staged",
    });
    expect(await files.promoteMediaFiles(acquired.input)).toEqual({
      status: "published",
    });
    const imported = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    const entry = FilePlanSchema.parse(imported.filePlan)[0];
    if (entry === undefined) throw new Error("Fixture import missing");
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: entry.assetId },
    });
    const current = await db.mediaItem.findUniqueOrThrow({
      where: { id: f.media.id },
    });
    const retry = await new PrismaMediaApplication(db, { keepDays: 30 }).act(
      { ...f.user, role: "member" },
      crypto.randomUUID(),
      f.media.id,
      { action: "retry", expectedVersion: current.version },
    );
    if (retry.operationId === undefined)
      throw new Error("Retry operation missing");
    const ctx = context(async (url) => {
      if (url.pathname.endsWith("/library/sections"))
        return Response.json({
          MediaContainer: {
            size: 1,
            Directory: [{ key: "1", title: "Movies", type: "movie" }],
          },
        });
      if (url.pathname.endsWith("/refresh")) return new Response();
      return Response.json({
        MediaContainer: {
          size: 1,
          totalSize: 1,
          Metadata: [
            {
              ratingKey: "321",
              type: "movie",
              title: f.media.title,
              Guid: [{ id: `tmdb://${String(f.media.tmdbId)}` }],
              Media: [{ Part: [{ id: 1, file: asset.path }] }],
            },
          ],
        },
      });
    });
    expect(
      await createAcquisitionActivities(ctx).reconcileMediaIntent({
        operationId: retry.operationId,
        mediaId: f.media.id,
        generation: 1,
      }),
    ).toMatchObject({ status: "acquire", attemptId: acquired.attempt.id });
    const input = { ...acquired.input, operationId: retry.operationId };
    expect(await files.inspectAndStageMedia(input)).toEqual({
      status: "staged",
    });
    expect(await files.promoteMediaFiles(input)).toEqual({
      status: "published",
    });
    const publication = createPublicationActivities(ctx);
    expect(await publication.publishMediaToPlex(input)).toMatchObject({
      status: "available",
    });
    expect(await publication.publishMediaToPlex(input)).toMatchObject({
      status: "available",
    });
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    expect(attempt.filePlan).toEqual(imported.filePlan);
    expect(attempt.generations).toEqual({ [f.media.id]: 1 });
    const deliveries = await db.notificationDelivery.findMany({
      where: { userId: f.user.id },
      include: { event: true },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.event.payload).toMatchObject({
      items: [{ mediaId: f.media.id, generation: 1, assetId: asset.id }],
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("completed removal delivery is opt-in while per-item history remains idempotent", async () => {
  const data = await fixture();
  await database().notificationPreference.create({
    data: { userId: data.user.id, emailEnabled: true },
  });
  const input = {
    key: `quarantine:${data.media.id}`,
    kind: "files_quarantined" as const,
    epoch: 0,
    items: [
      { mediaId: data.media.id, generation: 1, decisionId: "fixture-decision" },
    ],
  };
  await database().$transaction((tx) => queueLifecycleNotifications(tx, input));
  expect(
    await database().notificationDelivery.count({
      where: { userId: data.user.id },
    }),
  ).toBe(0);
  await database().notificationPreference.update({
    where: { userId: data.user.id },
    data: { removalCompleted: true },
  });
  for (let repeat = 0; repeat < 2; repeat++)
    await database().$transaction((tx) =>
      queueLifecycleNotifications(tx, input),
    );
  expect(
    await database().applicationEvent.count({
      where: { dedupeKey: `${input.key}:item:${data.media.id}` },
    }),
  ).toBe(1);
  expect(
    await database().notificationDelivery.count({
      where: { userId: data.user.id },
    }),
  ).toBe(1);
});

test("provider/storage interventions notify the owner once and retain the operation birth epoch", async () => {
  const data = await fixture();
  const owner = await database().mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Owner",
      role: "owner",
      notificationPreference: { create: { emailEnabled: true } },
    },
  });
  await database().operation.update({
    where: { id: data.input.operationId },
    data: {
      kind: "retain_media",
      payload: { mediaId: data.media.id, recoveryEpoch: 0 },
    },
  });
  const outbox = createOutboxActivities(database(), async () => {
    throw new Error("No dispatch in producer test");
  });
  for (let repeat = 0; repeat < 2; repeat++)
    await outbox.finishMediaOperation({
      operationId: data.input.operationId,
      status: "failed",
      reason: "storage_requires_review",
    });
  const deliveries = await database().notificationDelivery.findMany({
    where: { userId: owner.id },
    include: { event: true },
  });
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]).toMatchObject({
    recoveryEpoch: 0,
    event: { kind: "system_intervention" },
  });
  expect(
    await database().applicationEvent.count({
      where: { mediaId: data.media.id, kind: "acquisition_failed" },
    }),
  ).toBe(0);
});
