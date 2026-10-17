import { z } from "zod";

const Id = z.number().int().positive();
const Quality = z.object({
  quality: z.object({ id: z.number().int().nonnegative() }),
});
export const MovieSchema = z.object({
  id: Id,
  tmdbId: Id,
  imdbId: z.string().optional(),
  qualityProfileId: Id,
  monitored: z.boolean(),
});
export const SeriesSchema = z.object({
  id: Id,
  tvdbId: Id,
  tmdbId: z.number().int().nonnegative().optional(),
  imdbId: z.string().optional(),
  qualityProfileId: Id,
  monitored: z.boolean(),
});
export const EpisodeSchema = z.object({
  id: Id,
  seriesId: Id,
  seasonNumber: z.number().int().nonnegative(),
  episodeNumber: z.number().int().nonnegative(),
  episodeFileId: z.number().int().nonnegative(),
  monitored: z.boolean(),
});
export const MovieFileSchema = z.object({
  id: Id,
  movieId: Id,
  path: z.string(),
  size: z.number().int().nonnegative(),
  quality: Quality,
});
export const EpisodeFileSchema = z.object({
  id: Id,
  seriesId: Id,
  path: z.string(),
  size: z.number().int().nonnegative(),
  quality: Quality,
});

export function sourceExternalIds(source: {
  tmdbId?: number | undefined;
  tvdbId?: number | undefined;
  imdbId?: string | undefined;
}) {
  return {
    ...(source.tmdbId !== undefined && source.tmdbId > 0
      ? { tmdb: source.tmdbId }
      : {}),
    ...(source.tvdbId !== undefined && source.tvdbId > 0
      ? { tvdb: source.tvdbId }
      : {}),
    ...(source.imdbId !== undefined && /^tt\d+$/u.test(source.imdbId)
      ? { imdb: source.imdbId }
      : {}),
  };
}
