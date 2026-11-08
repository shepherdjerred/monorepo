import type {
  CoordinateResolution,
  CoordinateSnapshot,
  EpisodeCoordinateEvidence,
  EpisodeCoordinateForm,
} from "#shared/acquisition/coordinates.ts";

/** Full-series duplicate checks and digest verification belong to the snapshot producer. */
export function resolveEpisodeCoordinates(
  evidence: EpisodeCoordinateEvidence,
  snapshot: CoordinateSnapshot,
): CoordinateResolution {
  if (evidence.invalid)
    return { status: "protected", reason: "coordinate_invalid" };
  if (snapshot.episodes.length > 100)
    return { status: "protected", reason: "coverage_limit" };
  if (
    snapshot.episodes.some((episode) => episode.seriesId !== snapshot.seriesId)
  )
    return { status: "protected", reason: "coverage_unreserved" };
  if (
    new Set(snapshot.episodes.map((episode) => episode.mediaId)).size !==
    snapshot.episodes.length
  )
    return { status: "protected", reason: "coordinate_duplicate" };
  const forms = evidence.forms;
  if (forms.length === 0 || forms.some((form) => form.kind === "unknown"))
    return { status: "protected", reason: "coordinate_unknown" };
  let resolved: string[] | null = null;
  for (const form of forms) {
    const result = resolveForm(form, snapshot);
    if (result.status === "protected") return result;
    const previous = resolved;
    if (
      previous !== null &&
      (result.mediaIds.length !== previous.length ||
        result.mediaIds.some((id) => !previous.includes(id)))
    )
      return { status: "protected", reason: "coordinate_conflict" };
    resolved = result.mediaIds;
  }
  return resolved === null
    ? { status: "protected", reason: "coordinate_unknown" }
    : { status: "resolved", mediaIds: resolved };
}

function resolveForm(
  form: EpisodeCoordinateForm,
  snapshot: CoordinateSnapshot,
): CoordinateResolution {
  if (form.kind === "unknown")
    return { status: "protected", reason: "coordinate_unknown" };
  if (form.kind === "season_pack") return resolvePack(form.season, snapshot);
  if (
    form.episodes.length === 0 ||
    new Set(form.episodes).size !== form.episodes.length
  )
    return { status: "protected", reason: "coordinate_invalid" };
  if (form.episodes.length > 100)
    return { status: "protected", reason: "coverage_limit" };
  const mediaIds: string[] = [];
  for (const number of form.episodes) {
    const matches = snapshot.episodes.filter((episode) =>
      form.kind === "absolute"
        ? episode.absoluteNumber === number
        : episode.seasonNumber === form.season &&
          episode.episodeNumber === number,
    );
    if (matches.length !== 1)
      return {
        status: "protected",
        reason:
          matches.length === 0 ? "coordinate_unmapped" : "coordinate_duplicate",
      };
    const match = matches[0];
    if (match === undefined) throw new Error("Coordinate match disappeared");
    mediaIds.push(match.mediaId);
  }
  return { status: "resolved", mediaIds };
}

function resolvePack(
  season: number,
  snapshot: CoordinateSnapshot,
): CoordinateResolution {
  const episodes = snapshot.episodes.filter(
    (episode) => episode.seasonNumber === season,
  );
  if (
    new Set(episodes.map((episode) => episode.episodeNumber)).size !==
    episodes.length
  )
    return { status: "protected", reason: "coordinate_duplicate" };
  return episodes.length === 0
    ? { status: "protected", reason: "coordinate_unmapped" }
    : {
        status: "resolved",
        mediaIds: episodes.map((episode) => episode.mediaId),
      };
}
