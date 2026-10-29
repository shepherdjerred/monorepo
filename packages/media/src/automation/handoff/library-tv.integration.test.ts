import { afterAll, beforeAll, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import { PrepareLibraryHandoffV2Schema } from "#shared/handoff-v2.ts";
import { handoffFixture } from "./test-fixture.ts";
import { applyPreparedHandoff } from "./apply.ts";
import { loadLibraryAssetParentV1 } from "#infrastructure/handoff/library-asset.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let bytes: Uint8Array;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  bytes = await movieVideoFixture();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function fixture(wrongEpisode = false) {
  const seriesId = crypto.randomUUID();
  const seasonId = crypto.randomUUID();
  const episodeIds = [crypto.randomUUID(), crypto.randomUUID()];
  const tmdbId = Math.floor(Math.random() * 1_000_000_000);
  const f = await handoffFixture(cluster.database, {
    sourceKind: "sonarr",
    fileName: "Synthetic Anime.S01E01-E02.1080p.mkv",
    bytes,
    async extendReport({ report, target }) {
      directories.push(target.slice(0, target.lastIndexOf("/tv/")));
      await cluster.database.mediaItem.create({
        data: {
          id: seriesId,
          kind: "series",
          title: "Synthetic Anime",
          tmdbId,
          externalIds: {},
        },
      });
      await cluster.database.mediaItem.create({
        data: {
          id: seasonId,
          kind: "season",
          title: "Season 1",
          parentId: seriesId,
          seasonNumber: 1,
          externalIds: {},
        },
      });
      for (const [index, id] of episodeIds.entries())
        await cluster.database.mediaItem.create({
          data: {
            id,
            kind: "episode",
            title: `Episode ${String(index + 1)}`,
            parentId: seasonId,
            seasonNumber: 1,
            episodeNumber: index + 1,
            externalIds: {},
          },
        });
      const media = report.entries.find(
        (entry) => entry.sourceRecord.kind === "media",
      );
      const file = report.entries.find(
        (entry) => entry.sourceRecord.kind === "file",
      );
      if (
        media?.sourceRecord.kind !== "media" ||
        file?.sourceRecord.kind !== "file"
      )
        throw new Error("Source report fixture missing");
      media.mediaIds = [seriesId];
      media.mappedMedia = [{ mediaId: seriesId, title: "Synthetic Anime" }];
      media.sourceRecord.mediaKind = "series";
      media.sourceRecord.externalIds = { tmdb: tmdbId };
      file.mediaIds = episodeIds;
      file.mappedMedia = episodeIds.map((id, index) => ({
        mediaId: id,
        title: `Episode ${String(index + 1)}`,
      }));
      file.sourceRecord.mediaSourceIds = ["episode1", "episode2"];
    },
    prepareRequest({ request, report }) {
      return PrepareLibraryHandoffV2Schema.parse({
        ...request,
        schemaVersion: 2,
        purpose: "migration",
        movies: [],
        selected: report.entries
          .filter((entry) => entry.kind === "file")
          .map((entry) => ({
            provenanceKey: entry.provenanceKey,
            evidenceHash: entry.observationHash,
          })),
      });
    },
  });
  f.context.files.inspect = inspectMedia;
  const items = episodeIds.map((_id, index) => ({
    ratingKey: `episode${String(index + 1)}`,
    type: "episode",
    title: `Episode ${String(index + 1)}`,
    librarySectionID: 2,
    grandparentRatingKey: "series",
    parentIndex: 1,
    index: wrongEpisode && index === 1 ? 4 : index + 1,
    Media: [
      { Part: [{ id: index + 11, file: f.target, size: bytes.byteLength }] },
    ],
  }));
  f.network.context.plex.sections = () =>
    Promise.resolve([{ key: "2", type: "show", title: "Anime" }]);
  f.network.context.plex.libraryPage = () =>
    Promise.resolve({ total: 2, items });
  f.network.context.plex.metadata = (key) => {
    if (key === "series")
      return Promise.resolve({
        ratingKey: key,
        title: "Synthetic Anime",
        type: "show",
        Guid: [{ id: `tmdb://${String(tmdbId)}` }],
      });
    const item = items.find((entry) => entry.ratingKey === key);
    if (item === undefined) throw new Error("Unexpected Plex fixture lookup");
    return Promise.resolve(item);
  };
  return { ...f, seriesId, episodeIds };
}

test("initial TV/anime adoption preserves one physical pack, both exact episode mappings and their Plex identities", async () => {
  const f = await fixture();
  const ready = await f.ready();
  await applyPreparedHandoff(f.context, ready.input, ready.prepared);
  const asset = await cluster.database.libraryAsset.findUniqueOrThrow({
    where: { path: f.target },
    include: { coverage: true },
  });
  expect(asset).toMatchObject({
    edition: "default",
    editionRootId: f.seriesId,
    owned: true,
    torrentId: null,
    path: f.target,
  });
  expect(asset.coverage.map((row) => row.mediaId).sort()).toEqual(
    [...f.episodeIds].sort(),
  );
  expect(await readFile(f.target)).toEqual(Buffer.from(bytes));
  const receipt = await cluster.database.mediaHandoffReceipt.findUniqueOrThrow({
    where: { planId: f.planId },
  });
  const selection = z
    .object({
      schemaVersion: z.literal(2),
      assets: z.array(z.object({ id: z.string() })),
      networkEvidence: z.object({
        plex: z.array(
          z.object({
            mediaId: z.string(),
            ratingKey: z.string(),
            partId: z.number(),
          }),
        ),
      }),
    })
    .parse(receipt.selection);
  expect(selection.assets).toHaveLength(1);
  expect(selection.assets[0]?.id).toBe(asset.id);
  const parent = await loadLibraryAssetParentV1(
    cluster.database,
    { receiptId: receipt.id, assetId: asset.id },
    new PublicationAuthorityReadBudget(),
  );
  expect(parent.reference).toMatchObject({
    kind: "library_adoption_v1",
    receiptId: receipt.id,
    assetId: asset.id,
    assetVersion: 0,
  });
  expect(parent.asset.coverage.map((item) => item.mediaId).sort()).toEqual(
    [...f.episodeIds].sort(),
  );
  expect(selection.networkEvidence.plex).toEqual(
    f.episodeIds.map((id, index) =>
      expect.objectContaining({
        mediaId: id,
        ratingKey: `episode${String(index + 1)}`,
        partId: index + 11,
      }),
    ),
  );
  expect(
    await cluster.database.mediaRequest.count({
      where: { mediaId: { in: f.episodeIds } },
    }),
  ).toBe(0);
});

test("a Plex episode coordinate conflict prevents adoption of the whole shared file", async () => {
  const f = await fixture(true);
  await expect(f.ready()).rejects.toMatchObject({
    code: "handoff_plex_identity_unproved",
  });
  expect(
    await cluster.database.libraryAsset.findUnique({
      where: { path: f.target },
    }),
  ).toBeNull();
  expect(await readFile(f.target)).toEqual(Buffer.from(bytes));
});
