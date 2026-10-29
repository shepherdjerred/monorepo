import type {
  CoordinateResolution,
  CoordinateSnapshot,
  EpisodeCoordinateEvidence,
} from "#shared/acquisition/coordinates.ts";
import type { TvSeasonDirectory } from "#shared/acquisition/tv-file-evidence-v2.ts";
import { parseEpisodeCoordinates } from "./parser.ts";
import { resolveEpisodeCoordinates } from "./coordinates.ts";

type Result =
  | Extract<CoordinateResolution, { status: "protected" }>
  | {
      status: "resolved";
      mediaIds: string[];
      parsed: EpisodeCoordinateEvidence;
      directory: TvSeasonDirectory | null;
    };

/** Directory shorthand only adds one positive season/episode; absolute and specials never come from a guess. */
export function resolveTvMemberCoordinates(
  relativePath: string,
  snapshot: CoordinateSnapshot,
): Result {
  const components = relativePath.split("/");
  if (
    relativePath.length > 4096 ||
    components.length > 32 ||
    components.some(
      (part) =>
        part === "" || part === "." || part === ".." || part.includes("\\"),
    )
  )
    return { status: "protected", reason: "coordinate_invalid" };
  const member = components.at(-1);
  if (member === undefined)
    throw new Error("TV member path omitted its basename");
  const directories = components.slice(0, -1).flatMap((segment, index) => {
    const match = /^(?:season[ ._-]*|s)(\d{1,3})$/iu.exec(segment);
    return match === null ? [] : [{ index, segment, season: Number(match[1]) }];
  });
  if (directories.length > 1)
    return { status: "protected", reason: "coordinate_conflict" };
  const directory = directories[0];
  const parsed = parseEpisodeCoordinates(member);
  if (parsed.invalid || parsed.forms.some((form) => form.kind !== "unknown")) {
    const result = resolveEpisodeCoordinates(parsed, snapshot);
    if (result.status === "protected") return result;
    return directory !== undefined &&
      result.mediaIds.some(
        (mediaId) =>
          snapshot.episodes.find((episode) => episode.mediaId === mediaId)
            ?.seasonNumber !== directory.season,
      )
      ? { status: "protected", reason: "coordinate_conflict" }
      : { ...result, parsed, directory: null };
  }
  if (directory?.index !== components.length - 2 || directory.season === 0)
    return { status: "protected", reason: "coordinate_unknown" };
  const number = /^e?(\d{1,4})\.(?:mkv|mp4|m4v|avi|ts)$/iu.exec(member)?.[1];
  if (number === undefined)
    return { status: "protected", reason: "coordinate_unknown" };
  const episode = Number(number);
  if (episode === 0)
    return { status: "protected", reason: "coordinate_invalid" };
  const coordinates: EpisodeCoordinateEvidence = {
    forms: [
      {
        kind: "season_episodes",
        season: directory.season,
        episodes: [episode],
        form: "single",
      },
    ],
    invalid: false,
  };
  const result = resolveEpisodeCoordinates(coordinates, snapshot);
  return result.status === "protected"
    ? result
    : {
        ...result,
        parsed: coordinates,
        directory: { ...directory, member, episode },
      };
}
