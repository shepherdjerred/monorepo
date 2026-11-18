import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";

const MEDIA_EXTENSION_RE = /\.(?:mkv|mp4|avi|webm|mov|m4v|ts|flv|wmv)$/iu;
const EPISODE_MARKER_RE =
  /\b(?:S(?<season>\d{1,2})E(?<episode>\d{1,3})(?:[-–]?E\d{1,3})?|(?<xSeason>\d{1,2})x(?<xEpisode>\d{2,3}))\b/iu;
const TRAILING_YEAR_RE = /\s*[([](?:19|20)\d{2}[)\]]\s*$/u;

export type EpisodeMarker = {
  readonly seriesKey: string;
  readonly seriesLabel: string;
  readonly season: number;
  readonly episode: number;
};

export type SeriesEpisode = {
  readonly entry: LibraryEntry;
  readonly path: string;
  readonly title: string;
  readonly season: number;
  readonly episode: number;
};

export type SeriesGroup = {
  readonly seriesKey: string;
  readonly series: string;
  readonly seasons: number;
  readonly episodes: readonly SeriesEpisode[];
};

export type PickEpisodicCandidateOptions = {
  readonly preferredSeriesKeys?: ReadonlySet<string>;
  readonly allowedPaths?: ReadonlySet<string>;
  readonly excludePaths?: ReadonlySet<string>;
  readonly rng?: () => number;
};

function stripKnownMediaExtension(value: string): string {
  return value.replace(MEDIA_EXTENSION_RE, "");
}

function basenameOfPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const lastSlash = normalized.lastIndexOf("/");
  const base = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  return stripKnownMediaExtension(base);
}

