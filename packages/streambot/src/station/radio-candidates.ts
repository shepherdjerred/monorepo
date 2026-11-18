import { canonicalWorkKey } from "@shepherdjerred/streambot/discovery/same-work.ts";
import {
  isBlockedSource,
  isBlockedText,
  isBlockedUrl,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import type { MusicTrack } from "@shepherdjerred/streambot/music/contracts.ts";
import {
  musicSource,
  type MusicService,
} from "@shepherdjerred/streambot/music/service.ts";
import {
  sourceIdentity,
  withMode,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { runSubprocess } from "@shepherdjerred/streambot/sources/subprocess.ts";
import type { YtdlpSearchResult } from "@shepherdjerred/streambot/sources/youtube-search-result.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import type { RadioSuggestionTrack } from "./radio-llm.ts";
import type {
  CuratedStationItem,
  StationCurationContext,
} from "./station-types.ts";
import { expandYoutubeMix, extractYoutubeVideoId } from "./youtube-mix.ts";

const MIN_DURATION_SECONDS = 45;
const MAX_DURATION_SECONDS = 900;

export type DedupeTracker = {
  readonly identities: Set<string>;
  readonly workKeys: Set<string>;
  readonly videoIds: Set<string>;
  accept: (
    item: CuratedStationItem,
    mode: StationCurationContext["mode"],
  ) => CuratedStationItem | null;
};

export function validRadioDuration(
  durationSeconds: number | undefined,
): boolean {
  return (
    durationSeconds === undefined ||
    (durationSeconds >= MIN_DURATION_SECONDS &&
      durationSeconds <= MAX_DURATION_SECONDS)
  );
}

function shortSongWorkKey(title: string): string {
  const dash = /\s+[—–-]\s+/u.exec(title);
  return dash === null
    ? ""
    : canonicalWorkKey(title.slice(dash.index + dash[0].length));
}

function isAllowedStationCandidate(
  item: CuratedStationItem,
  stamped: CuratedStationItem["source"],
): boolean {
  return (
    validRadioDuration(item.durationSeconds) &&
    !isBlockedSource(stamped) &&
    !isBlockedText(item.title) &&
    !(
      stamped.kind === "url" &&
      (stamped.sportsEvent !== undefined ||
        sportsEventForSource(stamped.url) !== null)
    )
  );
}

export function createDedupeTracker(
  context: StationCurationContext,
  skippedTitles: readonly string[],
): DedupeTracker {
  const identities = new Set<string>(context.excludeIdentities);
  const workKeys = new Set<string>(context.excludeWorkKeys);
  const videoIds = new Set<string>();

  for (const identity of context.excludeIdentities) {
    if (identity.startsWith("url:")) {
      const id = extractYoutubeVideoId(identity.slice(4));
      if (id !== null) videoIds.add(id);
    }
  }
  for (const skipped of skippedTitles) {
    const key = canonicalWorkKey(skipped);
    if (key !== "") workKeys.add(key);
  }

  return {
    identities,
    workKeys,
    videoIds,
    accept: (item, mode) => {
      const stamped = withMode(item.source, mode);
      if (!isAllowedStationCandidate(item, stamped)) return null;
      const identity = sourceIdentity(stamped);
      const videoId =
        stamped.kind === "url" ? extractYoutubeVideoId(stamped.url) : null;
      const fullWork = canonicalWorkKey(item.title);
      const shortWork = shortSongWorkKey(item.title);
      const isDuplicate =
        identities.has(identity) ||
        (videoId !== null && videoIds.has(videoId)) ||
        (fullWork !== "" && workKeys.has(fullWork)) ||
        (shortWork !== "" && shortWork !== fullWork && workKeys.has(shortWork));
      if (isDuplicate) return null;

      identities.add(identity);
      if (videoId !== null) {
        videoIds.add(videoId);
        identities.add(`url:https://www.youtube.com/watch?v=${videoId}`);
      }
      if (fullWork !== "") workKeys.add(fullWork);
      if (shortWork !== "") workKeys.add(shortWork);
      return { ...item, source: stamped };
    },
  };
}

function scoreYoutubeResult(result: YtdlpSearchResult, query: string): number {
  const lower = `${result.title} ${result.channel ?? ""}`.toLowerCase();
  const queryWords = canonicalWorkKey(query)
    .split(" ")
    .filter((word) => word.length >= 3);
  const wordHits = queryWords.filter((word) => lower.includes(word)).length;
  const official = /\b(?:official|topic|vevo)\b/iu.test(lower) ? 15 : 0;
  const knownDuration = result.durationSeconds === undefined ? 0 : 10;
  return wordHits * 10 + official + knownDuration;
}

export type RadioCandidateResolverDeps = {
  readonly music?: MusicService | undefined;
  readonly searchYoutube: (
    query: string,
    signal: AbortSignal,
    limit: number,
  ) => Promise<readonly YtdlpSearchResult[]>;
  readonly ytDlpPath?: string | undefined;
  readonly runMixSubprocess?: typeof runSubprocess | undefined;
};

export class RadioCandidateResolver {
  constructor(private readonly deps: RadioCandidateResolverDeps) {}

  async expandMix(
    videoId: string,
    excludeIdentities: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<CuratedStationItem[]> {
    if (
      this.deps.ytDlpPath === undefined &&
      this.deps.runMixSubprocess === undefined
    ) {
      return [];
    }
    const items = await expandYoutubeMix({
      ytDlpPath: this.deps.ytDlpPath ?? "yt-dlp",
      videoId,
      limit: 12,
      excludeIdentities,
      signal,
      ...(this.deps.runMixSubprocess === undefined
        ? {}
        : { run: this.deps.runMixSubprocess }),
    });
    return items.map((item) => ({
      source: item.source,
      title: item.title,
    }));
  }

  async fetchSeedCatalogTracks(
    seed: string,
    signal: AbortSignal,
  ): Promise<MusicTrack[]> {
    const catalog = this.deps.music?.catalog;
    if (catalog === undefined) return [];
    const [artistSongs, browsed] = await Promise.all([
      this.safeArtistRecordings(seed, signal),
      this.safeBrowseSongs(seed, signal),
    ]);
    return [...artistSongs.slice(0, 4), ...browsed.slice(0, 4)];
  }

  async safeArtistRecordings(
    artist: string,
    signal: AbortSignal,
  ): Promise<MusicTrack[]> {
    const catalog = this.deps.music?.catalog;
    if (catalog === undefined) return [];
    try {
      return await catalog.artistRecordings(artist, signal, 8);
    } catch {
      return [];
    }
  }

  private async safeBrowseSongs(
    query: string,
    signal: AbortSignal,
  ): Promise<MusicTrack[]> {
    const catalog = this.deps.music?.catalog;
    if (catalog === undefined) return [];
    try {
      const page = await catalog.browse(
        new URLSearchParams({ query, type: "song", limit: "6" }),
        signal,
      );
      return page.items.flatMap((item) =>
        item.track === undefined ? [] : [item.track],
      );
    } catch {
      return [];
    }
  }

  async resolveCatalogTrack(
    track: MusicTrack,
    signal: AbortSignal,
  ): Promise<CuratedStationItem | null> {
    if (
      !validRadioDuration(track.durationSeconds) ||
      isBlockedText(track.title) ||
      track.artists.some((artist) => isBlockedText(artist))
    ) {
      return null;
    }
    const matched = await this.matchViaMusicService(track, signal);
    return (
      matched ??
      (await this.resolveQuery(
        `${track.artists.join(" ")} ${track.title}`,
        signal,
        track,
      ))
    );
  }

  private async matchViaMusicService(
    track: MusicTrack,
    signal: AbortSignal,
  ): Promise<CuratedStationItem | null> {
    if (this.deps.music === undefined) return null;
    try {
      const matches = await this.deps.music.matches(track, signal);
      const valid = matches.find(
        (match) =>
          !isBlockedUrl(match.url) &&
          !isBlockedText(match.title) &&
          validRadioDuration(match.durationSeconds),
      );
      if (valid === undefined) return null;
      const duration = valid.durationSeconds ?? track.durationSeconds;
      return {
        source: musicSource(track, valid.url),
        title: `${track.artists.join(", ")} — ${track.title}`,
        ...(valid.channel === undefined ? {} : { channel: valid.channel }),
        ...(duration === undefined ? {} : { durationSeconds: duration }),
      };
    } catch {
      return null;
    }
  }

  resolveSuggestion(
    suggestion: RadioSuggestionTrack,
    signal: AbortSignal,
  ): Promise<CuratedStationItem | null> {
    return this.resolveQuery(
      `${suggestion.artist} ${suggestion.title}`,
      signal,
    );
  }

  async resolveQuery(
    query: string,
    signal: AbortSignal,
    catalogTrack?: MusicTrack,
  ): Promise<CuratedStationItem | null> {
    const hits = await this.safeSearchYoutube(query, signal, 5);
    const best = hits.toSorted(
      (left, right) =>
        scoreYoutubeResult(right, query) - scoreYoutubeResult(left, query),
    )[0];
    if (best === undefined) return null;
    if (catalogTrack === undefined) return this.fromYoutubeHit(best);
    return {
      source: musicSource(catalogTrack, best.url),
      title: `${catalogTrack.artists.join(", ")} — ${catalogTrack.title}`,
      ...(best.channel === undefined ? {} : { channel: best.channel }),
      ...(best.thumbnailUrl === undefined
        ? {}
        : { thumbnailUrl: best.thumbnailUrl }),
      ...(best.durationSeconds === undefined
        ? {}
        : { durationSeconds: best.durationSeconds }),
    };
  }

  async safeSearchYoutube(
    query: string,
    signal: AbortSignal,
    limit: number,
  ): Promise<YtdlpSearchResult[]> {
    try {
      const results = await this.deps.searchYoutube(query, signal, limit);
      return results.filter(
        (result) =>
          !isBlockedUrl(result.url) &&
          !isBlockedText(result.title) &&
          sportsEventForSource(result.url) === null &&
          validRadioDuration(result.durationSeconds),
      );
    } catch {
      return [];
    }
  }

  fromYoutubeHit(hit: YtdlpSearchResult): CuratedStationItem {
    return {
      source: { kind: "url", url: hit.url, title: hit.title, mode: "music" },
      title: hit.title,
      ...(hit.channel === undefined ? {} : { channel: hit.channel }),
      ...(hit.thumbnailUrl === undefined
        ? {}
        : { thumbnailUrl: hit.thumbnailUrl }),
      ...(hit.durationSeconds === undefined
        ? {}
        : { durationSeconds: hit.durationSeconds }),
    };
  }
}
