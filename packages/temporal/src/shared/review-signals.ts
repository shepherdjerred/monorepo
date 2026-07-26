/**
 * Pure aggregation over a batch of `ReviewSignalEvent`s — no I/O, no Sentry,
 * safe to import from a workflow file (see `src/workflows/bundle.test.ts`).
 * Used by the review-signal-collector activity
 * (`src/activities/observe-review-signals.ts`) to log a compact summary of a
 * run, and unit-tested directly with fixture events in
 * `review-signals.test.ts`.
 */

import {
  emptyFindingCounts,
  type CompletionSignal,
  type FindingCounts,
  type ReviewSignalEvent,
} from "@shepherdjerred/code-review";

export type ReviewSignalSummary = {
  total: number;
  byCompletionSignal: Record<CompletionSignal, number>;
  /**
   * "At head" = the provider's completion for this event is confirmed to be for
   * the exact head commit under observation (the event's `reviewed_at_head`
   * flag): a review-at-head, a head-bound 👍, or a completed check-run for the
   * head. Every other case — still `reviewing`, `errored`, an unbound/stale 👍,
   * or a deliberate skip (`reviewed` but not head-bound) — counts toward
   * `reviewedNotAtHead`.
   */
  reviewedAtHead: number;
  reviewedNotAtHead: number;
  findingsTotal: FindingCounts;
};

function emptyCompletionSignalCounts(): Record<CompletionSignal, number> {
  return {
    "check-run": 0,
    "review-at-head": 0,
    "thumbsup-reaction": 0,
    none: 0,
  };
}

function isAtHead(event: ReviewSignalEvent): boolean {
  return event.reviewed_at_head;
}

/** Summarize a batch of review-signal events: counts by completion signal,
 * a head-confirmation split, and total findings by severity. */
export function summarizeReviewSignals(
  events: readonly ReviewSignalEvent[],
): ReviewSignalSummary {
  const summary: ReviewSignalSummary = {
    total: events.length,
    byCompletionSignal: emptyCompletionSignalCounts(),
    reviewedAtHead: 0,
    reviewedNotAtHead: 0,
    findingsTotal: emptyFindingCounts(),
  };

  for (const event of events) {
    summary.byCompletionSignal[event.completion_signal] += 1;
    if (isAtHead(event)) {
      summary.reviewedAtHead += 1;
    } else {
      summary.reviewedNotAtHead += 1;
    }
    summary.findingsTotal.p0 += event.findings.p0;
    summary.findingsTotal.p1 += event.findings.p1;
    summary.findingsTotal.p2 += event.findings.p2;
    summary.findingsTotal.p3 += event.findings.p3;
    summary.findingsTotal.unknown += event.findings.unknown;
  }

  return summary;
}
