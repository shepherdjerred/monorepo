import type { OpenSubtitlesProvider } from "#integrations/subtitle-providers.ts";
import type { SubtitleSearch } from "#domain/subtitle-maintenance/provider.ts";
type Features = Awaited<
  ReturnType<OpenSubtitlesProvider["search"]>
>["candidates"][number]["attributes"]["feature_details"];

export function openSubtitlesCatalogEvidenceV1(
  input: SubtitleSearch,
  details: Features,
) {
  if (details === undefined || input.scoreReferenceV1 === undefined) return {};
  const movie = input.scoreReferenceV1.kind === "movie";
  const imdb = movie ? details.imdb_id : details.parent_imdb_id;
  return {
    catalogEvidenceV1: {
      kind: movie ? ("movie" as const) : ("series" as const),
      imdbId: imdb == null ? null : `tt${String(imdb)}`,
      tmdbId: movie ? (details.tmdb_id ?? null) : null,
      season: details.season_number ?? null,
      episode: details.episode_number ?? null,
    },
  };
}

export function openSubtitlesCanonicalQueryV1(input: SubtitleSearch) {
  const reference = input.scoreReferenceV1;
  if (reference?.imdbId == null) return {};
  return reference.kind === "movie"
    ? { imdbId: reference.imdbId }
    : { parentImdbId: reference.imdbId };
}

export function openSubtitlesSearchInputV1(input: SubtitleSearch) {
  return {
    query: input.query,
    language: ["zh-Hans", "zh-CN"].includes(input.language)
      ? "zh-cn"
      : input.language,
    ...openSubtitlesCanonicalQueryV1(input),
    ...(input.forced === undefined ? {} : { forced: input.forced }),
    ...(input.hearingImpaired === undefined
      ? {}
      : { hearingImpaired: input.hearingImpaired }),
    ...(input.season === undefined ? {} : { season: input.season }),
    ...(input.episode === undefined ? {} : { episode: input.episode }),
  };
}
