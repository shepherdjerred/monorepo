import type { LlmRuntime } from "@shepherdjerred/llm-runtime";
import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import type {
  FamiliarMusicCandidate,
  MusicTasteProfile,
} from "@shepherdjerred/streambot/history/taste-profile.ts";
import type { MusicService } from "@shepherdjerred/streambot/music/service.ts";
import type { runSubprocess } from "@shepherdjerred/streambot/sources/subprocess.ts";
import type { YtdlpSearchResult } from "@shepherdjerred/streambot/sources/youtube-search-result.ts";
import {
  createDedupeTracker,
  RadioCandidateResolver,
  type DedupeTracker,
} from "./radio-candidates.ts";
import { suggestRadioTracks } from "./radio-llm.ts";
import type {
  CuratedStationItem,
  StationCurationContext,
  StationCurator,
} from "./station-types.ts";
import { extractYoutubeVideoId } from "./youtube-mix.ts";

const FAMILIAR_RATIO = 0.45;

export const COLD_START_RADIO_QUERIES: readonly string[] = [
  "Daft Punk Instant Crush",
  "Fleetwood Mac Dreams",
  "Khruangbin Time You and I",
  "Gorillaz On Melancholy Hill",
  "Tame Impala Let It Happen",
  "Sade Smooth Operator",
  "OutKast Ms Jackson",
  "The Strokes Reptilia",
];

const EMPTY_TASTE_PROFILE: MusicTasteProfile = {
  familiarCandidates: [],
  topArtists: [],
  topTracks: [],
  skippedTitles: [],
  recentQueries: [],
};

export type RadioCuratorDeps = {
  readonly history?: MediaHistoryStore | undefined;
  readonly historyEnabled?:
    | ((scope: {
        guildId: string;
        channelId: string;
        userId: string;
      }) => Promise<boolean>)
    | undefined;
  readonly music?: MusicService | undefined;
  readonly searchYoutube: (
    query: string,
    signal: AbortSignal,
    limit: number,
  ) => Promise<readonly YtdlpSearchResult[]>;
  readonly ytDlpPath?: string | undefined;
  readonly runMixSubprocess?: typeof runSubprocess | undefined;
  readonly openAiApiKey?: string | undefined;
  readonly llmRuntime?: LlmRuntime | undefined;
  readonly random?: (() => number) | undefined;
};

function toStationItem(candidate: FamiliarMusicCandidate): CuratedStationItem {
  return {
    source: candidate.source,
    title: candidate.title,
    ...(candidate.thumbnailUrl === undefined
      ? {}
      : { thumbnailUrl: candidate.thumbnailUrl }),
    ...(candidate.channel === undefined ? {} : { channel: candidate.channel }),
    ...(candidate.durationSeconds === undefined
      ? {}
      : { durationSeconds: candidate.durationSeconds }),
  };
}

function appendAccepted(
  selected: CuratedStationItem[],
  candidates: readonly CuratedStationItem[],
  tracker: DedupeTracker,
  limit: {
    readonly count: number;
    readonly mode: StationCurationContext["mode"];
  },
): void {
  for (const candidate of candidates) {
    if (selected.length >= limit.count) break;
    const accepted = tracker.accept(candidate, limit.mode);
    if (accepted !== null) selected.push(accepted);
  }
}

export class RadioCurator implements StationCurator {
  private readonly random: () => number;
  private readonly resolver: RadioCandidateResolver;

  constructor(private readonly deps: RadioCuratorDeps) {
    this.random = deps.random ?? Math.random;
    this.resolver = new RadioCandidateResolver({
      music: deps.music,
      searchYoutube: deps.searchYoutube,
      ytDlpPath: deps.ytDlpPath,
      runMixSubprocess: deps.runMixSubprocess,
    });
  }

  async curate(
    context: StationCurationContext,
  ): Promise<readonly CuratedStationItem[]> {
    if (context.count <= 0) return [];
    const profile = await this.loadTasteProfile(context);
    const tracker = createDedupeTracker(context, profile.skippedTitles);

    const seed = context.station.seed?.trim();
    if (seed !== undefined && seed !== "") {
      return await this.curateSeeded({ context, seed, profile, tracker });
    }
    const isEmptyProfile =
      profile.familiarCandidates.length === 0 &&
      profile.topArtists.length === 0 &&
      profile.recentQueries.length === 0;
    return isEmptyProfile
      ? await this.curateColdStart(context, tracker)
      : await this.curatePersonalized(context, profile, tracker);
  }

