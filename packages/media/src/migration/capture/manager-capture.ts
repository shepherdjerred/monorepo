import { z } from "zod";
import {
  MAX_MIGRATION_RECORDS,
  MigrationRecordSchema,
  MigrationSnapshotSchema,
  type MigrationRecord,
  type MigrationSnapshot,
} from "#shared/migration.ts";
import { CaptureReader, CaptureReadError } from "./capture-http.ts";
import {
  MovieSchema,
  SeriesSchema,
  EpisodeSchema,
  MovieFileSchema,
  EpisodeFileSchema,
  sourceExternalIds,
} from "./manager-wire.ts";
import { recordDigest, validateCapture } from "./capture-validation.ts";

type Source = {
  source: "radarr" | "sonarr";
  sourceInstanceId: string;
  baseUrl: string;
  apiKey: string;
};
type Pass = {
  records: MigrationRecord[];
  version: string;
  reason: "complete" | "page_limit" | "record_limit" | "read_failed";
  pages: number;
};
function add(records: MigrationRecord[], value: unknown): void {
  if (records.length >= MAX_MIGRATION_RECORDS)
    throw new CaptureReadError("record_limit");
  records.push(MigrationRecordSchema.parse(value));
}
async function movies(reader: CaptureReader, records: MigrationRecord[]) {
  const media = await reader.read(
    "api/v3/movie",
    z.array(MovieSchema).max(MAX_MIGRATION_RECORDS),
  );
  for (const movie of media) {
    add(records, {
      kind: "media",
      sourceId: String(movie.id),
      mediaKind: "movie",
      externalIds: sourceExternalIds(movie),
      parentSourceId: null,
      season: null,
      episode: null,
      profileSourceId: String(movie.qualityProfileId),
      monitored: movie.monitored,
    });
    const files = await reader.read(
      `api/v3/moviefile?movieId=${String(movie.id)}`,
      z.array(MovieFileSchema).max(MAX_MIGRATION_RECORDS),
    );
    for (const file of files) {
      if (file.movieId !== movie.id) throw new CaptureReadError("read_failed");
      add(records, {
        kind: "file",
        sourceId: String(file.id),
        mediaSourceIds: [String(movie.id)],
        path: file.path,
        sizeBytes: file.size,
        checksum: null,
        downloadHash: null,
        qualitySourceId: String(file.quality.quality.id),
      });
    }
  }
}
async function series(reader: CaptureReader, records: MigrationRecord[]) {
  const shows = await reader.read(
    "api/v3/series",
    z.array(SeriesSchema).max(MAX_MIGRATION_RECORDS),
  );
  for (const show of shows) {
    add(records, {
      kind: "media",
      sourceId: `series:${String(show.id)}`,
      mediaKind: "series",
      externalIds: sourceExternalIds(show),
      parentSourceId: null,
      season: null,
      episode: null,
      profileSourceId: String(show.qualityProfileId),
      monitored: show.monitored,
    });
    const episodes = await reader.read(
      `api/v3/episode?seriesId=${String(show.id)}`,
      z.array(EpisodeSchema).max(MAX_MIGRATION_RECORDS),
    );
    for (const episode of episodes) {
      if (episode.seriesId !== show.id)
        throw new CaptureReadError("read_failed");
      add(records, {
        kind: "media",
        sourceId: `episode:${String(episode.id)}`,
        mediaKind: "episode",
        externalIds: {},
        parentSourceId: `series:${String(show.id)}`,
        season: episode.seasonNumber,
        episode: episode.episodeNumber,
        profileSourceId: String(show.qualityProfileId),
        monitored: episode.monitored,
      });
    }
    const files = await reader.read(
      `api/v3/episodefile?seriesId=${String(show.id)}`,
      z.array(EpisodeFileSchema).max(MAX_MIGRATION_RECORDS),
    );
    for (const file of files) {
      if (file.seriesId !== show.id) throw new CaptureReadError("read_failed");
      add(records, {
        kind: "file",
        sourceId: String(file.id),
        mediaSourceIds: episodes
          .filter((episode) => episode.episodeFileId === file.id)
          .map((episode) => `episode:${String(episode.id)}`),
        path: file.path,
        sizeBytes: file.size,
        checksum: null,
        downloadHash: null,
        qualitySourceId: String(file.quality.quality.id),
      });
    }
  }
}
async function pass(source: Source, fetcher: typeof fetch): Promise<Pass> {
  const reader = new CaptureReader(source, fetcher);
  const records: MigrationRecord[] = [];
  let version = "unknown";
  try {
    const status = await reader.read(
      "api/v3/system/status",
      z.object({ version: MigrationSnapshotSchema.shape.sourceVersion }),
    );
    version = status.version;
    if (source.source === "radarr") await movies(reader, records);
    else await series(reader, records);
    return { version, records, pages: reader.pages, reason: "complete" };
  } catch (error) {
    return {
      version,
      records,
      pages: reader.pages,
      reason: error instanceof CaptureReadError ? error.reason : "read_failed",
    };
  }
}
/** Bounded GET-only inventory. Repeated normalized observations establish stability; neither pass changes a manager. */
export async function captureManager(
  source: Source,
  fetcher: typeof fetch = fetch,
): Promise<MigrationSnapshot> {
  const startedAt = new Date().toISOString();
  const first = await pass(source, fetcher);
  const second = await pass(source, fetcher);
  const complete = first.reason === "complete" && second.reason === "complete";
  const stable =
    complete &&
    first.version === second.version &&
    recordDigest(first.records) === recordDigest(second.records);
  const reason = complete
    ? stable
      ? "complete"
      : "source_changed"
    : first.reason === "complete"
      ? second.reason
      : first.reason;
  const records = second.records;
  const snapshot = MigrationSnapshotSchema.parse({
    schemaVersion: 1,
    sourceKind: source.source,
    sourceInstanceId: source.sourceInstanceId,
    sourceVersion: second.version,
    startedAt,
    completedAt: new Date().toISOString(),
    records,
    endpoints: (["media", "files"] as const).map((name, index) => {
      const subset = records.filter(
        (record) => record.kind === (name === "files" ? "file" : "media"),
      );
      return {
        name,
        pages: index === 0 ? first.pages + second.pages : 0,
        records: subset.length,
        digest: recordDigest(subset),
        complete: complete && stable,
        stable,
        reason,
      };
    }),
  });
  return validateCapture(snapshot).snapshot;
}
