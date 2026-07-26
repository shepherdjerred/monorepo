/**
 * The shared observability event describing "what the review provider did on
 * this PR, and when". The CI gate emits these as structured logs per poll +
 * terminal decision; the durable temporal collector emits the same shape into
 * metrics + S3. One schema everywhere → comparable data.
 */

import { z } from "zod";

export const REVIEW_SIGNAL_SCHEMA = "review-signal/v1";

/** How completion was detected for this observation. */
export const CompletionSignalSchema = z.enum([
  "check-run",
  "review-at-head",
  "thumbsup-reaction",
  "none",
]);
export type CompletionSignal = z.infer<typeof CompletionSignalSchema>;

/** Finding counts by severity level for one PR/head. */
export const FindingCountsSchema = z.object({
  p0: z.number().int().nonnegative(),
  p1: z.number().int().nonnegative(),
  p2: z.number().int().nonnegative(),
  p3: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});
export type FindingCounts = z.infer<typeof FindingCountsSchema>;

export const ReviewSignalEventSchema = z.object({
  schema: z.literal(REVIEW_SIGNAL_SCHEMA),
  /** ISO timestamp the observation was stamped (caller-provided). */
  ts: z.string(),
  /** Provider id (`greptile` | `codex` | …). */
  provider: z.string(),
  pr: z.number().int().positive(),
  head_sha: z.string(),
  /** ISO time the head commit was pushed, when known (for latency). */
  head_pushed_at: z.string().nullable(),
  review_state: z.enum([
    "reviewing",
    "reviewed",
    "reviewed-clean-reaction",
    "errored",
  ]),
  completion_signal: CompletionSignalSchema,
  /** Seconds from head-commit push to the review/👍, when both are known. */
  latency_s: z.number().nullable(),
  findings: FindingCountsSchema,
  blocking_count: z.number().int().nonnegative(),
  unresolved_count: z.number().int().nonnegative(),
  /** Total seconds the gate waited (gate only; null for the collector). */
  gate_wait_s: z.number().nullable(),
  timed_out: z.boolean(),
  /** A 👍 clean signal exists but the reviewed commit != current head. */
  stale_reaction: z.boolean(),
  /** Terminal gate decision, when this event is a decision (else null). */
  decision: z.enum(["waiting", "passed", "failed"]).nullable(),
});
export type ReviewSignalEvent = z.infer<typeof ReviewSignalEventSchema>;

/** Zero finding counts — a convenient starting point for callers. */
export function emptyFindingCounts(): FindingCounts {
  return { p0: 0, p1: 0, p2: 0, p3: 0, unknown: 0 };
}

function findingKey(level: number | null): keyof FindingCounts {
  if (level === 0) return "p0";
  if (level === 1) return "p1";
  if (level === 2) return "p2";
  if (level === 3) return "p3";
  return "unknown";
}

/**
 * Tally finding counts from parsed severity levels (0..3, or null → unknown).
 */
export function tallyFindings(
  levels: readonly (number | null)[],
): FindingCounts {
  const counts = emptyFindingCounts();
  for (const level of levels) {
    counts[findingKey(level)] += 1;
  }
  return counts;
}

/**
 * Render a signal event as a single structured log line with a stable
 * `component`, ready for Loki. `component` defaults to the CI gate; the
 * collector passes its own.
 */
export function formatSignalEvent(
  event: ReviewSignalEvent,
  component = "review-gate",
): string {
  return JSON.stringify({
    level: "info",
    msg: "review-signal",
    component,
    ...event,
  });
}
