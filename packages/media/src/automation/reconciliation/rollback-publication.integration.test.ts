import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { retentionPlexContext } from "#automation/retention/fixtures/plex.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";

const { database, context } = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function rolledBackFixture() {
  const db = database();
  const files = await sharedTvFileFixture(db, mappedPublicationFixture);
  directories.push(files.directory);
  const original = await preparePhysicalPublication(files);
  const originalWire = await retentionPlexContext(
    db,
    context(),
    original.entry.mediaIds,
  );
  const publisher = createPublicationActivities(originalWire.context);
  expect(await publisher.publishMediaToPlex(original.input)).toEqual({
    status: "available",
    reason: null,
  });
  await publisher.finalizeMediaAcquisition(original.input);
  const inspect = files.context.inspect;
  if (inspect === undefined) throw new Error("Missing inspector");
  files.context.inspect = async (path) => {
    const probe = await inspect(path);
    return {
      ...probe,
      streams: probe.streams.map((stream) =>
        stream.codec_type === "video"
          ? { ...stream, width: 3840, height: 1600 }
          : stream,
      ),
    };
  };
  const upgraded = await preparePhysicalPublication({
    ...files,
    acquisition: () => files.acquisition("Improved shared TV video contents"),
  });
  expect(upgraded.entry.previousAssetId).toBe(original.entry.assetId);
  expect(
    await createMediaFileActivities(files.context).rollbackMediaPromotion(
      upgraded.input,
    ),
  ).toEqual({ status: "rolled_back" });
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: upgraded.attempt.id },
  });
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: original.entry.assetId },
  });
  // A previous failed scan must not carry its cursor or stale rating keys into rollback.
  await db.operation.update({
    where: { id: upgraded.input.operationId },
    data: {
      result: {
        plexScan: {
          scope: "publication",
          sectionId: "2",
          offset: 4000,
          matches: [{ path: asset.path, ratingKey: "failed-new-version" }],
        },
      },
    },
  });
  const transport = await retentionPlexContext(db, context(), attempt.mediaIds);
  return {
    media: files.media,
    mediaIds: attempt.mediaIds,
    asset,
    attempt,
    input: upgraded.input,
    transport,
  };
}
test("rollback keeps all shared-file episodes importing until fresh Plex identity verification", async () => {
  const data = await rolledBackFixture();
  let scans = 0;
  const ctx = data.transport.context;
  const libraryPage = ctx.plex.libraryPage.bind(ctx.plex);
  ctx.plex.libraryPage = async (input) => {
    expect(input.offset).toBe(0);
    scans++;
    return scans === 1 ? { total: 0, items: [] } : await libraryPage(input);
  };
  const activities = createPublicationActivities(ctx);
  expect(await activities.publishRolledBackMedia(data.input)).toEqual({
    status: "waiting",
    reason: "plex_scan_pending",
  });
  expect(
    await database().mediaItem.count({
      where: { id: { in: data.mediaIds }, availability: "importing" },
    }),
  ).toBe(2);
  expect(
    await database().acquisitionReservation.count({
      where: { attemptId: data.attempt.id },
    }),
  ).toBe(2);
  expect(await activities.publishRolledBackMedia(data.input)).toEqual({
    status: "available",
    reason: null,
  });
  expect(
    await database().mediaItem.count({
      where: { id: { in: data.mediaIds }, availability: "available" },
    }),
  ).toBe(2);
  expect(
    await database().acquisitionReservation.count({
      where: { attemptId: data.attempt.id },
    }),
  ).toBe(0);
  const asset = await database().libraryAsset.findUniqueOrThrow({
    where: { id: data.asset.id },
  });
  expect(asset.plexPublishedAt).not.toBeNull();
});

test.each(["epoch", "generation", "asset"] as const)(
  "rollback protects changed %s evidence before any Plex call",
  async (change) => {
    const data = await rolledBackFixture();
    if (change === "epoch")
      await database().mediaRuntimeState.update({
        where: { id: "singleton" },
        data: { recoveryEpoch: 1 },
      });
    if (change === "generation")
      await database().mediaIntent.update({
        where: {
          mediaId_edition: { mediaId: data.media.id, edition: "default" },
        },
        data: { generation: 2 },
      });
    if (change === "asset")
      await database().libraryAsset.update({
        where: { id: data.asset.id },
        data: { version: { increment: 1 } },
      });
    expect(
      await createPublicationActivities(context()).publishRolledBackMedia(
        data.input,
      ),
    ).toMatchObject({ status: "blocked" });
    expect(
      await database().mediaItem.count({
        where: { id: { in: data.mediaIds }, availability: "importing" },
      }),
    ).toBe(2);
  },
);
