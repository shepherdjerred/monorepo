/**
 * The pure gate decision. Given the resolved review state for the head commit,
 * the PR's review threads, and the active provider, decide whether the gate
 * should pass, keep waiting, or fail. All I/O (fetching check-runs, reviews,
 * reactions, threads) lives in `./github.ts`; this stays pure and
 * fixture-testable — the same philosophy as the original wait-for-greptile
 * `evaluateGate`.
 */

import { isProviderAuthor } from "./identity.ts";
import { severityLabel } from "./severity.ts";
import type {
  GateDecision,
  ReviewProvider,
  ReviewState,
  ReviewThread,
} from "./types.ts";

/**
 * A thread blocks the gate iff it is authored by the active provider, still
 * applies to the latest revision (not resolved, not outdated), and carries a
 * severity at or above (more severe than) the threshold. Threads with no
 * severity badge never block.
 */
export function isBlocking(
  thread: ReviewThread,
  provider: ReviewProvider,
  maxBlockingPriority: number,
): boolean {
  return (
    isProviderAuthor(provider, thread.authorLogin) &&
    !thread.isResolved &&
    !thread.isOutdated &&
    thread.priority !== null &&
    thread.priority <= maxBlockingPriority
  );
}

function describeThread(thread: ReviewThread): string {
  const location =
    thread.path === null
      ? "(general comment)"
      : thread.line === null
        ? thread.path
        : `${thread.path}:${String(thread.line)}`;
  const url = thread.url === null ? "" : ` — ${thread.url}`;
  return `${location}${url}`;
}

export function evaluateGate(input: {
  head: string;
  provider: ReviewProvider;
  reviewState: ReviewState;
  threads: readonly ReviewThread[];
  maxBlockingPriority: number;
  /** Provider skip reason (e.g. "no-reviewable-files"), or null. */
  skipReason?: string | null;
}): GateDecision {
  const { head, provider, reviewState, threads, maxBlockingPriority } = input;
  const skipReason = input.skipReason ?? null;
  const name = provider.displayName;

  if (reviewState === "reviewing") {
    return {
      state: "waiting",
      message: `Waiting for ${name} to finish reviewing ${head}.`,
    };
  }

  if (reviewState === "errored") {
    return {
      state: "failed",
      message:
        `${name}'s review of ${head} did not complete successfully. ` +
        `Re-trigger ${name}, then re-run this step.`,
    };
  }

  const blocking = threads.filter((thread) =>
    isBlocking(thread, provider, maxBlockingPriority),
  );

  if (blocking.length === 0) {
    const prefix =
      skipReason === null
        ? `${name} reviewed ${head}`
        : `${name} skipped review for ${head} (${skipReason})`;
    return {
      state: "passed",
      message:
        `${prefix}; no unresolved ${name} comments at ` +
        `${severityLabel(maxBlockingPriority)} or more severe remain.`,
    };
  }

  const list = blocking
    .map(
      (thread) =>
        `  - ${severityLabel(thread.priority)} ${describeThread(thread)}`,
    )
    .join("\n");
  return {
    state: "failed",
    message:
      `${String(blocking.length)} unresolved ${name} comment(s) on ${head}:\n${list}\n` +
      `Resolve each thread (or push a fix and let ${name} re-review), then re-run this step.`,
  };
}
