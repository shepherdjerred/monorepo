import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { TmdbCatalogApplication } from "#infrastructure/catalog.ts";
import { createCatalogActivities } from "#automation/reconciliation/catalog.ts";
import { PrismaMigrationAdministration } from "./persistence.ts";
import { MigrationCatalogDiscovery } from "./catalog-discovery.ts";
import { captureFixture, mediaFixture } from "./bundle-test-fixtures.ts";

const { database, context } = automationTestHarness();
async function catalogResponse(url: URL) {
  if (url.pathname.endsWith("/movie/33/alternative_titles"))
    return Response.json({ id: 33, titles: [] });
  if (url.pathname.endsWith("/tv/44/alternative_titles"))
    return Response.json({ id: 44, results: [] });
  if (url.pathname.endsWith("/find/778")) {
    expect(url.searchParams.get("external_source")).toBe("tvdb_id");
    return Response.json({ movie_results: [], tv_results: [{ id: 44 }] });
  }
  if (url.pathname.endsWith("/tv/44/external_ids"))
    return Response.json({ id: 44, tvdb_id: 778, imdb_id: null });
  if (url.pathname.endsWith("/movie/33"))
    return Response.json({
      id: 33,
      title: "Movie fixture",
      original_title: "Movie fixture",
      overview: "",
      release_date: "2020-01-01",
      poster_path: null,
      original_language: "en",
      imdb_id: null,
      runtime: 90,
    });
  if (url.pathname.endsWith("/tv/44"))
    return Response.json({
      id: 44,
      name: "Series fixture",
      original_name: "Series fixture",
      overview: "",
      first_air_date: "2020-01-01",
      poster_path: null,
      original_language: "en",
      seasons: [
        { id: 45, season_number: 1, episode_count: 1, name: "Season 1" },
      ],
    });
  if (url.pathname.endsWith("/tv/44/season/1"))
    return Response.json({
      episodes: [
        {
          id: 46,
          name: "Episode fixture",
          overview: "",
          season_number: 1,
          episode_number: 1,
          air_date: "2020-01-02",
          runtime: 30,
        },
      ],
    });
  throw new Error("Unexpected catalog endpoint");
}

