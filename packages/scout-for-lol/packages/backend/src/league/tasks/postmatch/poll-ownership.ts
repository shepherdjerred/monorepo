import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { matchHistoryPollingSkipsTotal } from "#src/metrics/index.ts";
import {
  claimPostMatchPoll,
  type PostMatchPollOwner,
} from "#src/league/tasks/recovery/app-state.ts";

/**
 * Who may run a post-match poll, and for how long they hold it.
 *
 * Two guards live here because they answer the same question over different
 * spans. The in-process flag serializes the poll passes inside ONE worker and
 * lasts exactly as long as the call; the durable claim on `BotState` serializes
 * them across workers and lasts as long as the discovery Workflow that took it. Keeping them together is what stops a caller
 * taking one and believing it has the other.
 */

const logger = createLogger("postmatch-poll-ownership");

let isPollingInProgress = false;
let pollingStartTime: number | undefined;

export const isMatchHistoryPollingInProgress = (): boolean =>
  isPollingInProgress;

export function resetPollingState(): void {
  isPollingInProgress = false;
  pollingStartTime = undefined;
}

/**
 * Take the in-process polling flag, or refuse because a pass already holds it.
 *
 * The five-minute valve is for a pass whose process survived but whose call
 * did not release the flag — a bug, or a kill between the guard and the
 * `finally`. It is deliberately shorter than the durable claim's bound,
 * because it guards one call rather than a durable run.
 */
export function beginPollingRun(startedAt: Date): boolean {
  if (isPollingInProgress) {
    const elapsed =
      pollingStartTime === undefined ? 0 : Date.now() - pollingStartTime;
    if (elapsed <= 5 * 60 * 1000) {
      logger.info(
        `⏸️  Match history polling already in progress (${Math.round(elapsed / 1000).toString()}s elapsed), skipping this run`,
      );
      matchHistoryPollingSkipsTotal.inc({ reason: "concurrent_run" });
      return false;
    }
    logger.error(
      `⚠️  Polling lock timeout detected after ${Math.round(elapsed / 1000).toString()}s, force-resetting stale lock`,
    );
    matchHistoryPollingSkipsTotal.inc({ reason: "timeout_reset" });
    Sentry.captureMessage("Match history polling lock timeout - force reset", {
      level: "warning",
      tags: { source: "match-history-polling" },
      extra: { elapsedMs: elapsed },
    });
  }
  isPollingInProgress = true;
  pollingStartTime = startedAt.getTime();
  return true;
}

/** Release the in-process flag. The durable claim is released by the close. */
export function endPollingRun(): void {
  resetPollingState();
}

/**
 * Take the durable poll claim, or report who holds it.
 *
 * The poll spans a discovery Workflow: discovery, the children it awaits, and
 * the maintenance that closes it. The in-process flag cannot span that — it is
 * released when the discovery Activity returns — so the pass takes a durable
 * claim and hands its identity to the caller, which carries it to the close.
 */
export type OpenedPoll =
  | { outcome: "held"; since: Date | null }
  | { outcome: "opened"; owner: PostMatchPollOwner };

export async function openPostMatchPoll(startedAt: Date): Promise<OpenedPoll> {
  const claim = await claimPostMatchPoll({ startedAt });
  return claim.outcome === "claimed"
    ? { outcome: "opened", owner: claim.owner }
    : { outcome: "held", since: claim.since };
}
