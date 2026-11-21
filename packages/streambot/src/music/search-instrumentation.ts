import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import {
  MusicSearchError,
  MusicSearchProviders,
  SEARCH_OPERATIONS,
  type MusicSearchProviderName,
  type MusicAlbumDetail,
  type MusicArtistDetail,
  type MusicSearchPage,
  type MusicSearchProvider,
  type MusicSuggestions,
} from "@shepherdjerred/streambot/music/search-provider.ts";
import {
  musicProviderRequestsTotal,
  type MusicProviderOperation,
  type MusicProviderOutcome,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import { withWebSpan } from "@shepherdjerred/streambot/observability/tracing.ts";

function failureOutcome(
  error: unknown,
  signal: AbortSignal,
): MusicProviderOutcome {
  if (signal.aborted) return "aborted";
  if (error instanceof MusicSearchError) {
    if (error.failure === "timeout") return "timeout";
    return error.failure === "invalid_response" ? "invalid" : "unavailable";
  }
  return error instanceof MusicError ? "invalid" : "error";
}

type Call<T> = {
  readonly provider: MusicSearchProvider;
  readonly operation: MusicProviderOperation;
  readonly signal: AbortSignal;
  readonly outcomeOf: (value: T) => MusicProviderOutcome;
  readonly run: () => Promise<T>;
};

/**
 * One span and one counter sample per provider call. The span and labels carry the provider and
 * operation only: never the query, an id or a title.
 */
async function observe<T>(call: Call<T>): Promise<T> {
  const { provider, operation } = call;
  return await withWebSpan(
    "streambot.web.search.provider",
    {
      "streambot.music.provider": provider.name,
      "streambot.music.operation": operation,
    },
    async (span) => {
      let outcome: MusicProviderOutcome = "error";
      try {
        const value = await call.run();
        outcome = call.outcomeOf(value);
        return value;
      } catch (error) {
        outcome = failureOutcome(error, call.signal);
        throw error;
      } finally {
        span.setAttribute("streambot.music.outcome", outcome);
        musicProviderRequestsTotal.inc({
          provider: provider.name,
          operation,
          outcome,
        });
      }
    },
  );
}

const pageOutcome = (page: MusicSearchPage): MusicProviderOutcome =>
  page.items.length === 0 ? "empty" : "ok";

/** Wraps a provider so every call is traced and counted, whichever provider is selected. */
export function instrumentMusicSearch(
  inner: MusicSearchProvider,
): MusicSearchProvider {
  return {
    name: inner.name,
    search: (kind, query, signal) =>
      observe({
        provider: inner,
        operation: SEARCH_OPERATIONS[kind],
        signal,
        outcomeOf: pageOutcome,
        run: () => inner.search(kind, query, signal),
      }),
    suggestions: (prefix, signal) =>
      observe<MusicSuggestions>({
        provider: inner,
        operation: "suggest",
        signal,
        outcomeOf: (value) => {
          if (value.kind === "unsupported") return "unsupported";
          return value.items.length === 0 ? "empty" : "ok";
        },
        run: () => inner.suggestions(prefix, signal),
      }),
    albumTracks: (id, signal) =>
      observe<MusicAlbumDetail>({
        provider: inner,
        operation: "album",
        signal,
        outcomeOf: (value) => (value.tracks.length === 0 ? "empty" : "ok"),
        run: () => inner.albumTracks(id, signal),
      }),
    artistTop: (id, signal) =>
      observe<MusicArtistDetail>({
        provider: inner,
        operation: "artist",
        signal,
        outcomeOf: (value) =>
          value.songs.length + value.albums.length === 0 ? "empty" : "ok",
        run: () => inner.artistTop(id, signal),
      }),
  };
}

/** The provider registry every caller uses: each provider traced and counted, selected per call. */
export function createMusicSearchProviders(
  providers: Readonly<Record<MusicSearchProviderName, MusicSearchProvider>>,
  selected: (scope: DiscoveryScope) => Promise<string>,
): MusicSearchProviders {
  return new MusicSearchProviders(
    {
      "youtube-music": instrumentMusicSearch(providers["youtube-music"]),
      musicbrainz: instrumentMusicSearch(providers.musicbrainz),
    },
    selected,
  );
}