test("empty catalog discovers exact movie and TVDB-only series, waits for projection and regenerates an immutable combined review", async () => {
  const db = database();
  const actor = await db.mediaUser.create({
    data: {
      role: "owner",
      plexAccountId: "90001",
      displayName: "Owner fixture",
    },
  });
  const ctx = context(catalogResponse);
  const discovery = new MigrationCatalogDiscovery(
    db,
    ctx.tmdb,
    new TmdbCatalogApplication(db, ctx.tmdb),
  );
  const service = new PrismaMigrationAdministration(db, discovery);
  const movie = await service.upload(actor, {
    snapshot: captureFixture("radarr", [
      mediaFixture("1", "movie", { tmdb: 33 }),
    ]),
  });
  const series = await service.upload(actor, {
    snapshot: captureFixture("sonarr", [
      mediaFixture("series:2", "series", { tvdb: 778 }),
      {
        kind: "media",
        sourceId: "episode:3",
        mediaKind: "episode",
        externalIds: {},
        parentSourceId: "series:2",
        season: 1,
        episode: 1,
        profileSourceId: null,
        monitored: true,
      },
      {
        kind: "media",
        sourceId: "episode:4",
        mediaKind: "episode",
        externalIds: {},
        parentSourceId: "series:2",
        season: 9,
        episode: 99,
        profileSourceId: null,
        monitored: true,
      },
    ]),
  });
  expect(movie.report.entries[0]?.confidence).toBe("unknown");
  const captures = [movie.captureId, series.captureId];
  for (const kind of ["bazarr", "qbittorrent", "jellyseerr"] as const) {
    const uploaded = await service.upload(actor, {
      snapshot: captureFixture(kind),
    });
    captures.push(uploaded.captureId);
  }
  const before = await service.bundles.create(actor, { captureIds: captures });
  expect(
    before.report.entries.every((entry) => entry.state === "protected"),
  ).toBe(true);
  expect(
    await service.discover(actor, movie.captureId, {
      captureHash: movie.captureHash,
    }),
  ).toMatchObject({
    entries: [{ status: "ready" }],
    ownershipTransferred: false,
  });
  const tv = await service.discover(actor, series.captureId, {
    captureHash: series.captureHash,
  });
  expect(tv.entries[0]?.status).toBe("catalog_pending");
  const show = await db.mediaItem.findUniqueOrThrow({
    where: { kind_tmdbId: { kind: "series", tmdbId: 44 } },
  });
  const operation = await db.operation.findFirstOrThrow({
    where: { targetId: show.id, kind: "refresh_catalog" },
  });
  const worker = createCatalogActivities(ctx);
  let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const result = await worker.refreshMediaCatalog({
      mediaId: show.id,
      operationId: operation.id,
      cursor,
    });
    cursor = result.nextCursor;
    if (page === 0 && cursor !== null) {
      const pending = await service.bundles.create(actor, {
        captureIds: captures,
      });
      expect(
        pending.report.entries.find((entry) => entry.sourceId === "episode:3")
          ?.state,
      ).toBe("protected");
    }
    if (cursor === null) break;
  }
  const ready = await service.discover(actor, series.captureId, {
    captureHash: series.captureHash,
  });
  expect(ready.entries[0]?.status).toBe("ready");
  const after = await service.bundles.create(actor, {
    captureIds: [...captures].reverse(),
  });
  expect(after.manifest.bundleHash).toBe(before.manifest.bundleHash);
  expect(after.report.reportHash).not.toBe(before.report.reportHash);
  expect(
    after.report.entries.find((entry) => entry.sourceId === "episode:3")?.state,
  ).toBe("adoptable_evidence_ready");
  expect(
    after.report.entries.find((entry) => entry.sourceId === "episode:4")?.state,
  ).toBe("protected");
  const selected = after.report.entries
    .filter((entry) => entry.state === "adoptable_evidence_ready")
    .map((entry) => ({
      provenanceKey: entry.provenanceKey,
      evidenceHash: entry.observationHash,
    }));
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const review = {
    expectedVersion: after.version,
    reportHash: after.report.reportHash,
    bundleHash: after.manifest.bundleHash,
    recoveryEpoch: after.recoveryEpoch,
    runtimeVersion: after.runtimeVersion,
    action: "approve" as const,
    selected,
    acknowledgeNoOwnershipTransfer: true as const,
  };
  expect(
    await service.bundles.review(actor, crypto.randomUUID(), after.id, review),
  ).toMatchObject({ status: "completed", version: 1 });
  expect(
    await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toEqual(runtime);
  expect(await db.mediaRequest.count()).toBe(0);
  expect(await db.libraryAsset.count()).toBe(0);
  await expect(
    db.migrationBundle.update({
      where: { id: after.bundleId },
      data: { manifest: {} },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    service.bundles.review(actor, crypto.randomUUID(), after.id, review),
  ).rejects.toThrow("changed");
});
test("ambiguous TVDB lookup and contradictory external IDs cannot bootstrap catalog identities", async () => {
  const db = database();
  const actor = await db.mediaUser.findFirstOrThrow({
    where: { role: "owner" },
  });
  const ctx = context((url) => {
    if (url.pathname.includes("/find/"))
      return Promise.resolve(
        Response.json({
          movie_results: [],
          tv_results: [{ id: 51 }, { id: 52 }],
        }),
      );
    return Promise.resolve(
      Response.json({
        id: 34,
        title: "Conflict fixture",
        original_title: "Conflict fixture",
        overview: "",
        release_date: "2020-01-01",
        poster_path: null,
        original_language: "en",
        imdb_id: "tt999",
        runtime: 90,
      }),
    );
  });
  const service = new PrismaMigrationAdministration(
    db,
    new MigrationCatalogDiscovery(
      db,
      ctx.tmdb,
      new TmdbCatalogApplication(db, ctx.tmdb),
    ),
  );
  const before = await db.mediaItem.count();
  for (const snapshot of [
    captureFixture("sonarr", [
      mediaFixture("series:8", "series", { tvdb: 999 }),
    ]),
    captureFixture("radarr", [
      {
        ...mediaFixture("9", "movie", { tmdb: 34 }),
        externalIds: { tmdb: 34, imdb: "tt888" },
      },
    ]),
  ]) {
    const uploaded = await service.upload(actor, { snapshot });
    const result = await service.discover(actor, uploaded.captureId, {
      captureHash: uploaded.captureHash,
    });
    expect(result.entries[0]).toMatchObject({
      status: "protected",
      mediaId: null,
    });
  }
  expect(await db.mediaItem.count()).toBe(before);
});
