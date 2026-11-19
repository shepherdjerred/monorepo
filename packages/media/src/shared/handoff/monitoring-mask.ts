import { z } from "zod";

export const LibraryMonitoringMaskSchema = z
  .strictObject({
    seasons: z
      .array(
        z.strictObject({
          season: z.int().nonnegative(),
          monitored: z.boolean(),
        }),
      )
      .max(1000),
    episodes: z
      .array(
        z.strictObject({
          season: z.int().nonnegative(),
          episode: z.int().nonnegative(),
          monitored: z.boolean(),
        }),
      )
      .max(50_000),
  })
  .refine(
    (mask) =>
      new Set(mask.seasons.map((item) => item.season)).size ===
        mask.seasons.length &&
      new Set(
        mask.episodes.map(
          (item) => `${String(item.season)}:${String(item.episode)}`,
        ),
      ).size === mask.episodes.length,
    "Monitoring masks must have distinct coordinates",
  );

export type LibraryMonitoringMask = z.infer<typeof LibraryMonitoringMaskSchema>;

/** Explicit leaf overrides preserve the source's per-episode selections. */
export function libraryEpisodeMonitored(
  policy: {
    includeSpecials: boolean;
    monitoringMask?: LibraryMonitoringMask | undefined;
  },
  season: number,
  episode: number,
) {
  const leaf = policy.monitoringMask?.episodes.find(
    (item) => item.season === season && item.episode === episode,
  );
  if (leaf !== undefined) return leaf.monitored;
  const branch = policy.monitoringMask?.seasons.find(
    (item) => item.season === season,
  );
  return branch?.monitored ?? (season !== 0 || policy.includeSpecials);
}
