import type { Database } from "#infrastructure/database.ts";
import type { MediaItem } from "#generated/prisma/client.ts";
import { handoffFixture } from "#automation/handoff/test-fixture.ts";
import { mediaFixture } from "#migration/bundle-test-fixtures.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { PrepareLibraryHandoffV2Schema } from "#shared/handoff-v2.ts";
import { createAutomationTestContext } from "#testing/automation.ts";
import { adoptLibraryBindingSource } from "./library.test-fixture.ts";
import { tvBindingContext } from "./tv.test-fixture.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";

export async function libraryTvBindingFixture(
  db: Database,
  directoryCreated: (directory: string) => void,
  options: {
    bytes?: Uint8Array;
    qualitySourceId?: string;
    title?: string;
    monitorSeries?: { includeSpecials: boolean };
  } = {},
) {
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: options.title ?? "Synthetic Anime",
      tmdbId: Math.floor(Math.random() * 1_000_000_000),
      externalIds: {},
    },
  });
  const episodes: MediaItem[] = [];
  for (const episode of [1, 2])
    episodes.push(
      await db.mediaItem.create({
        data: {
          kind: "episode",
          title: `Episode ${String(episode)}`,
          parentId: series.id,
          seasonNumber: 1,
          episodeNumber: episode,
          externalIds: {},
        },
      }),
    );
  const f = await handoffFixture(db, {
    ...(options.bytes === undefined ? {} : { bytes: options.bytes }),
    sourceKind: "sonarr",
    fileName: `${series.title}.S01E01-E02.mkv`,
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
    extendReport({ report }) {
      const media = report.entries.find((entry) => entry.kind === "media");
      const file = report.entries.find(
        (entry) => entry.sourceRecord.kind === "file",
      );
      if (
        media?.sourceRecord.kind !== "media" ||
        file?.sourceRecord.kind !== "file"
      )
        throw new Error("Expected unused fixture baseline");
      media.sourceRecord.mediaKind = "series";
      media.sourceRecord.externalIds = { tmdb: Number(series.tmdbId) };
      media.mediaIds = [series.id];
      file.mediaIds = episodes.map((episode) => episode.id);
      file.sourceRecord.mediaSourceIds = ["episode:1", "episode:2"];
      return Promise.resolve();
    },
  });
  directoryCreated(f.directory);
  if (options.bytes !== undefined) f.context.files.inspect = inspectMedia;
  const items = episodes.map((episode, index) => ({
    ratingKey: String(900_002 + index),
    type: "episode",
    title: episode.title,
    librarySectionID: 2,
    grandparentRatingKey: "900000",
    parentRatingKey: "900001",
    parentIndex: 1,
    index: index + 1,
    Media: [
      {
        Part: [
          {
            id: 900_002 + index,
            file: f.target,
            size: Buffer.byteLength(f.bytes),
          },
        ],
      },
    ],
  }));
  f.network.context.plex.sections = () =>
    Promise.resolve([{ key: "2", type: "show", title: "Anime" }]);
  f.network.context.plex.libraryPage = () =>
    Promise.resolve({ total: items.length, items });
  f.network.context.plex.metadata = (key) => {
    if (key === "900000")
      return Promise.resolve({
        ratingKey: key,
        type: "show",
        title: series.title,
        Guid: [{ id: `tmdb://${String(series.tmdbId)}` }],
      });
    const item = items.find((candidate) => candidate.ratingKey === key);
    if (item === undefined)
      throw new Error("Unexpected initial TV metadata read");
    return Promise.resolve(item);
  };
  const root = mediaFixture("1", "series", { tmdb: Number(series.tmdbId) });
  const media: Extract<MigrationRecord, { kind: "media" }>[] = [
    root,
    ...episodes.map((episode, index) => ({
      ...root,
      sourceId: `episode:${String(index + 1)}`,
      mediaKind: "episode" as const,
      externalIds: {},
      parentSourceId: root.sourceId,
      season: 1,
      episode: episode.episodeNumber,
    })),
  ];
  const adopted = await adoptLibraryBindingSource(f, {
    kind: "tv",
    edition: "default",
    media,
    ...(options.monitorSeries === undefined
      ? {}
      : {
          monitorSeries: {
            seriesId: series.id,
            includeSpecials: options.monitorSeries.includeSpecials,
          },
        }),
    ...(options.qualitySourceId === undefined
      ? {}
      : { qualitySourceId: options.qualitySourceId }),
  });
  const wire = await tvBindingContext(
    db,
    createAutomationTestContext(db, f.network.context.cipher),
    episodes.map((episode) => episode.id),
    { ratingKeyBase: 1_000_000 + (await db.mediaItem.count()) * 100 },
  );
  return {
    ...f,
    handoff: f,
    ...adopted,
    files: f.context.files,
    wire,
    context: wire.context,
    series,
    episodes,
  };
}