  private async loadTasteProfile(
    context: StationCurationContext,
  ): Promise<MusicTasteProfile> {
    if (this.deps.history === undefined) return EMPTY_TASTE_PROFILE;
    if (this.deps.historyEnabled !== undefined) {
      const allowed = await this.deps.historyEnabled({
        guildId: context.guildId,
        channelId: context.channelId,
        userId: context.station.ownerId,
      });
      if (!allowed) return EMPTY_TASTE_PROFILE;
    }
    return this.deps.history.musicTasteProfile({
      listenerIds: context.listenerIds,
      ownerId: context.station.ownerId,
      guildId: context.guildId,
      scope: context.station.scope,
      excludeIdentities: context.excludeIdentities,
    });
  }

  private async curatePersonalized(
    context: StationCurationContext,
    profile: MusicTasteProfile,
    tracker: DedupeTracker,
  ): Promise<CuratedStationItem[]> {
    const selected: CuratedStationItem[] = [];
    const familiarBudget = this.computeFamiliarTarget(context.count);
    appendAccepted(
      selected,
      this.pickVariedFamiliar(profile).map((item) => toStationItem(item)),
      tracker,
      { count: familiarBudget, mode: context.mode },
    );

    if (selected.length < context.count) {
      const discovery = await this.gatherDiscoveryCandidates(
        context,
        profile,
        tracker,
      );
      appendAccepted(selected, discovery, tracker, {
        count: context.count,
        mode: context.mode,
      });
    }

    if (selected.length < context.count) {
      appendAccepted(
        selected,
        profile.familiarCandidates.map((item) => toStationItem(item)),
        tracker,
        { count: context.count, mode: context.mode },
      );
    }
    if (selected.length < context.count) {
      const fallback = await this.curateColdStart(
        { ...context, count: context.count - selected.length },
        tracker,
      );
      selected.push(...fallback);
    }
    return selected;
  }

  private async curateSeeded(input: {
    readonly context: StationCurationContext;
    readonly seed: string;
    readonly profile: MusicTasteProfile;
    readonly tracker: DedupeTracker;
  }): Promise<CuratedStationItem[]> {
    const { context, seed, profile, tracker } = input;
    const selected: CuratedStationItem[] = [];
    const directSeedVideoId = extractYoutubeVideoId(seed);
    const limit = { count: context.count, mode: context.mode };

    const [youtubeHits, catalogTracks, llmSuggestions] = await Promise.all([
      directSeedVideoId === null
        ? this.resolver.safeSearchYoutube(seed, context.signal, 8)
        : Promise.resolve([]),
      directSeedVideoId === null
        ? this.resolver.fetchSeedCatalogTracks(seed, context.signal)
        : Promise.resolve([]),
      suggestRadioTracks({
        apiKey: this.deps.openAiApiKey,
        runtime: this.deps.llmRuntime,
        seed,
        topArtists: profile.topArtists,
        topTracks: profile.topTracks,
        recentQueries: profile.recentQueries,
        skippedTitles: profile.skippedTitles,
        excludeWorkKeys: tracker.workKeys,
        signal: context.signal,
      }),
    ]);

    const topHit = youtubeHits[0];
    if (topHit !== undefined) {
      appendAccepted(
        selected,
        [this.resolver.fromYoutubeHit(topHit)],
        tracker,
        limit,
      );
    }

    const mixVideoId =
      directSeedVideoId ??
      (topHit === undefined ? null : extractYoutubeVideoId(topHit.url));
    if (mixVideoId !== null && selected.length < context.count) {
      const mixItems = await this.resolver.expandMix(
        mixVideoId,
        tracker.identities,
        context.signal,
      );
      appendAccepted(selected, mixItems, tracker, limit);
    }

    await this.appendCatalogAndLlm({
      selected,
      catalogTracks,
      llmSuggestions,
      tracker,
      context,
    });
    appendAccepted(
      selected,
      youtubeHits.slice(1).map((hit) => this.resolver.fromYoutubeHit(hit)),
      tracker,
      limit,
    );
    return selected;
  }

  private async appendCatalogAndLlm(input: {
    readonly selected: CuratedStationItem[];
    readonly catalogTracks: Parameters<
      RadioCandidateResolver["resolveCatalogTrack"]
    >[0][];
    readonly llmSuggestions: Parameters<
      RadioCandidateResolver["resolveSuggestion"]
    >[0][];
    readonly tracker: DedupeTracker;
    readonly context: StationCurationContext;
  }): Promise<void> {
    await this.appendResolvedList(
      input.selected,
      input.catalogTracks,
      (track) => this.resolver.resolveCatalogTrack(track, input.context.signal),
      { tracker: input.tracker, context: input.context },
    );
    await this.appendResolvedList(
      input.selected,
      input.llmSuggestions,
      (suggestion) =>
        this.resolver.resolveSuggestion(suggestion, input.context.signal),
      { tracker: input.tracker, context: input.context },
    );
  }

