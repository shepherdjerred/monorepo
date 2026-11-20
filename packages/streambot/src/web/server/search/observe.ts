import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import { MusicSearchError } from "@shepherdjerred/streambot/music/search-provider.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { withWebSpan } from "@shepherdjerred/streambot/observability/tracing.ts";
import {
  webSearchDurationSeconds,
  webSearchTotal,
  type WebSearchKind,
  type WebSearchOutcome,
  type WebSearchProvider,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import type { Row } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import { WebError } from "@shepherdjerred/streambot/web/server/errors.ts";
import { roundMilliseconds } from "@shepherdjerred/streambot/web/server/telemetry.ts";
import { countBucket } from "./rows.ts";

const log = logger.child("web");

/** One group's rows and, for music, what the provider searched instead of the typed query. */
export type Group = {
  readonly items: Row[];
  readonly correctedQuery?: string | undefined;
};

function failureOutcome(error: unknown, signal: AbortSignal): WebSearchOutcome {
  if (signal.aborted) return "aborted";
  if (error instanceof MusicSearchError)
    return error.failure === "timeout" ? "timeout" : "unavailable";
  if (error instanceof WebError || error instanceof MusicError)
    return error.status >= 500 ? "unavailable" : "error";
  return "error";
}

export type ObservedGroup = {
  readonly kind: WebSearchKind;
  readonly provider: WebSearchProvider;
  readonly signal: AbortSignal;
  readonly work: () => Promise<Group>;
};

/** One span, metric sample and log line per group; the failure still propagates unchanged. */
export async function observeSearch(input: ObservedGroup): Promise<Group> {
  const { kind, provider } = input;
  const started = performance.now();
  return await withWebSpan(
    "streambot.web.search",
    {
      "streambot.web.search.kind": kind,
      "streambot.web.search.provider": provider,
    },
    async (span) => {
      let outcome: WebSearchOutcome = "error";
      let count = 0;
      try {
        const group = await input.work();
        count = group.items.length;
        outcome = count === 0 ? "empty" : "results";
        return group;
      } catch (error) {
        outcome = failureOutcome(error, input.signal);
        throw error;
      } finally {
        webSearchTotal.inc({ kind, provider, outcome });
        webSearchDurationSeconds.observe(
          { kind, provider },
          (performance.now() - started) / 1000,
        );
        span.setAttributes({
          "streambot.web.outcome": outcome,
          "streambot.web.search.results": countBucket(count),
        });
        // Never the query, the corrected query, a title or an id.
        log.info("web search", {
          kind,
          provider,
          results: countBucket(count),
          duration_ms: roundMilliseconds(started),
          outcome,
        });
      }
    },
  );
}
