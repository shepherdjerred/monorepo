/**
 * Provider-neutral types for the PR code-review gate.
 *
 * A "review provider" is whatever bot posts code-review feedback on a PR
 * (Greptile, Codex, CodeRabbit, a homegrown reviewer, …). The gate and the
 * pr-babysit bot both reason about the same three things — who authored a
 * review thread, how severe it is, and whether the provider has finished
 * reviewing the head commit — so those live here as one shared vocabulary
 * rather than being re-hardcoded per consumer.
 */

/** Review-comment severities, most-severe first (index 0 = most severe). */
export const REVIEW_SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

/**
 * Coarse review state for a specific head commit:
 * - `reviewing`: the provider has not finished reviewing this commit yet.
 * - `errored`: the provider's review job failed/was cancelled (thread state
 *   cannot be trusted; the reviewer must re-trigger it).
 * - `reviewed`: the provider finished reviewing this commit (with or without
 *   findings). A deliberate skip (nothing reviewable) also lands here.
 */
export type ReviewState = "reviewing" | "reviewed" | "errored";

/** The gate's decision for one evaluation pass. */
export type GateDecision =
  | { state: "waiting"; message: string }
  | { state: "passed"; message: string }
  | { state: "failed"; message: string };

/**
 * A PR review thread, normalised from the GitHub GraphQL `reviewThreads`
 * connection. `priority` is the numeric severity level (0..3, lower = more
 * severe) parsed from the first comment's body via the provider's badge
 * parser, or `null` when the comment carries no severity badge.
 */
export type ReviewThread = {
  authorLogin: string | null;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  url: string | null;
  priority: number | null;
};

/**
 * How the gate learns that a provider has finished reviewing the head commit.
 *
 * - `check-run`: the provider posts a GitHub check-run whose name matches
 *   `namePattern` on every reviewed commit (Greptile with `statusCheck:true`).
 *   The check-run's presence+conclusion IS the completion signal.
 * - `review-at-head`: the provider posts a PR *review* object; it has reviewed
 *   the head once its latest review's `commit_id === head`. Providers in this
 *   mode leave no artifact on a clean PR, so `cleanSignal` says how to detect
 *   "reviewed, nothing to flag" — currently a 👍 reaction from the provider
 *   (Codex).
 */
export type CompletionStrategy =
  | { kind: "check-run"; namePattern: RegExp }
  | { kind: "review-at-head"; cleanSignal: "thumbsup-reaction" };

/**
 * How a provider signals it deliberately skipped review (no reviewable files,
 * too many files, excluded author). Detected on issue-level comments authored
 * by the provider that contain `marker`; the first matching `reasons` entry
 * names the reason. `null` for providers with no skip mechanism.
 */
export type SkipStrategy = {
  marker: string;
  reasons: readonly { readonly match: string; readonly reason: string }[];
};

/** A registered code-review provider. */
export type ReviewProvider = {
  /** Stable id used in config/metrics/logs, e.g. `"greptile"`, `"codex"`. */
  id: string;
  /** Human-facing name for gate messages, e.g. `"Greptile"`, `"Codex"`. */
  displayName: string;
  /**
   * GitHub login tokens this provider posts as, compared after stripping the
   * REST `[bot]` suffix. Matched by case-insensitive substring so both the
   * exact slug and any `-apps`/`-connector` variants resolve.
   */
  authorLogins: readonly string[];
  /** Parse the severity level (0..3) from a review comment body, or null. */
  parseSeverity: (body: string | null) => number | null;
  /** How the gate detects the provider finished reviewing the head commit. */
  completion: CompletionStrategy;
  /** How the provider signals a deliberate skip, or null if it has none. */
  detectSkip: SkipStrategy | null;
};
