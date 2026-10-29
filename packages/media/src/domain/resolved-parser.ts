import type {
  ResolvedProfile,
  ResolvedRelease,
  SourceQuality,
} from "./resolved-contract.ts";
import { parseResolvedAnime } from "./resolved-anime-parser.ts";

type ParsedScene = {
  qualityId: number;
  releaseTitle: string | null;
  releaseGroup: string | null;
  revision: ResolvedRelease["revision"];
  reasons: string[];
};
const UNKNOWN: ParsedScene = {
  qualityId: 0,
  releaseTitle: null,
  releaseGroup: null,
  revision: null,
  reasons: ["source_parse_unsupported"],
};
// Scene grammar excludes sites, brackets, editions and ambiguous source markers; verified anime is parsed separately.
// The captured source parser fixtures verify this subset; unsupported syntax is never approximated.
const TOKENS = new Set(
  "720p 1080p 2160p amzn nf dsnp atvp hmax hulu pcok web-dl webdl webrip bluray remux complete avc hevc av1 x264 x265 h264 h265 h 264 265 dv hdr hdr10 hdr10+ dolby vision sdr truehd atmos dts hd ma aac ac3 eac3 dd ddp 2 0 5 1 7 10bit 8bit proper repack repack2 repack3 rerip real english multi dual audio ddp5 ddp2 ddp7 dts-hd".split(
    " ",
  ),
);

function sceneParts(title: string, source: ResolvedProfile["source"]) {
  if (title.length > 4096 || !/^[\w .+&'!-]+$/u.test(title)) return null;
  const base = title.replace(/\.(?:mkv|mp4|avi|m4v)$/iu, "");
  const group = /-(?<group>[A-Za-z0-9]{1,64})$/u.exec(base);
  if (group?.groups === undefined) return null;
  const marker =
    source === "radarr"
      ? /[ ._](?:19|20)\d{2}[ ._]/u.exec(base)
      : /[ ._]S\d{1,2}(?:E\d{1,3}(?:E\d{1,3})?)?[ ._]/iu.exec(base);
  if (marker === null || marker.index === 0) return null;
  const suffix = base.slice(marker.index + marker[0].length, group.index);
  const tokens = suffix
    .toLowerCase()
    .split(/[ ._]+/u)
    .filter(Boolean);
  if (tokens.some((token) => !TOKENS.has(token))) return null;
  const name = base.slice(0, marker.index);
  return {
    tokens,
    releaseTitle:
      source === "radarr"
        ? `${name.includes(".") ? "A.Movie" : "A Movie"}${base.slice(marker.index)}`
        : base,
    releaseGroup: group.groups["group"] ?? "",
  };
}
function qualityMatch(
  quality: SourceQuality,
  source: ResolvedProfile["source"],
  tokens: string[],
): boolean {
  const resolutions = tokens.filter((token) =>
    ["720p", "1080p", "2160p"].includes(token),
  );
  if (
    resolutions.length !== 1 ||
    Number(resolutions[0]?.slice(0, -1)) !== quality.resolution
  )
    return false;
  const sources = tokens.filter((token) =>
    ["web-dl", "webdl", "webrip", "bluray"].includes(token),
  );
  if (sources.length !== 1) return false;
  const remux = tokens.includes("remux");
  const disk = tokens.includes("complete");
  if ((remux || disk) && sources[0] !== "bluray") return false;
  if (remux && disk) return false;
  const original = sources[0];
  const expected = sourceName(original, source, remux);
  if (quality.source.toLowerCase() !== expected) return false;
  return (
    source === "sonarr" ||
    (quality.modifier ?? "none").toLowerCase() ===
      (remux ? "remux" : disk ? "brdisk" : "none")
  );
}
function sourceName(
  original: string | undefined,
  source: ResolvedProfile["source"],
  remux: boolean,
) {
  if (original === "web-dl" || original === "webdl")
    return source === "radarr" ? "webdl" : "web";
  return original === "bluray" && remux && source === "sonarr"
    ? "blurayraw"
    : original;
}
function revision(tokens: string[]): ResolvedRelease["revision"] {
  const revisions = tokens.filter((token) =>
    /^(?:proper|repack[23]?|rerip)$/u.test(token),
  );
  if (
    revisions.length > 1 ||
    tokens.filter((token) => token === "real").length > 1
  )
    return null;
  const token = revisions[0];
  return {
    version:
      token === undefined
        ? 1
        : token === "repack2"
          ? 3
          : token === "repack3"
            ? 4
            : 2,
    real: tokens.includes("real") ? 1 : 0,
  };
}
export function parseResolvedScene(
  profile: ResolvedProfile,
  title: string,
): ParsedScene {
  const anime = parseResolvedAnime(profile, title);
  if (anime !== null) return anime;
  const parts = sceneParts(title, profile.source);
  if (parts === null) return UNKNOWN;
  const qualities = profile.qualityDefinitions.filter((definition) =>
    qualityMatch(definition.quality, profile.source, parts.tokens),
  );
  const parsedRevision = revision(parts.tokens);
  const quality = qualities[0];
  if (
    quality === undefined ||
    parsedRevision === null ||
    qualities.length !== 1
  )
    return UNKNOWN;
  return {
    qualityId: quality.quality.id,
    releaseTitle: parts.releaseTitle,
    releaseGroup: parts.releaseGroup,
    revision: parsedRevision,
    reasons: [],
  };
}
