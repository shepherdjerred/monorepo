import type { ResolvedProfile } from "#domain/resolved-contract.ts";
import {
  RESOLVED_SCENE_TOKENS,
  RESOLVED_SCENE_UNKNOWN,
  matchResolvedSceneQuality,
  resolvedSceneRevision,
  type ParsedScene,
} from "#domain/resolved-parser.ts";
import type { SeriesSeasonSetV1 } from "#shared/acquisition/series-pack-v1.ts";
import type { CoordinateSnapshot } from "#shared/acquisition/coordinates.ts";
import { parseEpisodeCoordinates } from "./parser.ts";
import { resolveEpisodeCoordinates } from "./coordinates.ts";
import { parseSeriesSeasonSetV1 } from "./series-season-set.ts";

/** This new grammar parses the literal range; it never retitles a provider label for the old parser. */
export function parseResolvedSeriesPackSceneV1(
  profile: ResolvedProfile,
  title: string,
  range: SeriesSeasonSetV1,
): ParsedScene {
  const parsed = parseSeriesSeasonSetV1(title);
  if (
    profile.source !== "sonarr" ||
    parsed.status !== "resolved" ||
    parsed.range.raw !== range.raw ||
    parsed.range.start !== range.start ||
    parsed.range.end !== range.end
  )
    return RESOLVED_SCENE_UNKNOWN;
  const start = title.indexOf(range.raw);
  return sceneWithMarker(profile, {
    title,
    start,
    end: start + range.raw.length,
    releaseTitle: title.replace(/\.(?:mkv|mp4|avi|m4v)$/iu, ""),
  });
}

/** A real member has its own literal numbering and quality label, independently of the pack title. */
export function parseResolvedSeriesPackMemberV1(
  profile: ResolvedProfile,
  input: {
    filename: string;
    releaseTitle: string;
    coordinates: CoordinateSnapshot;
    coverage: readonly string[];
  },
): ParsedScene {
  const parsed = parseEpisodeCoordinates(input.filename);
  const resolved = resolveEpisodeCoordinates(parsed, input.coordinates);
  if (
    profile.source !== "sonarr" ||
    resolved.status !== "resolved" ||
    resolved.mediaIds.length !== input.coverage.length ||
    resolved.mediaIds.some((id) => !input.coverage.includes(id))
  )
    return RESOLVED_SCENE_UNKNOWN;
  const marker = /[ ._]S\d{1,3}E\d{1,4}(?:-?E\d{1,4})?[ ._]/iu.exec(
    input.filename,
  );
  if (marker === null) return RESOLVED_SCENE_UNKNOWN;
  return sceneWithMarker(profile, {
    title: input.filename,
    start: marker.index + 1,
    end: marker.index + marker[0].length - 1,
    releaseTitle: input.releaseTitle.replace(/\.(?:mkv|mp4|avi|m4v)$/iu, ""),
  });
}

function sceneWithMarker(
  profile: ResolvedProfile,
  input: { title: string; start: number; end: number; releaseTitle: string },
): ParsedScene {
  const { title, start, end } = input;
  if (
    title.length > 4096 ||
    !/^[\w .+&'!-]+$/u.test(title) ||
    start < 1 ||
    !/[ ._]/u.test(title[start - 1] ?? "") ||
    !/[ ._]/u.test(title[end] ?? "")
  )
    return RESOLVED_SCENE_UNKNOWN;
  const base = title.replace(/\.(?:mkv|mp4|avi|m4v)$/iu, "");
  const group = /-(?<group>[A-Za-z0-9]{1,64})$/u.exec(base);
  if (group?.groups === undefined || end >= group.index)
    return RESOLVED_SCENE_UNKNOWN;
  const tokens = base
    .slice(end + 1, group.index)
    .toLowerCase()
    .split(/[ ._]+/u)
    .filter(Boolean);
  if (tokens.some((token) => !RESOLVED_SCENE_TOKENS.has(token)))
    return RESOLVED_SCENE_UNKNOWN;
  const qualities = profile.qualityDefinitions.filter((definition) =>
    matchResolvedSceneQuality(definition.quality, profile.source, tokens),
  );
  const quality = qualities[0];
  const revision = resolvedSceneRevision(tokens);
  if (quality === undefined || revision === null || qualities.length !== 1)
    return RESOLVED_SCENE_UNKNOWN;
  return {
    qualityId: quality.quality.id,
    releaseTitle: input.releaseTitle,
    releaseGroup: group.groups["group"] ?? "",
    revision,
    reasons: [],
  };
}
