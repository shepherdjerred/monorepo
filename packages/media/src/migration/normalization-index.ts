import type { z } from "zod";
import type {
  AdoptionTargetSchema,
  MigrationRecord,
  MigrationSnapshot,
} from "#shared/migration.ts";
export type Target = z.infer<typeof AdoptionTargetSchema>;
type Media = Extract<MigrationRecord, { kind: "media" }>;
export type NormalizationIndex = ReturnType<typeof buildNormalizationIndex>;
export function externalKeys(
  ids: Target["externalIds"],
  kind: string,
  season: number | null,
  episode: number | null,
) {
  return Object.entries(ids).map(
    ([key, value]) =>
      `${kind}:${String(season)}:${String(episode)}:${key}:${String(value)}`,
  );
}
export function buildNormalizationIndex(
  snapshot: MigrationSnapshot,
  targets: readonly Target[],
) {
  const media = new Map<string, Media>();
  const targetIds = new Map(targets.map((target) => [target.mediaId, target]));
  const identities = new Map<string, Target[]>();
  const fileCoverage = new Map<string, number>();
  for (const target of targets) {
    const ids =
      target.kind === "episode"
        ? (target.seriesExternalIds ?? target.externalIds)
        : target.externalIds;
    for (const key of externalKeys(
      ids,
      target.kind,
      target.season,
      target.episode,
    )) {
      const entries = identities.get(key) ?? [];
      entries.push(target);
      identities.set(key, entries);
    }
  }
  for (const record of snapshot.records) {
    if (record.kind === "media") media.set(record.sourceId, record);
    if (record.kind === "file")
      for (const key of [
        `path:${record.path}`,
        ...new Set(record.mediaSourceIds.map((id) => `media:${id}`)),
      ])
        fileCoverage.set(key, (fileCoverage.get(key) ?? 0) + 1);
  }
  return { media, targetIds, identities, fileCoverage };
}
