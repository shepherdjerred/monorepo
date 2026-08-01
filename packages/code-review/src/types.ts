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

/** GitHub's validated author identity for a pull request. */
export type PullRequestAuthor = {
  login: string;
  type: string;
};

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

/**
 * How to explicitly ask a provider to (re-)review the current head, or `null`
 * when the provider reviews automatically and needs no trigger comment.
 *
 * `buildComment` receives an idempotency `marker` that the caller must include
 * verbatim in the posted comment body; a caller suppresses a duplicate request
 * for the same head by checking whether that marker already appears on the PR.
 */
export type ReviewRequestStrategy = {
  buildComment: (marker: string) => string;
};

/** A registered code-review provider. */
export type ReviewProvider = {
  /** Stable id used in config/metrics/logs, e.g. `"greptile"`, `"codex"`. */
  id: string;
  /** Human-facing name for gate messages, e.g. `"Greptile"`, `"Codex"`. */
  displayName: string;
  /**
   * Whether bot-authored pull requests need this provider's normal review.
   * `skip` is an explicit provider capability for reviewers that cannot emit
   * a completion signal for GitHub bot authors; providers default closed by
   * having to declare `review`.
   */
  botAuthoredPullRequestPolicy: "review" | "skip";
  /**
   * The complete GitHub login(s) this provider posts as (the GraphQL bare slug,
   * e.g. `greptile-apps` / `chatgpt-codex-connector`). Matched EXACTLY
   * (case-insensitive) after stripping the REST `[bot]` suffix — never by
   * substring, so a look-alike login cannot impersonate the provider.
   */
  authorLogins: readonly string[];
  /** Parse the severity level (0..3) from a review comment body, or null. */
  parseSeverity: (body: string | null) => number | null;
  /** How the gate detects the provider finished reviewing the head commit. */
  completion: CompletionStrategy;
  /** How the provider signals a deliberate skip, or null if it has none. */
  detectSkip: SkipStrategy | null;
  /**
   * How to explicitly request a head review, or `null` when the provider
   * reviews automatically. Consumers that trigger reviews (e.g. the PR-fleet
   * controller after publishing a fix) must use this rather than hard-coding a
   * single provider's mention, so requesting the wrong bot cannot happen.
   */
  requestReview: ReviewRequestStrategy | null;
};
