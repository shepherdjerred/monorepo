import type { ResolvedProfile } from "#domain/resolved-contract.ts";
import type { MovieCutEvidenceV2 } from "#shared/movie-editions/cut-v2.ts";
import { ResolvedEvidenceSchema } from "#domain/resolved-evidence.ts";
import { movieTitleWithoutCutMarkers } from "#domain/editions/release-v4.ts";
import {
  prepareResolvedEvidence,
  type EvidenceInput,
} from "#migration/runtime-evidence.ts";

/** Versioned movie parsing: only assessed cut spans are removed for quality grammar. */
export function prepareResolvedMovieEvidenceV4(
  profile: ResolvedProfile,
  input: EvidenceInput,
  cut: MovieCutEvidenceV2,
) {
  const evidence = prepareResolvedEvidence(profile, {
    ...input,
    title: movieTitleWithoutCutMarkers(input.title, cut),
  });
  const spans = cut.texts[0]?.canonicalSpans;
  const name = spans?.[0];
  const base = input.title.replace(/\.(?:mkv|mp4|avi|m4v)$/iu, "");
  if (evidence.protectedReasons.length > 0) return evidence;
  if (
    profile.source !== "radarr" ||
    spans?.length !== 1 ||
    name?.start !== 0 ||
    name.end > base.length
  )
    return ResolvedEvidenceSchema.parse({
      ...evidence,
      parserVersion: "scene-movie-v4",
      protectedReasons: ["movie_resolved_title_unsupported"],
    });
  // ReleaseTitleSpecification matches SimpleReleaseTitle, retaining cut tokens.
  // https://raw.githubusercontent.com/Radarr/Radarr/v6.4.4.10685/src/NzbDrone.Core/CustomFormats/Specifications/ReleaseTitleSpecification.cs
  const simple = `${base.slice(0, name.end).includes(".") ? "A.Movie" : "A Movie"}${base.slice(name.end)}`;
  return ResolvedEvidenceSchema.parse({
    ...evidence,
    parserVersion: "scene-movie-v4",
    release: { ...evidence.release, releaseTitle: simple },
  });
}
