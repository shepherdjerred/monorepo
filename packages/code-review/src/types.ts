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
  /**
   * What the finding says. Without it a consumer is left with a path and a diff
   * anchor, which name a file rather than the problem — so it is populated for
   * BOTH surfaces: parsed out of the persistent issue comment for findings that
   * live there, and parsed from the first comment's body (via
   * {@link ReviewProvider.parseFindingTitle}) for addressable GitHub threads.
   * `null` only when the provider cannot recognise a title.
   */
  title: string | null;
  /**
   * GraphQL node id of the review thread, for consumers that resolve it.
   * `null` for findings parsed out of an issue comment, which are not threads.
   */
  threadId: string | null;
  /**
   * REST id of the issue comment a finding was parsed out of, for consumers
   * that edit it. `null` for real review threads.
   */
  commentId: number | null;
};

/** A provider-authored issue comment used as a review completion signal. */
export type ReviewIssueComment = {
  body: string;
  updatedAt: string | null;
  url: string | null;
  /**
   * REST id of the comment, carried onto every finding parsed out of it so a
   * consumer can address the comment it must edit. `null` when unavailable.
   */
  id: number | null;
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
 * - `issue-comment`: the provider maintains findings in a review issue comment
 *   and posts an independent acknowledgement naming each reviewed head. A
 *   clean review with no acknowledgement falls back to the comment's
 *   `updated_at`, bound against the head's push time (Qodo).
 */
export type CompletionStrategy =
  | { kind: "check-run"; namePattern: RegExp }
  | { kind: "review-at-head"; cleanSignal: "thumbsup-reaction" }
  | {
      kind: "issue-comment";
      marker: string;
      /**
       * A second provider-authored comment, posted only once a re-review of a
       * named commit has finished. The review comment itself cannot carry that
       * signal: providers rewrite its links to the new head within seconds of a
       * push, long before re-reading the code, and providers whose links are
       * PR-relative name no commit at all. Comments containing this marker are
       * read for the commit they name and never for findings.
       */
      acknowledgement: { marker: string };
      /**
       * A placeholder the provider substitutes for its rendered review while a
       * re-review runs. It carries `marker` but declares no findings, so
       * reading it as the review comment fails the gate on a review that has
       * not been written yet. `null` for providers that post no placeholder.
       */
      inProgress: { marker: string } | null;
      /**
       * Parse the findings the provider renders in that comment. Required
       * here rather than optional on the provider: a provider whose findings
       * live in a comment nobody can parse reads as a finding-free review, so
       * the timestamp fallback would call it reviewed and its findings would
       * never reach the gate. Declaring it alongside the strategy makes that
       * combination unrepresentable instead of a fail-open misconfiguration.
       */
      parseFindings: (comment: ReviewIssueComment) => readonly ReviewThread[];
    };

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
  /**
   * Parse the finding's title out of a review thread's first comment body, or
   * `null` when the provider renders no recognisable title. Findings parsed
   * from an issue comment already carry their title; this is what lets an
   * addressable GitHub thread carry one too, which is what makes the two
   * surfaces comparable. `null` for providers that do not render titles.
   */
  parseFindingTitle: ((body: string | null) => string | null) | null;
  /**
   * A stable key identifying the underlying finding, used to collapse the
   * copies a provider posts to more than one surface into a single finding.
   *
   * Returning `null` means "cannot identify this one", and a null key NEVER
   * merges — an unrecognised finding is counted on its own rather than silently
   * folded into another. `null` for providers that post each finding once.
   */
  findingKey: ((thread: ReviewThread) => string | null) | null;
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
