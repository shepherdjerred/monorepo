import type { MediaKind, ReleaseAttributes } from "#shared/contract.ts";

export type ParsedReleaseName = {
  title: string;
  year: number | null;
  season: number | null;
  episodes: number[];
  absoluteEpisodes: number[];
  seasonPack: boolean;
  quality: string;
  codec: string;
  audioLanguages: string[];
  scoreTags: string[];
};

export type ReleaseMatchInput = {
  id: string;
  providerId: string;
  title: string;
  sizeBytes: number;
  media: {
    id: string;
    kind: MediaKind;
    title: string;
    year: number | null;
    seriesTitle?: string;
    seriesYear?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    aliases?: readonly string[];
    externalIds?: Readonly<Record<string, string>>;
  };
  knownEpisodes?: readonly {
    mediaId: string;
    season: number;
    episode: number;
    absoluteNumber?: number;
  }[];
  externalIds?: Readonly<Record<string, string>>;
  audioLanguages?: readonly string[];
  /** Owner-authorized mapping, scoped to this exact release name and known item IDs. */
  manualMapping?: { releaseTitle: string; mediaIds: readonly string[] };
};

export function normalizeMediaTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[\p{P}\p{S}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function range(first: string | undefined, last?: string): number[] {
  if (first === undefined) return [];
  const start = Number(first);
  const end = last === undefined ? start : Number(last);
  return !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end < start ||
    end - start > 1000
    ? []
    : Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function episodeEvidence(name: string) {
  const standard =
    /\bS(?<season>\d{1,3})[ ._-]*E(?<first>\d{1,4})(?:(?<separator>[ ._]*E|[ ._]*-[ ._]*E?)(?<last>\d{1,4}))?/iu.exec(
      name,
    );
  const alternate =
    /\b(?<season>\d{1,3})x(?<first>\d{1,4})(?:-(?<last>\d{1,4}))?\b/iu.exec(
      name,
    );
  const found = standard ?? alternate;
  if (found?.groups !== undefined)
    return {
      index: found.index,
      season: Number(found.groups["season"]),
      episodes: matchedEpisodes(found, name),
      absoluteEpisodes: [],
      seasonPack: false,
    };
  const pack =
    /\b(?:S(?<short>\d{1,3})|Season[ ._-]+(?<long>\d{1,3}))\b/iu.exec(name);
  if (pack?.groups !== undefined)
    return {
      index: pack.index,
      season: Number(pack.groups["short"] ?? pack.groups["long"]),
      episodes: [],
      absoluteEpisodes: [],
      seasonPack: [...name.matchAll(/\bS\d{1,3}\b/giu)].length <= 1,
    };
  const absolute =
    /\s-\s(?<first>\d{1,4})(?:-(?<last>\d{1,4}))?(?:v\d+)?(?:\s|\[|$)/iu.exec(
      name,
    );
  if (absolute?.groups !== undefined)
    return {
      index: absolute.index,
      season: null,
      episodes: [],
      absoluteEpisodes: range(
        absolute.groups["first"],
        absolute.groups["last"],
      ),
      seasonPack: false,
    };
  return {
    index: -1,
    season: null,
    episodes: [],
    absoluteEpisodes: [],
    seasonPack: false,
  };
}

function matchedEpisodes(found: RegExpExecArray, name: string): number[] {
  const groups = found.groups;
  if (
    groups === undefined ||
    /^[ ._-]*E\d/iu.test(name.slice(found.index + found[0].length)) ||
    [...name.matchAll(/\bS\d{1,3}/giu)].length > 1
  )
    return [];
  return groups["separator"] !== undefined &&
    !groups["separator"].includes("-") &&
    groups["last"] !== undefined
    ? [...range(groups["first"]), ...range(groups["last"])]
    : range(groups["first"], groups["last"]);
}

function sourceQuality(name: string): string {
  const resolution =
    /\b(2160|1080|720|576|480)[pi]\b/iu.exec(name)?.[1] ??
    (/\b4K\b/iu.test(name) ? "2160" : null);
  if (resolution === null) return "unknown";
  const sources: readonly [string, RegExp][] = [
    ["Remux", /\bREMUX\b/iu],
    ["Bluray", /\b(?:Blu[ ._-]?Ray|BDRip)\b/iu],
    ["WEB", /\bWEB[ ._-]?DL\b/iu],
    ["WEBrip", /\bWEB[ ._-]?Rip\b/iu],
    ["HDTV", /\bHDTV\b/iu],
  ];
  const source = sources.find((entry) => entry[1].test(name))?.[0] ?? "unknown";
  return `${source}-${resolution}p`;
}

function tags(name: string): string[] {
  const result: string[] = [];
  const patterns: readonly [string, RegExp][] = [
    ["HDR", /\bHDR(?:10)?\b/iu],
    ["HDR10+", /\bHDR10\+/iu],
    ["DV", /\b(?:DV|DoVi|Dolby[ ._-]?Vision)\b/iu],
    ["DD+ATMOS", /\b(?:DDP|DD\+|EAC3)[ .\d_-]*Atmos\b/iu],
    ["TrueHD", /\bTrueHD\b/iu],
    ["DTS-X", /\bDTS[ .:_-]?X\b/iu],
    ["REPACK", /\bREPACK\d*\b/iu],
    ["PROPER", /\bPROPER\b/iu],
  ];
  for (const [tag, pattern] of patterns)
    if (pattern.test(name)) result.push(tag);
  const group = /-(?<group>[\p{L}\d]+)(?:\.(?:mkv|mp4|avi))?$/u.exec(name)
    ?.groups?.["group"];
  if (group !== undefined) result.push(`group:${group}`);
  return result;
}

export function parseReleaseName(value: string): ParsedReleaseName {
  const name = value
    .replace(/^\[[^\]]+\][ ._-]*/u, "")
    .replace(/\.(?:mkv|mp4|avi|ts)$/iu, "");
  const evidence = episodeEvidence(name);
  const technicalIndex = name.search(
    /\b(?:2160|1080|720|576|480)[pi]\b|\b(?:Blu[ ._-]?Ray|WEB[ ._-]?(?:DL|Rip)|HDTV|REMUX)\b/iu,
  );
  const end =
    [evidence.index, technicalIndex]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0] ?? name.length;
  const identity = name.slice(0, end);
  const years = [...identity.matchAll(/\b(?:19|20)\d{2}\b/gu)];
  const lastYear = years.at(-1);
  const yearIsSuffix =
    lastYear !== undefined &&
    normalizeMediaTitle(identity.slice(lastYear.index + lastYear[0].length))
      .length === 0 &&
    normalizeMediaTitle(identity.slice(0, lastYear.index)).length > 0;
  const title = yearIsSuffix ? identity.slice(0, lastYear.index) : identity;
  const audioLanguages: string[] = [];
  for (const [code, pattern] of [
    ["en", /\b(?:ENG|English)\b/iu],
    ["ja", /\b(?:JPN|Japanese)\b/iu],
    ["zh", /\b(?:CHI|Mandarin|Chinese)\b/iu],
    ["ko", /\b(?:KOR|Korean)\b/iu],
  ] satisfies [string, RegExp][]) {
    if (pattern.test(name.slice(end))) audioLanguages.push(code);
  }
  return {
    title: normalizeMediaTitle(title),
    year: yearIsSuffix ? Number(lastYear[0]) : null,
    season: evidence.season,
    episodes: evidence.episodes,
    absoluteEpisodes: evidence.absoluteEpisodes,
    seasonPack: evidence.seasonPack,
    quality: sourceQuality(name),
    codec: /\b(?:HEVC|[hx][ ._-]?265)\b/iu.test(name)
      ? "HEVC"
      : /\b(?:AVC|[hx][ ._-]?264)\b/iu.test(name)
        ? "H264"
        : /\bAV1\b/iu.test(name)
          ? "AV1"
          : "unknown",
    audioLanguages,
    scoreTags: tags(name),
  };
}

function matchIds(input: ReleaseMatchInput): "match" | "conflict" | "unknown" {
  const expected = input.media.externalIds ?? {};
  let matched = false;
  for (const [namespace, value] of Object.entries(input.externalIds ?? {})) {
    const wanted = expected[namespace];
    if (wanted === undefined) continue;
    if (wanted !== value) return "conflict";
    matched = true;
  }
  return matched ? "match" : "unknown";
}

function resolveCoverage(
  input: ReleaseMatchInput,
  parsed: ParsedReleaseName,
): { mediaIds: string[]; reason: string | null } {
  const media = input.media;
  if (media.kind === "movie") {
    return parsed.season !== null || parsed.absoluteEpisodes.length > 0
      ? { mediaIds: [], reason: "movie_contains_episode_numbering" }
      : { mediaIds: [media.id], reason: null };
  }
  const known = input.knownEpisodes ?? [];
  if (parsed.absoluteEpisodes.length > 0) {
    const matches = parsed.absoluteEpisodes.map((number) =>
      known.filter((episode) => episode.absoluteNumber === number),
    );
    if (matches.some((episodes) => episodes.length !== 1))
      return { mediaIds: [], reason: "absolute_numbering_unmapped" };
    return {
      mediaIds: matches.flatMap((episodes) =>
        episodes.map((episode) => episode.mediaId),
      ),
      reason: null,
    };
  }
  if (parsed.season === null)
    return { mediaIds: [], reason: "episode_coverage_missing" };
  if (parsed.seasonPack) {
    const episodes = known.filter(
      (episode) => episode.season === parsed.season,
    );
    return episodes.length === 0
      ? { mediaIds: [], reason: "season_coverage_unknown" }
      : { mediaIds: episodes.map((episode) => episode.mediaId), reason: null };
  }
  if (parsed.episodes.length === 0)
    return { mediaIds: [], reason: "episode_range_invalid" };
  if (
    known.length === 0 &&
    media.kind === "episode" &&
    parsed.episodes.length === 1 &&
    parsed.season === media.seasonNumber &&
    parsed.episodes[0] === media.episodeNumber
  )
    return { mediaIds: [media.id], reason: null };
  const matches = parsed.episodes.map((number) =>
    known.filter(
      (episode) =>
        episode.season === parsed.season && episode.episode === number,
    ),
  );
  if (matches.some((episodes) => episodes.length !== 1))
    return { mediaIds: [], reason: "episode_numbering_unmapped" };
  return {
    mediaIds: matches.flatMap((episodes) =>
      episodes.map((episode) => episode.mediaId),
    ),
    reason: null,
  };
}

function identityReasons(
  input: ReleaseMatchInput,
  parsed: ParsedReleaseName,
  ids: ReturnType<typeof matchIds>,
): string[] {
  const aliases = [
    input.media.seriesTitle ?? input.media.title,
    ...(input.media.aliases ?? []),
  ].map((title) => normalizeMediaTitle(title));
  const reasons: string[] = [];
  const expectedYear =
    input.media.kind === "movie" ? input.media.year : input.media.seriesYear;
  if (ids === "conflict") reasons.push("external_identity_conflict");
  if (ids !== "match" && !aliases.includes(parsed.title))
    reasons.push("title_mismatch");
  if (
    expectedYear !== undefined &&
    expectedYear !== null &&
    parsed.year !== null &&
    expectedYear !== parsed.year
  )
    reasons.push("year_mismatch");
  if (
    ids !== "match" &&
    input.media.kind === "movie" &&
    (input.media.year === null || parsed.year === null)
  )
    reasons.push("movie_year_unconfirmed");
  if (
    ids !== "match" &&
    input.media.kind !== "movie" &&
    (expectedYear === undefined || parsed.year === null)
  )
    reasons.push("series_year_unconfirmed");
  return reasons;
}

function applyManualMapping(
  input: ReleaseMatchInput,
  ids: ReturnType<typeof matchIds>,
): string[] | null {
  const manual = input.manualMapping;
  if (ids !== "conflict" && manual?.releaseTitle === input.title) {
    const allowed = new Set([
      input.media.id,
      ...(input.knownEpisodes ?? []).map((episode) => episode.mediaId),
    ]);
    if (
      manual.mediaIds.length === 0 ||
      manual.mediaIds.some((id) => !allowed.has(id))
    )
      throw new Error("Manual release mapping references unknown media");
    return [...new Set(manual.mediaIds)];
  }
  return null;
}

function confidence(
  reasons: readonly string[],
): ReleaseAttributes["identityConfidence"] {
  if (reasons.length === 0) return "exact";
  return reasons.some(
    (reason) =>
      reason.includes("mismatch") ||
      reason.includes("conflict") ||
      reason === "movie_contains_episode_numbering",
  )
    ? "mismatch"
    : "ambiguous";
}

export function matchRelease(input: ReleaseMatchInput): {
  attributes: ReleaseAttributes;
  reasons: string[];
  parsed: ParsedReleaseName;
} {
  const parsed = parseReleaseName(input.title);
  const ids = matchIds(input);
  const reasons = identityReasons(input, parsed, ids);
  const coverage = resolveCoverage(input, parsed);
  if (coverage.reason !== null) reasons.push(coverage.reason);
  const manual = applyManualMapping(input, ids);
  if (manual !== null) {
    coverage.mediaIds = manual;
    reasons.splice(0);
  }
  if (
    input.media.kind === "episode" &&
    !coverage.mediaIds.includes(input.media.id)
  )
    reasons.push("requested_episode_missing");
  return {
    attributes: {
      id: input.id,
      providerId: input.providerId,
      title: input.title,
      sizeBytes: input.sizeBytes,
      mediaIds: coverage.mediaIds,
      identityConfidence: confidence(reasons),
      quality: parsed.quality,
      codec: parsed.codec,
      audioLanguages: [
        ...new Set([...(input.audioLanguages ?? []), ...parsed.audioLanguages]),
      ],
      scoreTags: parsed.scoreTags,
    },
    reasons,
    parsed,
  };
}
