import {
  MigrationSnapshotSchema,
  type MigrationSnapshot,
  type MigrationRecord,
} from "#shared/migration.ts";
import {
  ENDPOINT_KINDS,
  recordDigest,
} from "#migration/capture/capture-validation.ts";
export function captureFixture(
  kind: MigrationSnapshot["sourceKind"],
  records: MigrationRecord[] = [],
) {
  const names =
    kind === "radarr" || kind === "sonarr"
      ? (["media", "files"] as const)
      : kind === "bazarr"
        ? (["subtitle_preferences", "subtitles"] as const)
        : kind === "qbittorrent"
          ? (["torrents"] as const)
          : (["requests"] as const);
  return MigrationSnapshotSchema.parse({
    schemaVersion: 1,
    sourceKind: kind,
    sourceInstanceId: crypto.randomUUID().replaceAll("-", "").repeat(2),
    sourceVersion: "1.0.0",
    startedAt: "2026-10-17T01:00:00Z",
    completedAt: "2026-10-17T01:01:00Z",
    records,
    endpoints: names.map((name) => {
      const subset = records.filter(
        (record) => record.kind === ENDPOINT_KINDS[name],
      );
      return {
        name,
        pages: 1,
        records: subset.length,
        digest: recordDigest(subset),
        complete: true,
        stable: true,
        reason: "complete",
      };
    }),
  });
}
export function mediaFixture(
  sourceId: string,
  kind: "movie" | "series",
  ids: { tmdb?: number; tvdb?: number },
): Extract<MigrationRecord, { kind: "media" }> {
  return {
    kind: "media",
    sourceId,
    mediaKind: kind,
    externalIds: ids,
    parentSourceId: null,
    season: null,
    episode: null,
    profileSourceId: null,
    monitored: true,
  };
}
