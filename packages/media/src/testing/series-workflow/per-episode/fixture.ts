import path from "node:path";
import { storedWorkerPath } from "#automation/files/paths/locations.ts";
import {
  configurePerEpisodeCanonicalStorageV1,
  perEpisodeStoredPartV1,
  perEpisodeCanonicalStorageOptionsV1,
  perEpisodeCanonicalStorageGuardV1,
} from "./canonical-storage.ts";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { PlexItem } from "#integrations/plex.ts";
import { handoffFixture } from "#automation/handoff/test-fixture.ts";
import { adoptLibraryBindingSource } from "#automation/plex-binding/library.test-fixture.ts";
import { mediaFixture } from "#migration/bundle-test-fixtures.ts";
import { PrepareLibraryHandoffV2Schema } from "#shared/handoff-v2.ts";
import { managedSeriesWire } from "#testing/series-workflow/wire.ts";
import { createAutomationTestContext } from "#testing/automation.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { LIBRARY_MOVIE_DUE_CURSOR } from "#automation/reconciliation/library-movies.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { persistCandidateSnapshot } from "#automation/candidate-evidence.ts";
import { matchRelease } from "#domain/release-parser.ts";
import { loadProfile } from "#automation/acquisition-candidates.ts";
import { evaluateRelease } from "#domain/quality.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import { perEpisodeInitialSidecarsV1 } from "./initial-sidecars.ts";
import {
  configureImportPlex,
  perEpisodePaths,
  verifyImportedEpisodes,
} from "./import-wire.ts";

