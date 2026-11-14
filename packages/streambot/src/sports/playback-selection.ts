import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { sportsEventTimeLabel } from "@shepherdjerred/streambot/sports/parse-events.ts";
import type {
  SportsCatalog,
  SportsEvent,
  SportsProviderPreference,
} from "@shepherdjerred/streambot/sports/types.ts";
import type {
  Source,
  SubtitlePref,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import { isHttpUrl } from "@shepherdjerred/streambot/discord/resolve.ts";
import {
  SportsProOnlyError,
  sportsEventForSource,
} from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import { throwIfSportsRequestAborted } from "@shepherdjerred/streambot/sports/sports-service.ts";
import { hasLolSportsCue } from "./lolesports.ts";
import { redactMediaUrls } from "@shepherdjerred/discord-video-stream";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { SportsPlaybackError, sportsFailureMessage } from "./failures.ts";

const log = logger.child("sports");

/**
 * A watch page identified by origin and path only. A pasted provider URL can carry userinfo,
 * query values, or a fragment that are the requester's, not the provider's.
 */
function loggablePage(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[unparseable page URL]";
  }
}

/**
 * The listener sees bounded failure categories, so the operator log is the
 * only place the real cause (an upstream page redesign, an unapproved CDN host, a probe 403)
 * survives. Signed stream URLs are redacted, and the page is reduced to origin and path.
 */
function logSportsResolveFailure(
  event: { readonly provider: string; readonly pageUrl: string },
  error: unknown,
): void {
  log.warn("sports stream resolve failed", {
    provider: event.provider,
    page: loggablePage(event.pageUrl),
    ...(error instanceof SportsPlaybackError ? { kind: error.kind } : {}),
    error: redactMediaUrls(getErrorMessage(error)),
  });
}

function proOnlyMessage(title: string): string {
  return `${title} is only streaming on StreamEast Pro, which Streambot can't play. Pick a game without the Pro badge.`;
}

export type SportsPlaybackSelection = {
  readonly source: Source;
  readonly preResolved: ResolvedSource;
};

type PlaySource = "auto" | "history" | "local" | "youtube";

export async function assertLolRequestEnabled(input: {
  query: string;
  source: Source | undefined;
  provider: SportsProviderPreference | undefined;
  scope: DiscoveryScope | null;
  gate: MediaFeatureGate["lolEsports"];
}) {
  const requested =
    input.provider === "lolesports" ||
    (input.source?.kind === "url" &&
      (input.source.sportsEvent?.provider === "lolesports" ||
        sportsEventForSource(input.source.url)?.provider === "lolesports")) ||
    (isHttpUrl(input.query) &&
      sportsEventForSource(input.query)?.provider === "lolesports");
  if (
    requested &&
    (input.scope === null || (await input.gate?.(input.scope)) !== true)
  )
    throw new PlaybackCommandBoundaryError("LoL Esports is not enabled here.");
}

function hasSportsCue(query: string, utterance = ""): boolean {
  return (
    /\b(?:sports|nfl|nba|wnba|nhl|mlb|lck|worlds|msi|lpl|lec|lcs|first stand|league of legends)\b/i.test(
      `${query} ${utterance}`,
    ) || /\b[\w.-]+\s+(?:vs\.?|versus)\s+[\w.-]+\b/i.test(query)
  );
}

export function assertSportsSubtitleOptions(
  sports: boolean,
  subtitles: SubtitlePref | undefined,
): void {
  if (sports && subtitles !== undefined) {
    throw new PlaybackCommandBoundaryError(
      "Live sports streams do not support subtitle options yet.",
    );
  }
}

