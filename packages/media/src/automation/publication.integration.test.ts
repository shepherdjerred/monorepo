import { expect, test } from "vitest";
import { createPublicationActivities } from "./publication.ts";
import { automationTestHarness } from "#testing/automation.ts";
import { publicationSeries } from "./reconciliation/publication.test-support.ts";
const { database, context, fixture } = automationTestHarness();
test.each(["acquisition", "restore"])(
  "Plex %s publication verifies all episodes sharing one file",
  async (mode) => {
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
        intents: { create: { automationEpoch: 0, editionRootId: series.id } },
        seasonNumber: 1,
        episodeNumber: 2,
        externalIds: { seriesTmdb: 999 },
        availability: "importing",
      },
    });
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
          create: [
            { mediaId: data.media.id, current: true },
            { mediaId: second.id, current: true },
          ],
        },
      },
    });
    if (mode === "restore") {
      const decision = await database().retentionDecision.create({
        data: {
          mediaId: data.media.id,
          generation: 1,
          state: "restored",
          evidence: {},
          manifest: {
            assets: [
              { assetId: asset.id, mediaIds: [data.media.id, second.id] },
            ],
          },
        },
      });
      await database().operation.update({
        where: { id: data.input.operationId },
        data: {
          kind: "restore_media",
          result: {
            restoreReceipt: {
              decisionId: decision.id,
              mediaIds: [data.media.id, second.id],
              recoveryEpoch: 0,
              assets: [
                {
                  assetId: asset.id,
                  assetVersion: asset.version,
                  checksum: "abc",
                },
              ],
            },
          },
        },
      });
    }
    const request = await database().mediaRequest.findFirstOrThrow({
      where: { mediaId: data.media.id },
    });
    const attempt = await database().acquisitionAttempt.create({
      data: {
        operationId: data.input.operationId,
        releaseId: data.release.id,
        sponsorRequestId: request.id,
        mediaIds: [data.media.id, second.id],
        generations: { [data.media.id]: 1, [second.id]: 0 },
        state: "imported",
        filePlan: [
          {
            assetId: asset.id,
            mediaIds: [data.media.id, second.id],
            checksum: asset.checksum,
            generations: { [data.media.id]: 1, [second.id]: 1 },
            previousAssetId: null,
          },
        ],
      },
    });
    const ctx = context(async (url) => {
      if (url.pathname.endsWith("/library/sections"))
        return Response.json({
          MediaContainer: {
            size: 1,
            Directory: [{ key: "2", title: "TV", type: "show" }],
          },
        });
      if (url.pathname.endsWith("/refresh")) return new Response();
      if (url.pathname.endsWith("/all"))
        return Response.json({
          MediaContainer: {
            size: 2,
            totalSize: 2,
            Metadata: [1, 2].map((episode) => ({
              ratingKey: String(episode),
              title: "Episode",
              type: "episode",
              index: episode,
              parentIndex: 1,
              grandparentRatingKey: "500",
              Media: [{ Part: [{ id: 1, file: asset.path }] }],
            })),
          },
        });
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
    const priorIntents = await database().mediaIntent.findMany({
      where: {
        mediaId: { in: [data.media.id, second.id] },
        edition: "default",
      },
    });
    expect(
      mode === "restore"
        ? await createPublicationActivities(ctx).publishRestoredMedia(
            data.input,
          )
        : await createPublicationActivities(ctx).publishMediaToPlex({
            operationId: data.input.operationId,
            attemptId: attempt.id,
          }),
    ).toEqual({ status: "available", reason: null });
    expect(
      await database().mediaItem.count({
        where: {
          id: { in: [data.media.id, second.id] },
          availability: "available",
        },
      }),
    ).toBe(2);
    const currentIntents = await database().mediaIntent.findMany({
      where: {
        mediaId: { in: [data.media.id, second.id] },
        edition: "default",
      },
    });
    for (const prior of priorIntents) {
      expect(
        currentIntents.find((intent) => intent.mediaId === prior.mediaId),
      ).toMatchObject({
        availability: "available",
        generation: prior.generation,
        version: prior.version,
        automationEpoch: prior.automationEpoch,
      });
    }
    if (mode === "restore")
      expect(
        await database().operation.findUnique({
          where: { id: data.input.operationId },
        }),
      ).toMatchObject({
        result: {
          restoreReceipt: { mediaIds: [data.media.id, second.id] },
          plexScan: { sectionId: "2" },
        },
      });
  },
);

