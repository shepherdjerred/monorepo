import type { SeriesSeasonSetV1 } from "#shared/acquisition/series-pack-v1.ts";
import type { CoordinateSnapshot } from "#shared/acquisition/coordinates.ts";
import { parseEpisodeCoordinates } from "./parser.ts";

type Parsed =
  | { status: "not_applicable" }
  | {
      status: "protected";
      reason:
        | "season_set_invalid"
        | "season_set_conflict"
        | "season_set_incomplete"
        | "coverage_limit";
    }
  | { status: "resolved"; range: SeriesSeasonSetV1 };

/** One explicit S01-S02 range is a set; independent numbering tokens still must agree. */
export function parseSeriesSeasonSetV1(title: string): Parsed {
  const matches = [
    ...title.matchAll(/\bS(?<start>\d{1,3})[ ._]*-[ ._]*S(?<end>\d{1,3})\b/giu),
  ];
  if (matches.length === 0) return { status: "not_applicable" };
  if (matches.length !== 1 || title.length > 4096)
    return { status: "protected", reason: "season_set_invalid" };
  const match = matches[0];
  if (match === undefined) throw new Error("Season range disappeared");
  const start = Number(match.groups?.["start"]),
    end = Number(match.groups?.["end"]);
  if (start < 1 || end <= start)
    return { status: "protected", reason: "season_set_invalid" };
  if (end - start >= 100)
    return { status: "protected", reason: "coverage_limit" };
  const outside =
    title.slice(0, match.index) + title.slice(match.index + match[0].length);
  const evidence = parseEpisodeCoordinates(outside);
  if (
    evidence.invalid ||
    evidence.forms.some((form) => form.kind !== "unknown") ||
    /\b(?:S\d|Season\b)|[._ -][Ex]\d/iu.test(outside)
  )
    return { status: "protected", reason: "season_set_conflict" };
  return {
    status: "resolved",
    range: {
      schemaVersion: 1,
      kind: "explicit_season_range",
      raw: match[0],
      start,
      end,
      seasons: Array.from(
        { length: end - start + 1 },
        (_, index) => start + index,
      ),
    },
  };
}

/** The producer independently checks these selected IDs against every current row in each named season. */
export function resolveSeriesSeasonSetV1(
  range: SeriesSeasonSetV1,
  snapshot: CoordinateSnapshot,
) {
  const episodes = snapshot.episodes;
  if (episodes.length > 100)
    return { status: "protected" as const, reason: "coverage_limit" };
  if (
    episodes.length === 0 ||
    episodes.some(
      (episode) =>
        episode.seriesId !== snapshot.seriesId ||
        !range.seasons.includes(episode.seasonNumber),
    ) ||
    range.seasons.some(
      (season) => !episodes.some((episode) => episode.seasonNumber === season),
    )
  )
    return { status: "protected" as const, reason: "season_set_incomplete" };
  const ids = episodes.map((episode) => episode.mediaId);
  const coordinates = episodes.map(
    (episode) =>
      `${String(episode.seasonNumber)}:${String(episode.episodeNumber)}`,
  );
  return new Set(ids).size !== ids.length ||
    new Set(coordinates).size !== coordinates.length
    ? { status: "protected" as const, reason: "season_set_conflict" }
    : { status: "resolved" as const, mediaIds: ids.sort() };
}