export async function selectDirectRequestUrl(input: {
  readonly query: string;
  /** The listing event when the URL came from a sports listing; a pasted URL has none. */
  readonly listed?: SportsEvent;
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
  if (event.provider === "lolesports")
    throw new PlaybackCommandBoundaryError(
      "Choose this series from the LoL Esports schedule, then play its live listing.",
    );
  if (input.listed?.proOnly === true)
    throw new PlaybackCommandBoundaryError(proOnlyMessage(input.listed.title));
  const source: Source = { kind: "url", url: event.pageUrl, mode: "video" };
  let preResolved: ResolvedSource;
  try {
    preResolved = await input.resolve(source, input.signal);
  } catch (error) {
    throwIfSportsRequestAborted(input.signal);
    logSportsResolveFailure(event, error);
    if (error instanceof SportsPlaybackError)
      throw new PlaybackCommandBoundaryError(sportsFailureMessage(error), {
        cause: error,
      });
    if (error instanceof SportsProOnlyError)
      throw new PlaybackCommandBoundaryError(
        proOnlyMessage(input.listed?.title ?? "That game"),
        { cause: error },
      );
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
    input.source.kind === "url" &&
    input.source.sportsEvent?.provider === "lolesports"
  ) {
    if (input.scope === null || (await input.enabled?.(input.scope)) !== true)
      throw new PlaybackCommandBoundaryError(
        "Sports streams are not enabled here.",
      );
    return {
      source: input.source,
      sports: true,
      preResolved: await input.resolve(input.source, input.signal),
    };
  }
  if (
    input.source.kind !== "url" ||
    sportsEventForSource(input.source.url) === null
  ) {
    return null;
  }
  const listed = input.source.sportsEvent;
  const direct = await selectDirectRequestUrl({
    query: input.source.url,
    ...(listed === undefined ? {} : { listed }),
    spoken: false,
    source: "auto",
    scope: input.scope,
    enabled: input.enabled,
    signal: input.signal,
    resolve: input.resolve,
  });
  return direct?.sports === true ? { ...direct, source: input.source } : null;
}

/**
 * Resolve one listed event: its selection, `"pro-only"` when only subscribers can watch it, or
 * `"failed"` when auto mode may try the next provider. An explicit provider's failure is final.
 */
async function attemptSportsEvent(
  event: SportsEvent,
  input: {
    readonly provider: SportsProviderPreference;
    readonly signal: AbortSignal;
    readonly resolve: (
      source: Source,
      signal: AbortSignal,
    ) => Promise<ResolvedSource>;
  },
): Promise<
  SportsPlaybackSelection | SportsPlaybackError | "pro-only" | "failed"
> {
  if (event.proOnly === true) return "pro-only";
  const source: Source = {
    kind: "url",
    url: event.pageUrl,
    mode: "video",
    sportsEvent: event,
  };
  try {
    return {
      source,
      preResolved: await input.resolve(source, input.signal),
    };
  } catch (error) {
    input.signal.throwIfAborted();
    logSportsResolveFailure(event, error);
    if (error instanceof SportsProOnlyError) return "pro-only";
    if (input.provider !== "auto") {
      throw new PlaybackCommandBoundaryError(
        error instanceof SportsPlaybackError
          ? sportsFailureMessage(error)
          : `I couldn't start the ${event.provider} stream for ${event.title}.`,
        { cause: error },
      );
    }
    return error instanceof SportsPlaybackError ? error : "failed";
  }
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

  let proOnly = 0;
  const failures: (SportsPlaybackError | "failed")[] = [];
  for (const event of result.events) {
    input.signal.throwIfAborted();
    const attempt = await attemptSportsEvent(event, input);
    if (attempt === "pro-only") proOnly += 1;
    else if (attempt === "failed" || attempt instanceof SportsPlaybackError)
      failures.push(attempt);
    else return attempt;
  }
  const first = result.events[0];
  if (first !== undefined && proOnly === result.events.length)
    throw new PlaybackCommandBoundaryError(proOnlyMessage(first.title));
  const typedFailure = failures.find(
    (failure) => failure instanceof SportsPlaybackError,
  );
  if (typedFailure instanceof SportsPlaybackError) {
    const failure = failures.every(
      (item) =>
        item instanceof SportsPlaybackError && item.kind === typedFailure.kind,
    )
      ? typedFailure
      : new SportsPlaybackError("unavailable");
    throw new PlaybackCommandBoundaryError(sportsFailureMessage(failure), {
      cause: failure,
    });
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
  readonly lolEnabled?: MediaFeatureGate["lolEsports"];
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
  if (
    (input.provider ?? "auto") === "auto" &&
    hasLolSportsCue(input.query) &&
    (await input.lolEnabled?.(input.scope)) !== true
  )
    return null;
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
