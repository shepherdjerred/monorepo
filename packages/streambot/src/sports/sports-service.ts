import { scoreLibraryTitle } from "@shepherdjerred/streambot/sources/library.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import {
  parseStreamEastEvents,
  parseTVSportsLiveEvents,
  sortSportsEvents,
  STREAMEAST_HOME,
  TVSPORTSLIVE_HOME,
} from "@shepherdjerred/streambot/sports/parse-events.ts";
import type {
  SportsCatalog,
  SportsEvent,
  SportsProvider,
  SportsSearchResult,
} from "@shepherdjerred/streambot/sports/types.ts";
import type { SportsPageRenderer } from "@shepherdjerred/streambot/sports/pinchtab.ts";

const PROVIDER_ORDER: readonly SportsProvider[] = [
  "streameast",
  "tvsportslive",
];

function providerRank(provider: SportsProvider): number {
  return PROVIDER_ORDER.indexOf(provider);
}

function normalizedTitle(title: string): string {
  return title
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function sportsRequestTimedOut(signal: AbortSignal): boolean {
  return (
    signal.aborted &&
    signal.reason instanceof Error &&
    signal.reason.name === "TimeoutError"
  );
}

export function throwIfSportsRequestAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (sportsRequestTimedOut(signal)) {
    throw new PlaybackCommandBoundaryError(
      "The sports provider took too long. Please try again later.",
      { cause: signal.reason },
    );
  }
  signal.throwIfAborted();
}

export function matchSportsEvents(
  query: string,
  events: readonly SportsEvent[],
  provider: SportsProvider | "auto",
): SportsSearchResult {
  const ranked = events
    .filter((event) => provider === "auto" || event.provider === provider)
    .map((event) => ({ event, score: scoreLibraryTitle(event.title, query) }))
    .filter(({ score }) => score >= 55)
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        providerRank(left.event.provider) -
          providerRank(right.event.provider) ||
        left.event.title.localeCompare(right.event.title),
    );
  const first = ranked[0];
  if (first === undefined) return { kind: "not-found" };
  const sameEvent = ranked.filter(
    ({ event }) =>
      normalizedTitle(event.title) === normalizedTitle(first.event.title),
  );
  const secondDistinct = ranked.find(
    ({ event }) =>
      normalizedTitle(event.title) !== normalizedTitle(first.event.title),
  );
  if (
    secondDistinct !== undefined &&
    first.score < 94 &&
    first.score - secondDistinct.score < 7
  ) {
    return {
      kind: "ambiguous",
      events: ranked.slice(0, 5).map(({ event }) => event),
    };
  }
  const candidates = sameEvent
    .map(({ event }) => event)
    .toSorted(
      (left, right) =>
        providerRank(left.provider) - providerRank(right.provider),
    );
  // TvSportsLive's feed does not supply kickoff times. Let its unknown-time
  // posts reach the resolver, which verifies real A/V before playback. A
  // definitely scheduled StreamEast event must still remain upcoming.
  const playable = candidates.filter((event) => event.status !== "scheduled");
  if (playable.length > 0) return { kind: "found", events: playable };
  return candidates[0]?.status === "scheduled"
    ? { kind: "upcoming", event: candidates[0] }
    : { kind: "found", events: candidates };
}

export class SportsService implements SportsCatalog {
  constructor(private readonly browser: SportsPageRenderer) {}

  async listToday(signal: AbortSignal): Promise<readonly SportsEvent[]> {
    throwIfSportsRequestAborted(signal);
    const results = await Promise.allSettled([
      this.browser.html(STREAMEAST_HOME, signal),
      this.browser.html(TVSPORTSLIVE_HOME, signal),
    ]);
    // A slow provider must not discard games already returned by the other.
    // Explicit cancellation still stops the request, even with partial results.
    if (!sportsRequestTimedOut(signal)) throwIfSportsRequestAborted(signal);
    const streamEast = results[0];
    const tvSportsLive = results[1];
    const events = sortSportsEvents([
      ...(streamEast.status === "fulfilled"
        ? parseStreamEastEvents(streamEast.value)
        : []),
      ...(tvSportsLive.status === "fulfilled"
        ? parseTVSportsLiveEvents(tvSportsLive.value)
        : []),
    ]);
    if (events.length === 0) throwIfSportsRequestAborted(signal);
    if (
      streamEast.status === "rejected" &&
      tvSportsLive.status === "rejected"
    ) {
      throw new PlaybackCommandBoundaryError(
        "Sports listings are temporarily unavailable. Please try again later.",
        {
          cause: new AggregateError(
            [streamEast.reason, tvSportsLive.reason],
            "Both sports providers failed",
          ),
        },
      );
    }
    return events;
  }

  async search(
    query: string,
    provider: SportsProvider | "auto",
    signal: AbortSignal,
  ): Promise<SportsSearchResult> {
    const events = await this.listToday(signal);
    return matchSportsEvents(query, events, provider);
  }
}
