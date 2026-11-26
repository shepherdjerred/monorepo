import configuration from "#src/configuration.ts";
import type { ScoutRuntimeCapabilities } from "#src/configuration/runtime-role.ts";
import {
  participantCrawlEnabled,
  participantCrawlUtilisationTarget,
} from "#src/config/dynamic.ts";
import { RiotBudgetLedger } from "./client/rate-budget.ts";

/** Whether a process with these capabilities runs the participant crawl's Activity worker. */
export function hostsParticipantCrawl(
  capabilities: Pick<
    ScoutRuntimeCapabilities,
    "temporalWorkers" | "deferredTemporalWorkers"
  >,
): boolean {
  return [
    ...capabilities.temporalWorkers,
    ...capabilities.deferredTemporalWorkers,
  ].includes("crawl");
}

let ledger: RiotBudgetLedger | undefined;

/**
 * The process's one Riot budget ledger, shared by the tracked client
 * (`api.ts`) and the crawl's client (`crawl/crawl-activity.ts`). Sharing it is
 * what lets tracked classes tell the crawl's part of the key-wide count from
 * their own: in a pod that runs the crawl the share is exact, elsewhere it is
 * bounded by the crawl's target while the crawl is on.
 */
export function riotBudgetLedger(): RiotBudgetLedger {
  // The role is read on first use rather than at import, so modules that
  // construct the tracked client at import time do not resolve configuration.
  let attributed: boolean | undefined;
  ledger ??= new RiotBudgetLedger({
    clock: Date.now,
    crawl: {
      target: participantCrawlUtilisationTarget,
      enabled: participantCrawlEnabled,
      get attributed() {
        attributed ??= hostsParticipantCrawl(configuration.runtimeCapabilities);
        return attributed;
      },
    },
  });
  return ledger;
}
