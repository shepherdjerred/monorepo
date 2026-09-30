import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { sportsEventTimeLabel } from "@shepherdjerred/streambot/sports/parse-events.ts";
import type {
  SportsCatalog,
  SportsProviderPreference,
} from "@shepherdjerred/streambot/sports/types.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import { isHttpUrl } from "@shepherdjerred/streambot/discord/resolve.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";

export type SportsPlaybackSelection = {
  readonly source: Source;
  readonly preResolved: ResolvedSource;
};

type PlaySource = "auto" | "history" | "local" | "youtube";

function hasSportsCue(query: string, utterance: string | undefined): boolean {
  return /\b(?:vs|versus|game|match|sports|nfl|nba|wnba|nhl|mlb)\b/i.test(
    `${query} ${utterance ?? ""}`,
  );
}

export async function selectDirectRequestUrl(input: {
  readonly query: string;
  readonly spoken: boolean | undefined;
  readonly source: PlaySource;
  readonly scope: DiscoveryScope | null;
  readonly enabled: MediaFeatureGate["sportsStreaming"];
  readonly signal: AbortSignal;
  readonly resolve: (
    source: Source,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
}): Promise<
  | { readonly source: Source; readonly sports: false }
  | (SportsPlaybackSelection & { readonly sports: true })
  | null
> {
  if (input.spoken !== false || !isHttpUrl(input.query)) return null;
  if (input.source === "local" || input.source === "history") {
    throw new PlaybackCommandBoundaryError(
      "A URL cannot use the local or history source.",
    );
  }
  const event = sportsEventForSource(input.query);
  if (event === null) {
    return { source: { kind: "url", url: input.query }, sports: false };
  }
  if (
    input.scope === null ||
    input.enabled === undefined ||
    !(await input.enabled(input.scope))
  ) {
    throw new PlaybackCommandBoundaryError(
      "Sports streams are not enabled here.",
    );
  }
  const source: Source = { kind: "url", url: event.pageUrl, mode: "video" };
  let preResolved: ResolvedSource;
  try {
    preResolved = await input.resolve(source, input.signal);
  } catch (error) {
    input.signal.throwIfAborted();
    throw new PlaybackCommandBoundaryError(
      `I couldn't start the ${event.provider} stream right now. Please try again later.`,
      { cause: error },
    );
  }
  return {
    source,
    sports: true,
    preResolved,
  };
}

export async function selectSportsSourceOverride(input: {
  readonly source: Source;
  readonly scope: DiscoveryScope | null;
  readonly enabled: MediaFeatureGate["sportsStreaming"];
  readonly signal: AbortSignal;
  readonly resolve: (
    source: Source,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
}): Promise<(SportsPlaybackSelection & { readonly sports: true }) | null> {
  if (
    input.source.kind !== "url" ||
    sportsEventForSource(input.source.url) === null
  ) {
    return null;
  }
  const direct = await selectDirectRequestUrl({
    query: input.source.url,
    spoken: false,
    source: "auto",
    scope: input.scope,
    enabled: input.enabled,
    signal: input.signal,
    resolve: input.resolve,
  });
  return direct?.sports === true ? direct : null;
}

export async function selectSportsPlayback(input: {
  readonly query: string;
  readonly provider: SportsProviderPreference;
  readonly signal: AbortSignal;
  readonly catalog: SportsCatalog;
  readonly resolve: (
    source: Source,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  readonly onAmbiguous?: () => void;
}): Promise<SportsPlaybackSelection | null> {
  const result = await input.catalog.search(
    input.query,
    input.provider,
    input.signal,
  );
  if (result.kind === "not-found") return null;
  if (result.kind === "upcoming") {
    throw new PlaybackCommandBoundaryError(
      `${result.event.title} is not live yet (${sportsEventTimeLabel(result.event)}). I won't queue future sports streams.`,
    );
  }
  if (result.kind === "ambiguous") {
    input.onAmbiguous?.();
    throw new PlaybackCommandBoundaryError(
      `I found multiple sports matches: ${result.events
        .slice(0, 3)
        .map((event) => `${event.title} on ${event.provider}`)
        .join("; ")}. Name a provider or be more specific.`,
    );
  }

  for (const event of result.events) {
    input.signal.throwIfAborted();
    const source: Source = {
      kind: "url",
      url: event.pageUrl,
      mode: "video",
    };
    try {
      return {
        source,
        preResolved: await input.resolve(source, input.signal),
      };
    } catch {
      input.signal.throwIfAborted();
      if (input.provider !== "auto") {
        throw new PlaybackCommandBoundaryError(
          `I couldn't start the ${event.provider} stream for ${event.title}.`,
        );
      }
    }
  }
  throw new PlaybackCommandBoundaryError(
    `I found ${result.events[0]?.title ?? input.query}, but its listed providers could not start a stream right now.`,
  );
}

export async function selectSportsForRequest(input: {
  readonly query: string;
  readonly utterance?: string;
  readonly source: PlaySource;
  readonly provider: SportsProviderPreference | undefined;
  readonly scope: DiscoveryScope | null;
  readonly enabled: MediaFeatureGate["sportsStreaming"];
  readonly signal: AbortSignal;
  readonly catalog: SportsCatalog | undefined;
  readonly resolve: (
    source: Source,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  readonly onAmbiguous: () => void;
}): Promise<SportsPlaybackSelection | null> {
  const explicitProvider = input.provider !== undefined;
  if (!explicitProvider && !hasSportsCue(input.query, input.utterance)) {
    return null;
  }
  if (input.source !== "auto") {
    if (explicitProvider) {
      throw new PlaybackCommandBoundaryError(
        "A sports provider requires the auto source.",
      );
    }
    return null;
  }
  if (
    input.scope === null ||
    input.enabled === undefined ||
    !(await input.enabled(input.scope))
  ) {
    if (explicitProvider) {
      throw new PlaybackCommandBoundaryError(
        "Sports streams are not enabled here.",
      );
    }
    return null;
  }
  if (input.catalog === undefined) {
    if (explicitProvider) {
      throw new PlaybackCommandBoundaryError(
        "Sports listings are temporarily unavailable. Please try again later.",
      );
    }
    return null;
  }
  const selected = await selectSportsPlayback({
    query: input.query,
    provider: input.provider ?? "auto",
    signal: input.signal,
    catalog: input.catalog,
    resolve: input.resolve,
    onAmbiguous: input.onAmbiguous,
  });
  if (selected === null && explicitProvider) {
    throw new PlaybackCommandBoundaryError(
      `I couldn't find a sports stream matching ${input.query}.`,
    );
  }
  return selected;
}