  private async appendResolvedList<T>(
    selected: CuratedStationItem[],
    items: readonly T[],
    resolve: (item: T) => Promise<CuratedStationItem | null>,
    target: {
      readonly tracker: DedupeTracker;
      readonly context: StationCurationContext;
    },
  ): Promise<void> {
    for (const item of items) {
      if (selected.length >= target.context.count) return;
      const resolved = await resolve(item);
      if (resolved !== null) {
        const accepted = target.tracker.accept(resolved, target.context.mode);
        if (accepted !== null) selected.push(accepted);
      }
    }
  }

  private async curateColdStart(
    context: StationCurationContext,
    tracker: DedupeTracker,
  ): Promise<CuratedStationItem[]> {
    const selected: CuratedStationItem[] = [];
    const offset = Math.floor(this.random() * COLD_START_RADIO_QUERIES.length);
    for (let i = 0; i < COLD_START_RADIO_QUERIES.length; i += 1) {
      if (selected.length >= context.count) break;
      const query =
        COLD_START_RADIO_QUERIES[
          (offset + i) % COLD_START_RADIO_QUERIES.length
        ];
      if (query === undefined) continue;
      const resolved = await this.resolver.resolveQuery(query, context.signal);
      if (resolved !== null) {
        const accepted = tracker.accept(resolved, context.mode);
        if (accepted !== null) selected.push(accepted);
      }
    }
    return selected;
  }

  private async gatherDiscoveryCandidates(
    context: StationCurationContext,
    profile: MusicTasteProfile,
    tracker: DedupeTracker,
  ): Promise<CuratedStationItem[]> {
    const mixAnchor = profile.familiarCandidates.find(
      (item) => item.youtubeVideoId !== undefined,
    );
    const primaryArtist = profile.topArtists[0];

    const [mixItems, artistTracks, llmSuggestions] = await Promise.all([
      mixAnchor?.youtubeVideoId === undefined
        ? Promise.resolve([])
        : this.resolver.expandMix(
            mixAnchor.youtubeVideoId,
            tracker.identities,
            context.signal,
          ),
      primaryArtist === undefined
        ? Promise.resolve([])
        : this.resolver.safeArtistRecordings(primaryArtist, context.signal),
      suggestRadioTracks({
        apiKey: this.deps.openAiApiKey,
        runtime: this.deps.llmRuntime,
        topArtists: profile.topArtists,
        topTracks: profile.topTracks,
        recentQueries: profile.recentQueries,
        skippedTitles: profile.skippedTitles,
        excludeWorkKeys: tracker.workKeys,
        signal: context.signal,
      }),
    ]);

    const pool = mixItems.slice(0, 2);
    await this.collectResolvedUpTo(
      pool,
      artistTracks.slice(0, 3),
      (track) => this.resolver.resolveCatalogTrack(track, context.signal),
      context.count + 2,
    );
    await this.collectResolvedUpTo(
      pool,
      llmSuggestions.slice(0, 4),
      (suggestion) =>
        this.resolver.resolveSuggestion(suggestion, context.signal),
      context.count + 3,
    );
    if (pool.length === 0 && profile.recentQueries[0] !== undefined) {
      const fromQuery = await this.resolver.resolveQuery(
        profile.recentQueries[0],
        context.signal,
      );
      if (fromQuery !== null) pool.push(fromQuery);
    }
    return pool;
  }

  private async collectResolvedUpTo<T>(
    pool: CuratedStationItem[],
    items: readonly T[],
    resolve: (item: T) => Promise<CuratedStationItem | null>,
    maxPoolLength: number,
  ): Promise<void> {
    for (const item of items) {
      if (pool.length >= maxPoolLength) return;
      const resolved = await resolve(item);
      if (resolved !== null) pool.push(resolved);
    }
  }

  private computeFamiliarTarget(count: number): number {
    return count === 1
      ? this.random() < FAMILIAR_RATIO
        ? 1
        : 0
      : Math.max(1, Math.round(count * FAMILIAR_RATIO));
  }

  private pickVariedFamiliar(profile: MusicTasteProfile) {
    const pool = profile.familiarCandidates.slice(0, 12);
    if (pool.length <= 1) return pool;
    const start = Math.floor(this.random() * Math.min(pool.length, 4));
    return [...pool.slice(start), ...pool.slice(0, start)];
  }
}
