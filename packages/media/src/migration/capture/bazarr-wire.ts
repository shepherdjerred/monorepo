import { z } from "zod";
import { SubtitleSourceProfileSchema } from "#shared/migration-subtitles.ts";
import { snapshotHash } from "#migration/profile-import.ts";

export const BazarrProfileWire = z.object({
  ...SubtitleSourceProfileSchema.omit({
    constraintHash: true,
    hasConstraints: true,
  }).shape,
  mustContain: z.array(z.string().max(500)).max(100),
  mustNotContain: z.array(z.string().max(500)).max(100),
});
export const BazarrSubtitleWire = z.object({
  id: z.number().int().positive(),
  path: z.string().nullable(),
  code2: z.string().nullable(),
  code3: z.string().nullable(),
  forced: z.boolean().nullable(),
  hi: z.boolean().nullable(),
  embedded_track_id: z.number().int().nonnegative().nullable(),
});
export const BazarrMovieWire = z.object({
  path: z.string().nullable().optional(),
  radarrId: z.number().int().positive(),
  profileId: z.number().int().positive().nullable(),
  subtitles: z.array(BazarrSubtitleWire).max(1000),
});
export const BazarrSeriesWire = z.object({
  sonarrSeriesId: z.number().int().positive(),
  profileId: z.number().int().positive().nullable(),
});
export const BazarrEpisodeWire = z.object({
  path: z.string().nullable().optional(),
  sonarrSeriesId: z.number().int().positive(),
  sonarrEpisodeId: z.number().int().positive(),
  subtitles: z.array(BazarrSubtitleWire).max(1000),
});
export function sourceProfile(profile: z.infer<typeof BazarrProfileWire>) {
  const { mustContain, mustNotContain, ...fields } = profile;
  return {
    ...fields,
    constraintHash: snapshotHash([mustContain, mustNotContain]),
    hasConstraints: mustContain.length + mustNotContain.length > 0,
  };
}
