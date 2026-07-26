import { describe, expect, it } from "bun:test";
import {
  emptyFindingCounts,
  REVIEW_SIGNAL_SCHEMA,
  type ReviewSignalEvent,
} from "@shepherdjerred/code-review";
import { summarizeReviewSignals } from "./review-signals.ts";

function makeEvent(
  overrides: Partial<ReviewSignalEvent> & {
    pr: number;
  },
): ReviewSignalEvent {
  return {
    schema: REVIEW_SIGNAL_SCHEMA,
    ts: "2026-07-25T00:00:00.000Z",
    provider: "codex",
    head_sha: "deadbeef",
    head_pushed_at: null,
    review_state: "reviewing",
    completion_signal: "none",
    latency_s: null,
    findings: emptyFindingCounts(),
    blocking_count: 0,
    unresolved_count: 0,
    gate_wait_s: null,
    timed_out: false,
    stale_reaction: false,
    decision: null,
    ...overrides,
  };
}

describe("summarizeReviewSignals", () => {
  it("returns zeroed buckets for an empty batch", () => {
    const summary = summarizeReviewSignals([]);
    expect(summary).toEqual({
      total: 0,
      byCompletionSignal: {
        "check-run": 0,
        "review-at-head": 0,
        "thumbsup-reaction": 0,
        none: 0,
      },
      reviewedAtHead: 0,
      reviewedNotAtHead: 0,
      findingsTotal: emptyFindingCounts(),
    });
  });

  it("buckets by completion signal, head-confirmation, and severity", () => {
    const events: ReviewSignalEvent[] = [
      // Reviewed exactly at head via a review object — counts as at-head.
      makeEvent({
        pr: 1,
        review_state: "reviewed",
        completion_signal: "review-at-head",
        stale_reaction: false,
        findings: { p0: 1, p1: 0, p2: 2, p3: 0, unknown: 0 },
      }),
      // Clean 👍 reaction confirmed NOT stale — counts as at-head.
      makeEvent({
        pr: 2,
        review_state: "reviewed-clean-reaction",
        completion_signal: "thumbsup-reaction",
        stale_reaction: false,
        findings: emptyFindingCounts(),
      }),
      // Clean 👍 reaction but flagged stale (reviewed commit != head) — NOT at-head.
      makeEvent({
        pr: 3,
        review_state: "reviewed-clean-reaction",
        completion_signal: "thumbsup-reaction",
        stale_reaction: true,
        findings: emptyFindingCounts(),
      }),
      // Still reviewing — no completion yet, NOT at-head.
      makeEvent({
        pr: 4,
        review_state: "reviewing",
        completion_signal: "none",
        stale_reaction: false,
        findings: emptyFindingCounts(),
      }),
      // Errored check-run provider run — NOT at-head (state can't be trusted).
      makeEvent({
        pr: 5,
        review_state: "errored",
        completion_signal: "check-run",
        stale_reaction: false,
        findings: { p0: 0, p1: 1, p2: 0, p3: 0, unknown: 1 },
      }),
    ];

    const summary = summarizeReviewSignals(events);

    expect(summary.total).toBe(5);
    expect(summary.byCompletionSignal).toEqual({
      "check-run": 1,
      "review-at-head": 1,
      "thumbsup-reaction": 2,
      none: 1,
    });
    expect(summary.reviewedAtHead).toBe(2);
    expect(summary.reviewedNotAtHead).toBe(3);
    expect(summary.findingsTotal).toEqual({
      p0: 1,
      p1: 1,
      p2: 2,
      p3: 0,
      unknown: 1,
    });
  });
});
