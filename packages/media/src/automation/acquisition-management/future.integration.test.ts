import { afterEach, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createManagedSeriesFixture } from "#testing/series-workflow/fixture.ts";
import { managedSeriesWire } from "#testing/series-workflow/wire.ts";
import { futureSeriesCatalog } from "#testing/series-workflow/catalog-wire.ts";
import { createCatalogActivities } from "#automation/reconciliation/catalog.ts";
import { expandCatalogCoverage } from "#automation/reconciliation/library-series.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { createSeriesRequester } from "#testing/series-workflow/requester.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture(1280);
  upgrade = await movieVideoFixture(1920, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("actual catalog refresh and household acquisition publish a later episode independently of a member cancellation", async () => {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade, monitorSeries: { includeSpecials: false } },
  );
  const catalogWire = futureSeriesCatalog(
    f.series.title,
    z.number().parse(f.series.tmdbId),
  );
  const { seasonId, episodeId } = catalogWire;
  const context = {
    ...f.context,
    tmdb: catalogWire.client,
  };
  const refresh = await f.db.operation.findFirstOrThrow({
    where: { kind: "refresh_catalog", targetId: f.series.id },
  });
  const catalog = createCatalogActivities(context);
  const input = { operationId: refresh.id, mediaId: f.series.id, cursor: null };
  expect(await catalog.refreshMediaCatalog(input)).toEqual({
    processed: 1,
    nextCursor: "1:0",
  });
  expect(await catalog.refreshMediaCatalog(input)).toEqual({
    processed: 0,
    nextCursor: null,
  });
  const expanded = await f.db.operation.findFirstOrThrow({
    where: { kind: "expand_catalog_requests", targetId: f.series.id },
  });
  const first = await expandCatalogCoverage(context, {
    ...input,
    operationId: expanded.id,
  });
  expect(first.nextCursor).toBe("library-series:start");
  expect(
    await expandCatalogCoverage(context, {
      ...input,
      operationId: expanded.id,
      cursor: first.nextCursor,
    }),
  ).toEqual({ processed: 3, nextCursor: null });
  const episode = await f.db.mediaItem.findUniqueOrThrow({
    where: { kind_tmdbId: { kind: "episode", tmdbId: episodeId } },
  });
  const operation = await f.db.operation.findFirstOrThrow({
    where: { kind: "reconcile_media", targetId: episode.id },
  });
  const wire = managedSeriesWire(f.db, {
    seriesId: f.series.id,
    mediaIds: [episode.id],
    title: f.series.title,
    downloads: f.files.roots.tv.downloads,
    bytes: upgrade,
    show: f.plexShow,
    episodeSpan: { season: 2, first: 3, last: 3 },
    items: [
      {
        ratingKey: String(episodeId + 1_000_000_000),
        type: "episode",
        title: episode.title,
        librarySectionID: 2,
        grandparentRatingKey: f.plexShow.ratingKey,
        parentRatingKey: String(seasonId + 1_000_000_000),
        parentIndex: 2,
        index: 3,
        Media: [
          {
            Part: [
              {
                id: episodeId,
                file: "/data/tv/future.mkv",
                size: upgrade.byteLength,
              },
            ],
          },
        ],
      },
    ],
  });
  const acquisition = createAcquisitionActivities({ ...context, ...wire });
  const publication = createPublicationActivities({ ...context, ...wire });
  const request = z
    .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
    .parse(operation.payload);
  const starts: unknown[] = [];
  await createOutboxActivities(f.db, (start) => {
    if (start.input["operationId"] === operation.id) starts.push(start);
    return Promise.resolve();
  }).dispatchMediaOutbox();
  expect(starts).toHaveLength(1);
  const reserved = await acquisition.reconcileMediaIntent(request);
  expect(reserved.status).toBe("acquire");
  const command = {
    attemptId: z.uuid().parse(reserved.attemptId),
    operationId: operation.id,
  };
  expect(await acquisition.submitMediaTorrent(command)).toEqual({
    status: "submitted",
    reason: null,
  });
  expect(await acquisition.observeMediaAcquisition(command)).toEqual({
    status: "ready",
    reason: null,
  });
  const { actor, commands } = await createSeriesRequester(f.db);
  expect(
    await f.db.mediaRequest.count({
      where: { mediaId: { in: [f.series.id, ...f.ids, episode.id] } },
    }),
  ).toBe(0);
  const personal = await commands.createRequest(actor, crypto.randomUUID(), {
    mediaId: f.series.id,
    subtitleLanguages: [],
    includeFutureEpisodes: true,
    includeSpecials: false,
  });
  const requestId = z.uuid().parse(personal.requestId);
  const cancelled = await commands.cancelRequest(
    actor,
    crypto.randomUUID(),
    requestId,
    0,
  );
  await createCoverageActivities({ db: f.db }).expandMediaRequest({
    operationId: z.uuid().parse(cancelled.operationId),
    requestId,
    requestVersion: 1,
    cursor: null,
  });
  expect(await f.physical.inspectAndStageMedia(command)).toEqual({
    status: "staged",
  });
  expect(await f.physical.promoteMediaFiles(command)).toEqual({
    status: "published",
  });
  expect(await publication.publishMediaToPlex(command)).toEqual({
    status: "available",
    reason: null,
  });
  await publication.finalizeMediaAcquisition(command);
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: command.attemptId },
    include: { torrent: true, reservations: true },
  });
  expect(attempt).toMatchObject({
    state: "completed",
    sponsorRequestId: null,
    identityEvidence: {
      schemaVersion: 4,
      management: {
        schemaVersion: 2,
        receiptId: f.receiptId,
        policyScope: "series",
        includeSpecials: false,
        targets: [{ mediaId: episode.id, generation: 1 }],
      },
    },
    torrent: { owned: true },
    reservations: [],
  });
  expect(
    await f.db.mediaRequest.count({
      where: { mediaId: { in: [f.series.id, ...f.ids, episode.id] } },
    }),
  ).toBe(1);
  expect(
    await f.db.mediaRequest.count({
      where: {
        mediaId: { in: [f.series.id, ...f.ids, episode.id] },
        active: true,
      },
    }),
  ).toBe(0);
  expect(wire.additions()).toBe(1);
});
