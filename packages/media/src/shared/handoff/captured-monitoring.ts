import type { MigrationRecord } from "#shared/migration.ts";
import { LibraryMonitoringMaskSchema } from "./monitoring-mask.ts";

/** Exact raw Sonarr coordinates, including disabled seasons and explicit leaves. */
export function capturedSeriesMask(
  records: readonly MigrationRecord[],
  sourceId: string,
) {
  const source = records.find(
    (record) =>
      record.kind === "media" &&
      record.mediaKind === "series" &&
      record.sourceId === sourceId,
  );
  if (source?.kind !== "media")
    throw new Error("Captured monitoring series is unavailable");
  const seasons = records.flatMap((record) =>
    record.kind === "media" &&
    record.mediaKind === "season" &&
    record.parentSourceId === source.sourceId &&
    record.season !== null
      ? [{ season: record.season, monitored: record.monitored }]
      : [],
  );
  const episodes = records.flatMap((record) =>
    record.kind === "media" &&
    record.mediaKind === "episode" &&
    record.parentSourceId === source.sourceId &&
    record.season !== null &&
    record.episode !== null
      ? [
          {
            season: record.season,
            episode: record.episode,
            monitored: record.monitored,
          },
        ]
      : [],
  );
  if (seasons.length === 0)
    throw new Error(
      "Recapture Sonarr season masks before approving future monitoring",
    );
  return LibraryMonitoringMaskSchema.parse({
    seasons: seasons.sort((a, b) => a.season - b.season),
    episodes: episodes.sort(
      (a, b) => a.season - b.season || a.episode - b.episode,
    ),
  });
}
