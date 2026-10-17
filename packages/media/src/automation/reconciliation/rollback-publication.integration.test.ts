import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { publicationSeries } from "./publication.test-support.ts";

const { database, context, fixture } = automationTestHarness();

async function rolledBackFixture() {
  const data = await fixture();
  const series = await publicationSeries(database(), data.media.id);
  await database().mediaItem.update({
    where: { id: data.media.id },
    data: {
      kind: "episode",
      seasonNumber: 1,
      episodeNumber: 1,
      externalIds: { seriesTmdb: 999 },
      availability: "importing",
    },
  });
  const second = await database().mediaItem.create({
    data: {
      kind: "episode",
      title: "Second",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 2,
      externalIds: { seriesTmdb: 999 },
      availability: "importing",
      intents: {
        create: {
          generation: 1,
          profileId: data.profile.id,
          automationEpoch: 0,
          editionRootId: series.id,
        },
      },
    },
  });
  const mediaIds = [data.media.id, second.id];
  const asset = await database().libraryAsset.create({
    data: {
      path: `/fixture/${crypto.randomUUID()}.mkv`,
      sizeBytes: 1000n,
      checksum: "abc",
      owned: true,
      ownershipEpoch: 0,
      editionRootId: series.id,
      properties: {},
      state: "published",
      coverage: {
        create: mediaIds.map((mediaId) => ({ mediaId, current: true })),
      },
    },
  });
  const request = await database().mediaRequest.findFirstOrThrow({
    where: { mediaId: data.media.id },
  });
  const attempt = await database().acquisitionAttempt.create({
    data: {
      operationId: data.input.operationId,
      releaseId: data.release.id,
      sponsorRequestId: request.id,
      mediaIds,
      generations: Object.fromEntries(mediaIds.map((id) => [id, 1])),
      state: "rolled_back",
      failure: {
        rollbackReceipt: {
          recoveryEpoch: 0,
          mediaIds,
          assets: [
            {
              assetId: asset.id,
              assetVersion: asset.version,
              checksum: asset.checksum,
            },
          ],
        },
      },
      reservations: {
        create: mediaIds.map((mediaId) => ({ mediaId, generation: 1 })),
      },
    },
  });
  // A previous failed scan must not carry its cursor or stale rating keys into rollback.
  await database().operation.update({
    where: { id: data.input.operationId },
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
  return {
    ...data,
    mediaIds,
    asset,
    attempt,
    input: { operationId: data.input.operationId, attemptId: attempt.id },
  };
}

test("rollback keeps all shared-file episodes importing until fresh Plex identity verification", async () => {
  const data = await rolledBackFixture();
  let scans = 0;
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/library/sections"))
      return Response.json({
        MediaContainer: {
          size: 1,
          Directory: [{ key: "2", title: "TV", type: "show" }],
        },
      });
    if (url.pathname.endsWith("/refresh")) return new Response();
    if (url.pathname.endsWith("/all")) {
      expect(url.searchParams.get("X-Plex-Container-Start")).toBe("0");
      scans++;
      const episodes = scans === 1 ? [] : [1, 2];
      return Response.json({
        MediaContainer: {
          size: episodes.length,
          totalSize: episodes.length,
          Metadata: episodes.map((episode) => ({
            ratingKey: String(episode),
            title: "Episode",
            type: "episode",
            index: episode,
            parentIndex: 1,
            grandparentRatingKey: "500",
            Media: [{ Part: [{ id: 1, file: data.asset.path }] }],
          })),
        },
      });
    }
    if (url.pathname.endsWith("/metadata/500"))
      return Response.json({
        MediaContainer: {
          size: 1,
          Metadata: [
            {
              ratingKey: "500",
              title: "Series",
              type: "show",
              Guid: [{ id: "tmdb://999" }],
            },
          ],
        },
      });
    throw new Error("Unexpected Plex request");
  });
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
