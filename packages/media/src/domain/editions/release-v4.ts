import {
  matchRelease,
  type ReleaseMatchInput,
} from "#domain/release-parser.ts";
import type { MovieCutEvidenceV2 } from "#shared/movie-editions/cut-v2.ts";

/** Work identity ignores assessed cut metadata; retained source and cut evidence remain literal. */
export function matchMovieReleaseV4(
  input: ReleaseMatchInput,
  evidence: MovieCutEvidenceV2,
): ReturnType<typeof matchRelease> {
  if (input.media.kind !== "movie")
    throw new Error("Movie v4 matcher requires one canonical movie");
  const title = movieTitleWithoutCutMarkers(input.title, evidence);
  const matched = matchRelease({ ...input, title });
  return {
    ...matched,
    attributes: { ...matched.attributes, title: input.title },
  };
}

export function movieTitleWithoutCutMarkers(
  sourceTitle: string,
  evidence: MovieCutEvidenceV2,
) {
  const primary = evidence.texts[0];
  if (primary?.text !== sourceTitle || evidence.source.kind !== "provider")
    throw new Error("Movie identity assessment lost its exact provider title");
  const markers = primary.markers.toSorted(
    (left, right) => left.start - right.start,
  );
  let offset = 0;
  let title = "";
  for (const marker of markers) {
    if (
      marker.start < offset ||
      marker.end > sourceTitle.length ||
      sourceTitle.slice(marker.start, marker.end) !== marker.token
    )
      throw new Error(
        "Movie identity assessment contains an invalid source span",
      );
    title += `${sourceTitle.slice(offset, marker.start)} `;
    offset = marker.end;
  }
  title += sourceTitle.slice(offset);
  return title;
}