/** Two genuine12-file approvals; only remote service transport and local test authority are synthetic. */
export async function createPerEpisodeMultiSeasonFixture(
  db: Database,
  directoryCreated: (directory: string) => void,
  bytes: { original: Uint8Array; upgrade: Uint8Array },
  options: { canonicalStorage?: true; initialCaptionSidecars?: true } = {},
) {
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: `Synthetic Anime ${crypto
        .randomUUID()
        .replaceAll("-", "")
        .replaceAll(/\d/gu, (digit) =>
          String.fromCodePoint(103 + Number(digit)),
        )}`,
      tmdbId: Math.floor(Math.random() * 1_000_000_000),
      year: 2020,
      originalLanguage: "en",
      externalIds: {},
    },
  });
  const episodes = [];
  for (const season of [1, 2]) {
    const parent = await db.mediaItem.create({
      data: {
        kind: "season",
        title: `Season ${String(season)}`,
        parentId: series.id,
        seasonNumber: season,
      },
    });
    for (let episode = 1; episode <= 12; episode++)
      episodes.push(
        await db.mediaItem.create({
          data: {
            kind: "episode",
            title: `Season ${String(season)} Episode ${String(episode)}`,
            parentId: parent.id,
            seasonNumber: season,
            episodeNumber: episode,
            runtimeMinutes: 1,
            originalLanguage: "en",
            externalIds: {},
          },
        }),
      );
  }
  const first = episodes[0];
  if (first === undefined) throw new Error("Actual fixture catalog is empty");
  const label = (season: number, episode: number) =>
    `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  const basename = (season: number, episode: number) =>
    `${series.title}.${label(season, episode)}.mkv`;
  // This utility prepares an unused baseline migration plan. It is never applied,
  // never supplies an ownership receipt and never inserts an AcquisitionAttempt.
  const f = await handoffFixture(db, {
    ...perEpisodeCanonicalStorageOptionsV1(options.canonicalStorage),
    bytes: bytes.original,
    sourceKind: "sonarr",
    fileName: basename(1, 1),
    prepareRequest: ({ request, report }) =>
      PrepareLibraryHandoffV2Schema.parse({
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
      }),
    extendReport: ({ report }) => {
      const root = report.entries.find((entry) => entry.kind === "media");
      const file = report.entries.find(
        (entry) => entry.sourceRecord.kind === "file",
      );
      if (
        root?.sourceRecord.kind !== "media" ||
        file?.sourceRecord.kind !== "file"
      )
        throw new Error("Missing unused fixture setup");
      root.sourceRecord.mediaKind = "series";
      root.sourceRecord.externalIds = { tmdb: z.number().parse(series.tmdbId) };
      root.mediaIds = [series.id];
      file.mediaIds = [first.id];
      file.sourceRecord.mediaSourceIds = ["s1episode:1"];
      return Promise.resolve();
    },
  });
  directoryCreated(f.directory);
  await configurePerEpisodeCanonicalStorageV1(
    f.context.files,
    f.network.actor.id,
    options.canonicalStorage,
  );
  f.context.files.inspect = inspectMedia;
  const physical = episodes.map((episode) => ({
    episode,
    filename: path.join(
      f.context.files.roots.tv.library,
      basename(
        z.number().parse(episode.seasonNumber),
        z.number().parse(episode.episodeNumber),
      ),
    ),
  }));
  for (const item of physical)
    if (item.filename !== f.target)
      await writeFile(item.filename, bytes.original, { flag: "wx" });
  const itemKeyBase = 2_000_000 + (await db.mediaItem.count()) * 100;
  const show: PlexItem = {
    ratingKey: String(itemKeyBase),
    type: "show",
    title: series.title,
    Guid: [{ id: `tmdb://${String(series.tmdbId)}` }],
  };
  const items: PlexItem[] = physical.map(({ episode, filename }, index) => ({
    ratingKey: String(itemKeyBase + 100 + index),
    type: "episode",
    title: episode.title,
    librarySectionID: 2,
    grandparentRatingKey: show.ratingKey,
    parentRatingKey: String(
      itemKeyBase + z.number().parse(episode.seasonNumber),
    ),
    parentIndex: z.number().parse(episode.seasonNumber),
    index: z.number().parse(episode.episodeNumber),
    Media: [
      {
        Part: [
          {
            id: itemKeyBase + 1000 + index,
            file: perEpisodeStoredPartV1(
              f.context.files,
              filename,
              options.canonicalStorage,
            ),
            size: bytes.original.byteLength,
          },
        ],
      },
    ],
  }));
  configureImportPlex(f.network.context.plex, items, show);
  const root = mediaFixture("1", "series", {
    tmdb: z.number().parse(series.tmdbId),
  });
  const receipts = [];
  for (const season of [1, 2]) {
    const selected = physical.filter(
      (item) => item.episode.seasonNumber === season,
    );
    const initialSidecars = await perEpisodeInitialSidecarsV1(
      selected.map(({ episode, filename }) => ({
        filename,
        mediaSourceId: `s${String(season)}episode:${String(episode.episodeNumber)}`,
      })),
      options.initialCaptionSidecars,
    );
    const adopted = await adoptLibraryBindingSource(f, {
      kind: "tv",
      edition: "default",
      qualitySourceId: "5",
      householdCaptions: true,
      ...initialSidecars,
      media: [
        root,
        ...selected.map(({ episode }) => ({
          ...root,
          sourceId: `s${String(season)}episode:${String(episode.episodeNumber)}`,
          mediaKind: "episode" as const,
          externalIds: {},
          parentSourceId: root.sourceId,
          season,
          episode: episode.episodeNumber,
        })),
      ],
      files: selected.map(({ episode, filename }) => ({
        sourceId: `file:${label(season, z.number().parse(episode.episodeNumber))}`,
        targetPath: storedWorkerPath(f.context.files, "tv", filename),
        mediaSourceIds: [
          `s${String(season)}episode:${String(episode.episodeNumber)}`,
        ],
        sizeBytes: bytes.original.byteLength,
      })),
    });
    if (adopted.assets.length !== 12)
      throw new Error("Approval did not adopt12 actual files");
    receipts.push(adopted);
  }
  const ids = episodes.map((episode) => episode.id);
  perEpisodeCanonicalStorageGuardV1(f.context.files, options.canonicalStorage);
  const wire = managedSeriesWire(db, {
    seriesId: series.id,
    mediaIds: ids,
    title: series.title,
    downloads: f.context.files.roots.tv.downloads,
    bytes: bytes.upgrade,
    items,
    show,
    seasonRange: { first: 1, last: 2 },
    members: episodes.map((episode) => ({
      season: z.number().parse(episode.seasonNumber),
      first: z.number().parse(episode.episodeNumber),
      last: z.number().parse(episode.episodeNumber),
      bytes: bytes.upgrade,
    })),
  });
  const context = {
    ...createAutomationTestContext(db, f.network.context.cipher),
    ...wire,
  };
  const files = f.context.files;
  files.pathMapping = perEpisodePaths(files);
  await verifyImportedEpisodes(db, context, receipts);
  await db.mediaProvider.upsert({
    where: { id: "knaben" },
    create: { id: "knaben", enabled: true, seedingPolicy: { kind: "public" } },
    update: { enabled: true },
  });
  let cursor: string | null = null;
  do {
    const page = await createSweepActivities(context).sweepMediaWork({
      kind: "due",
      cursor,
      sweepId: crypto.randomUUID(),
    });
    cursor = page.nextCursor;
  } while (cursor !== null && !cursor.startsWith(LIBRARY_MOVIE_DUE_CURSOR));
  const operation = await db.operation.findFirstOrThrow({
    where: { targetId: first.id, kind: "reconcile_media", userId: null },
    orderBy: { createdAt: "desc" },
  });
  const input = z
    .object({
      operationId: z.uuid(),
      mediaId: z.uuid(),
      generation: z.int().nonnegative(),
    })
    .parse(operation.payload);
  const profile = await loadProfile(db, first.id);
  if (profile === null) throw new Error("Imported actual profile missing");
  const sources = await wire.providers.withProvider("knaben", (client) =>
    client.search({ query: series.title, kind: "tv" }),
  );
  const source = sources[0];
  if (source === undefined || sources.length !== 1)
    throw new Error("Missing actual source observation");
  const literal = matchRelease({
    id: crypto.randomUUID(),
    providerId: source.providerId,
    title: source.title,
    sizeBytes: source.sizeBytes,
    media: {
      id: first.id,
      kind: "episode",
      title: first.title,
      year: null,
      seriesTitle: series.title,
      seriesYear: 2020,
    },
    knownEpisodes: episodes.map((episode) => ({
      mediaId: episode.id,
      season: z.number().parse(episode.seasonNumber),
      episode: z.number().parse(episode.episodeNumber),
    })),
  }).attributes;
  const retained = await persistCandidateSnapshot(context, {
    source,
    attributes: literal,
    evaluation: evaluateRelease(literal, profile, [first.id]),
    searchedForMediaId: first.id,
  });
  if (retained === null)
    throw new Error("Actual retained original source missing");
  return {
    ...f,
    db,
    ids,
    episodes,
    series,
    receipts,
    wire,
    context,
    files,
    input,
    originalAssetIds: receipts.flatMap((receipt) =>
      receipt.assets.map((asset) => asset.id),
    ),
    retainedReleaseId: retained.id,
    acquired: createAcquisitionActivities(context),
    physical: createMediaFileActivities(files),
    publication: createPublicationActivities(context),
  };
}