function cleanSeriesLabel(raw: string): string {
  const withoutUnderscores = raw.replaceAll("_", " ");
  const spaced = withoutUnderscores.includes(" ")
    ? withoutUnderscores
    : withoutUnderscores.replaceAll(".", " ");
  return spaced
    .replaceAll(/\s+/gu, " ")
    .replace(/^[\s.\-_:\])]+/u, "")
    .replace(/[\s\-_:[(]+$/u, "")
    .trim();
}

function stripEpisodeSuffix(value: string): string {
  const despaced = stripKnownMediaExtension(value).replaceAll("_", " ");
  const marker = EPISODE_MARKER_RE.exec(despaced);
  return marker === null ? despaced : despaced.slice(0, marker.index);
}

function toAlphanumericKey(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll(/[^a-z0-9]+/gu, "");
}

/** Case-insensitive alphanumeric series key with any trailing episode marker removed. */
export function normalizeSeriesKey(value: string): string {
  return toAlphanumericKey(stripEpisodeSuffix(value));
}

function parseEpisodeMarkerFromString(raw: string): EpisodeMarker | null {
  const cleaned = stripKnownMediaExtension(raw).replaceAll("_", " ");
  const match = EPISODE_MARKER_RE.exec(cleaned);
  if (match === null) {
    return null;
  }
  const seasonText = match.groups?.["season"] ?? match.groups?.["xSeason"];
  const episodeText = match.groups?.["episode"] ?? match.groups?.["xEpisode"];
  if (seasonText === undefined || episodeText === undefined) {
    return null;
  }
  const seriesLabel = cleanSeriesLabel(cleaned.slice(0, match.index));
  const seriesKey = toAlphanumericKey(seriesLabel);
  if (seriesKey.length === 0) {
    return null;
  }
  return {
    seriesKey,
    seriesLabel,
    season: Number(seasonText),
    episode: Number(episodeText),
  };
}

function parseEpisodeMarkerFromEntry(
  entry: LibraryEntry,
): EpisodeMarker | null {
  const fallbackName = basenameOfPath(
    entry.relativePath.length > 0 ? entry.relativePath : entry.path,
  );
  if (entry.season !== undefined && entry.episode !== undefined) {
    const rawSeries =
      entry.series ??
      parseEpisodeMarkerFromString(entry.title)?.seriesLabel ??
      parseEpisodeMarkerFromString(fallbackName)?.seriesLabel;
    if (rawSeries === undefined) {
      return null;
    }
    const seriesLabel = cleanSeriesLabel(stripEpisodeSuffix(rawSeries));
    const seriesKey = toAlphanumericKey(seriesLabel);
    if (seriesKey.length === 0) {
      return null;
    }
    return {
      seriesKey,
      seriesLabel,
      season: entry.season,
      episode: entry.episode,
    };
  }

  const parsed =
    parseEpisodeMarkerFromString(entry.title) ??
    parseEpisodeMarkerFromString(fallbackName);
  if (parsed === null) {
    return null;
  }
  if (entry.series === undefined) {
    return parsed;
  }
  const explicitLabel = cleanSeriesLabel(stripEpisodeSuffix(entry.series));
  const explicitKey = toAlphanumericKey(explicitLabel);
  return explicitKey.length > 0
    ? {
        seriesKey: explicitKey,
        seriesLabel: explicitLabel,
        season: parsed.season,
        episode: parsed.episode,
      }
    : parsed;
}

/** Extract normalized series identity plus season/episode coordinates from a title or library entry. */
export function parseEpisodeMarker(
  titleOrEntry: string | LibraryEntry,
): EpisodeMarker | null {
  return typeof titleOrEntry === "string"
    ? parseEpisodeMarkerFromString(titleOrEntry)
    : parseEpisodeMarkerFromEntry(titleOrEntry);
}

/** Group all episodic library entries by normalized series key in deterministic `(season, episode, path)` order. */
export function listSeriesCatalog(
  entries: readonly LibraryEntry[],
): ReadonlyMap<string, SeriesGroup> {
  const buckets = new Map<
    string,
    { seriesLabel: string; episodes: (SeriesEpisode & { label: string })[] }
  >();

  for (const entry of entries) {
    const marker = parseEpisodeMarkerFromEntry(entry);
    if (marker === null) {
      continue;
    }
    const item = {
      entry,
      path: entry.path,
      title: entry.title,
      season: marker.season,
      episode: marker.episode,
      label: marker.seriesLabel,
    };
    const existing = buckets.get(marker.seriesKey);
    if (existing === undefined) {
      buckets.set(marker.seriesKey, {
        seriesLabel: marker.seriesLabel,
        episodes: [item],
      });
    } else {
      existing.episodes.push(item);
    }
  }

  const groups: SeriesGroup[] = [];
  for (const [seriesKey, bucket] of buckets) {
    const sorted = bucket.episodes.toSorted(
      (a, b) =>
        a.season - b.season ||
        a.episode - b.episode ||
        a.path.localeCompare(b.path),
    );
    const series = sorted[0]?.label ?? bucket.seriesLabel;
    const seasons = new Set(sorted.map((ep) => ep.season)).size;
    const episodes: SeriesEpisode[] = sorted.map(
      ({ label: _label, ...episode }) => episode,
    );
    groups.push({ seriesKey, series, seasons, episodes });
  }

  groups.sort(
    (a, b) =>
      a.series.localeCompare(b.series) ||
      a.seriesKey.localeCompare(b.seriesKey),
  );
  return new Map(groups.map((group) => [group.seriesKey, group]));
}

function stripTrailingYearKey(series: string): string {
  return normalizeSeriesKey(series.replace(TRAILING_YEAR_RE, ""));
}

function resolveSeriesGroup(
  catalog: ReadonlyMap<string, SeriesGroup>,
  seriesKey: string,
): SeriesGroup | undefined {
  const exact = catalog.get(seriesKey);
  if (exact !== undefined) {
    return exact;
  }
  const matches: SeriesGroup[] = [];
  for (const group of catalog.values()) {
    if (stripTrailingYearKey(group.series) === seriesKey) {
      matches.push(group);
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function locatePlayedPosition(
  catalog: ReadonlyMap<string, SeriesGroup>,
  played: { readonly title: string; readonly path?: string },
): {
  readonly group: SeriesGroup;
  readonly season: number;
  readonly episode: number;
} | null {
  if (played.path !== undefined) {
    for (const group of catalog.values()) {
      const byPath = group.episodes.find((ep) => ep.path === played.path);
      if (byPath !== undefined) {
        return { group, season: byPath.season, episode: byPath.episode };
      }
    }
  }

  const marker =
    parseEpisodeMarkerFromString(played.title) ??
    (played.path === undefined
      ? null
      : parseEpisodeMarkerFromString(basenameOfPath(played.path)));
  if (marker === null) {
    return null;
  }
  const group = resolveSeriesGroup(catalog, marker.seriesKey);
  return group === undefined
    ? null
    : { group, season: marker.season, episode: marker.episode };
}

/** Identify which local series a played history item belongs to, or null if none matches. */
export function identifyLibrarySeriesKey(
  entries: readonly LibraryEntry[],
  playedTitleOrPath: { readonly title: string; readonly path?: string },
): string | null {
  const catalog = listSeriesCatalog(entries);
  return (
    locatePlayedPosition(catalog, playedTitleOrPath)?.group.seriesKey ?? null
  );
}

/**
 * Find the immediate next episode in `(season, episode)` order for a played episode, rolling
 * across season boundaries (`S01Efinal -> S02E01`) and returning `null` at the series finale.
 */
export function nextEpisodeInSeries(
  entries: readonly LibraryEntry[],
  playedTitleOrPath: { readonly title: string; readonly path?: string },
): LibraryEntry | null {
  const catalog = listSeriesCatalog(entries);
  const current = locatePlayedPosition(catalog, playedTitleOrPath);
  if (current === null) {
    return null;
  }
  const next = current.group.episodes.find(
    (ep) =>
      ep.season > current.season ||
      (ep.season === current.season && ep.episode > current.episode),
  );
  return next?.entry ?? null;
}

function pickIndex(length: number, rng: () => number): number {
  if (length <= 1) {
    return 0;
  }
  const sample = rng();
  if (!Number.isFinite(sample) || sample <= 0) {
    return 0;
  }
  return sample >= 1 ? length - 1 : Math.floor(sample * length);
}

function isEligiblePath(
  filePath: string,
  options: PickEpisodicCandidateOptions,
): boolean {
  return (
    (options.allowedPaths === undefined ||
      options.allowedPaths.has(filePath)) &&
    !(options.excludePaths?.has(filePath) ?? false)
  );
}

function matchesPreferredSeries(
  group: SeriesGroup,
  preferredSeriesKeys: ReadonlySet<string>,
): boolean {
  return (
    preferredSeriesKeys.has(group.seriesKey) ||
    preferredSeriesKeys.has(stripTrailingYearKey(group.series))
  );
}

/** Pick an episodic library entry across eligible shows, preferring requested series and excluding recently played paths. */
export function pickEpisodicCandidate(
  entries: readonly LibraryEntry[],
  options: PickEpisodicCandidateOptions = {},
): LibraryEntry | null {
  const catalog = listSeriesCatalog(entries);
  const eligibleGroups: {
    readonly group: SeriesGroup;
    readonly episodes: readonly SeriesEpisode[];
  }[] = [];

  for (const group of catalog.values()) {
    const episodes = group.episodes.filter((ep) =>
      isEligiblePath(ep.path, options),
    );
    if (episodes.length > 0) {
      eligibleGroups.push({ group, episodes });
    }
  }

  if (eligibleGroups.length === 0) {
    return null;
  }

  const { preferredSeriesKeys } = options;
  const preferred =
    preferredSeriesKeys !== undefined && preferredSeriesKeys.size > 0
      ? eligibleGroups.filter(({ group }) =>
          matchesPreferredSeries(group, preferredSeriesKeys),
        )
      : [];
  const pool = preferred.length > 0 ? preferred : eligibleGroups;
  const rng = options.rng ?? Math.random;
  const chosenGroup = pool[pickIndex(pool.length, rng)];
  if (chosenGroup === undefined) {
    return null;
  }
  const chosenEpisode =
    chosenGroup.episodes[pickIndex(chosenGroup.episodes.length, rng)];
  return chosenEpisode?.entry ?? null;
}
