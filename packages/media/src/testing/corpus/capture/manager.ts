import { z } from "zod";
import type { FetchTransport } from "#integrations/http.ts";
import { CaptureReader } from "#migration/capture/capture-http.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { InventorySource } from "#migration/source-inventory.ts";
import { MAX_MIGRATION_RECORDS } from "#shared/migration.ts";
import {
  captureStage,
  PrivateCaptureError,
  type CaptureEndpoint,
} from "./diagnostics.ts";
import {
  CapturedMovieSchema,
  CapturedSeriesSchema,
  CapturedEpisodeSchema,
  CapturedMovieFileSchema,
  CapturedEpisodeFileSchema,
  InstalledCaptureSchema,
  type InstalledCapture,
} from "./contract.ts";

function uniqueIds(rows: readonly { id: number }[]) {
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error("Installed capture contains duplicate IDs");
}
function boundedCount(...rows: readonly unknown[][]) {
  if (
    rows.reduce((count, group) => count + group.length, 0) >
    MAX_MIGRATION_RECORDS
  )
    throw new Error("Installed capture record limit exceeded");
}
async function pass(
  source: InventorySource,
  transport: FetchTransport,
  stage: "installed_first" | "installed_second",
): Promise<InstalledCapture> {
  const reader = new CaptureReader(source, transport);
  const read = <T>(
    endpoint: CaptureEndpoint,
    schema: z.ZodType<T>,
    query = "",
  ) =>
    captureStage({ source: source.source, stage, endpoint }, async () =>
      schema.parse(await reader.read(`api/v3/${endpoint}${query}`, z.json())),
    );
  const status = await read(
    "system/status",
    z.object({ version: z.string().min(1).max(4096) }),
  );
  if (source.source === "radarr") {
    const movies = await read(
      "movie",
      z.array(CapturedMovieSchema).max(MAX_MIGRATION_RECORDS),
    );
    uniqueIds(movies);
    const files: z.infer<typeof CapturedMovieFileSchema>[] = [];
    for (const movie of movies.toSorted((a, b) => a.id - b.id)) {
      const selected = await read(
        "moviefile",
        z.array(CapturedMovieFileSchema).max(MAX_MIGRATION_RECORDS),
        `?movieId=${String(movie.id)}`,
      );
      if (selected.some((file) => file.movieId !== movie.id))
        throw new Error("Installed movie file parent changed");
      files.push(...selected);
      boundedCount(movies, files);
    }
    uniqueIds(files);
    return InstalledCaptureSchema.parse({
      schemaVersion: 2,
      privacyOmissions: [],
      source: source.source,
      sourceVersion: status.version,
      movies: movies.toSorted((a, b) => a.id - b.id),
      files: files.toSorted((a, b) => a.id - b.id),
    });
  }
  const series = await read(
    "series",
    z.array(CapturedSeriesSchema).max(MAX_MIGRATION_RECORDS),
  );
  uniqueIds(series);
  const episodes: z.infer<typeof CapturedEpisodeSchema>[] = [];
  const files: z.infer<typeof CapturedEpisodeFileSchema>[] = [];
  for (const show of series.toSorted((a, b) => a.id - b.id)) {
    const selectedEpisodes = await read(
      "episode",
      z.array(CapturedEpisodeSchema).max(MAX_MIGRATION_RECORDS),
      `?seriesId=${String(show.id)}`,
    );
    const selectedFiles = await read(
      "episodefile",
      z.array(CapturedEpisodeFileSchema).max(MAX_MIGRATION_RECORDS),
      `?seriesId=${String(show.id)}`,
    );
    if (
      selectedEpisodes.some((episode) => episode.seriesId !== show.id) ||
      selectedFiles.some((file) => file.seriesId !== show.id)
    )
      throw new Error("Installed series parent changed");
    const fileIds = new Set(selectedFiles.map((file) => file.id));
    if (
      selectedEpisodes.some(
        (episode) =>
          episode.episodeFileId !== 0 && !fileIds.has(episode.episodeFileId),
      )
    )
      throw new Error("Installed episode file missing");
    episodes.push(...selectedEpisodes);
    files.push(...selectedFiles);
    boundedCount(series, episodes, files);
  }
  uniqueIds(episodes);
  uniqueIds(files);
  return InstalledCaptureSchema.parse({
    schemaVersion: 2,
    privacyOmissions: [],
    source: source.source,
    sourceVersion: status.version,
    series: series.toSorted((a, b) => a.id - b.id),
    episodes: episodes.toSorted((a, b) => a.id - b.id),
    files: files.toSorted((a, b) => a.id - b.id),
  });
}

/** GET-only two-pass capture. Unknown wire fields are stripped before comparison or persistence. */
export async function captureInstalledCatalog(
  source: InventorySource,
  transport: FetchTransport = fetch,
) {
  const first = await captureStage(
    { source: source.source, stage: "installed_first" },
    () => pass(source, transport, "installed_first"),
  );
  const second = await captureStage(
    { source: source.source, stage: "installed_second" },
    () => pass(source, transport, "installed_second"),
  );
  if (
    snapshotHash(z.json().parse(first)) !== snapshotHash(z.json().parse(second))
  )
    throw new PrivateCaptureError({
      source: source.source,
      stage: "coherence",
      reason: "changed",
    });
  return second;
}
