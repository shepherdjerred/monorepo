import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { matchHistoryPollingSkipsTotal } from "#src/metrics/index.ts";
import {
  claimPostMatchPoll,
  markPostMatchPollStarted,
  type PostMatchPollOwner,
} from "#src/league/tasks/recovery/app-state.ts";

/**
 * Who may run a post-match poll, and for how long they hold it.
 *
 * Two guards live here because they answer the same question over different
 * spans. The in-process flag serializes the poll passes inside ONE worker and
 * lasts exactly as long as the call; the durable claim on `BotState` serializes
 * them across workers and lasts as long as the run that took it, which for a V2
 * discovery is a whole Workflow. Keeping them together is what stops a caller
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
 * How a pass takes the poll, and therefore how long the poll is held.
 *
 * `process` is v1's: the in-process flag guards the pass, and the poll row is
 * opened unconditionally — v1 has never needed the row to refuse it, because
 * its poll and the maintenance that closes it are one Activity. Unchanged,
 * deliberately: a v1 poll whose worker dies mid-pass must be free to run again
 * on the next Schedule tick, and a durable claim it never released would
 * refuse it for as long as the claim stood.
 *
 * `durable` is V2's, where the poll spans a Workflow: discovery, the children
 * it awaits, and the maintenance that closes it. The in-process flag cannot
 * span that — it is released when the discovery Activity returns — so the pass
 * takes a durable claim instead and hands its identity to the caller, which
 * carries it through to the close.
 */
export type PostMatchPollOwnership = "process" | "durable";

export type OpenedPoll =
  | { outcome: "held"; since: Date | null }
  | { outcome: "opened"; owner: PostMatchPollOwner | undefined };

export async function openPostMatchPoll(
  ownership: PostMatchPollOwnership,
  startedAt: Date,
): Promise<OpenedPoll> {
  if (ownership === "process") {
    await markPostMatchPollStarted(startedAt);
    return { outcome: "opened", owner: undefined };
  }
  const claim = await claimPostMatchPoll({ startedAt });
  return claim.outcome === "claimed"
    ? { outcome: "opened", owner: claim.owner }
    : { outcome: "held", since: claim.since };
}