test("a correct Plex path with the wrong canonical movie identity stays unavailable", async () => {
  const data = await fixture();
  await database().mediaItem.update({
    where: { id: data.media.id },
    data: { tmdbId: 987, availability: "importing" },
  });
  const asset = await database().libraryAsset.create({
    data: {
      path: `/fixture/${crypto.randomUUID()}.mkv`,
      sizeBytes: 1000n,
      owned: true,
      ownershipEpoch: 0,
      editionRootId: data.media.id,
      properties: {},
      state: "published",
      coverage: { create: { mediaId: data.media.id, current: true } },
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
      mediaIds: [data.media.id],
      generations: { [data.media.id]: 1 },
      state: "imported",
    },
  });
  const item = {
    ratingKey: "123",
    title: "Wrong match",
    type: "movie",
    Guid: [{ id: "tmdb://654" }],
    Media: [{ Part: [{ id: 1, file: asset.path }] }],
  };
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/library/sections"))
      return Response.json({
        MediaContainer: {
          size: 1,
          Directory: [{ key: "1", title: "Movies", type: "movie" }],
        },
      });
    return url.pathname.endsWith("/refresh")
      ? new Response()
      : Response.json({
          MediaContainer: { size: 1, totalSize: 1, Metadata: [item] },
        });
  });
  expect(
    await createPublicationActivities(ctx).publishMediaToPlex({
      operationId: data.input.operationId,
      attemptId: attempt.id,
    }),
  ).toMatchObject({ status: "blocked", reason: "plex_identity_mismatch" });
  expect(
    await database().mediaItem.findUnique({
      where: { id: data.media.id },
    }),
  ).toMatchObject({ availability: "importing" });
});
test("Plex verification cannot mark a concurrently quarantined asset available", async () => {
  const data = await fixture();
  await database().mediaItem.update({
    where: { id: data.media.id },
    data: { tmdbId: 988, availability: "importing" },
  });
  const asset = await database().libraryAsset.create({
    data: {
      path: `/fixture/${crypto.randomUUID()}.mkv`,
      sizeBytes: 1000n,
      checksum: "abc",
      owned: true,
      ownershipEpoch: 0,
      editionRootId: data.media.id,
      properties: {},
      state: "published",
      coverage: { create: { mediaId: data.media.id, current: true } },
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
      mediaIds: [data.media.id],
      generations: { [data.media.id]: 1 },
      state: "imported",
    },
  });
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/library/sections"))
      return Response.json({
        MediaContainer: {
          size: 1,
          Directory: [{ key: "1", title: "Movies", type: "movie" }],
        },
      });
    if (url.pathname.endsWith("/refresh")) return new Response();
    await database().libraryAsset.update({
      where: { id: asset.id },
      data: { state: "quarantined", version: { increment: 1 } },
    });
    await database().mediaItem.update({
      where: { id: data.media.id },
      data: { availability: "quarantined" },
    });
    return Response.json({
      MediaContainer: {
        size: 1,
        totalSize: 1,
        Metadata: [
          {
            ratingKey: "123",
            title: "Example",
            type: "movie",
            Guid: [{ id: "tmdb://988" }],
            Media: [{ Part: [{ id: 1, file: asset.path }] }],
          },
        ],
      },
    });
  });
  await expect(
    createPublicationActivities(ctx).publishMediaToPlex({
      operationId: data.input.operationId,
      attemptId: attempt.id,
    }),
  ).rejects.toThrow("Publication evidence changed");
  expect(
    await database().mediaItem.findUnique({ where: { id: data.media.id } }),
  ).toMatchObject({ availability: "quarantined" });
});
