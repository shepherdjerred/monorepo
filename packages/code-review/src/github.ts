/**
 * GitHub I/O for the review gate and its observability signals. Everything
 * here is provider-parameterised: fetching review threads, resolving whether a
 * provider has reviewed the head commit (check-run vs review-at-head + 👍
 * reaction), and detecting a deliberate skip. Pure decisions stay in
 * `./gate.ts`; this module only reads GitHub.
 */

import {
  arrayField,
  asRecord,
  type CheckConclusion,
  conclusionField,
  GITHUB_API_URL,
  getJsonWithLink,
  graphqlRequest,
  recordField,
  splitRepo,
  stringField,
} from "./github-http.ts";
import { reactionBoundToHead } from "./head-pushed-at.ts";
import {
  fetchLatestProviderIssueComment,
  resolveIssueCommentReview,
} from "./github-issue-comments.ts";
import { ALWAYS_BLOCKING_PRIORITY } from "./gate.ts";
import {
  attributeRaisedInReview,
  type ParsedReviewThread,
  parseThreadPage,
  parseReviewPage,
  type ProviderReview,
  REVIEW_REVIEWS_QUERY,
  REVIEW_THREADS_QUERY,
} from "./github-review-threads.ts";
import { isProviderAuthor } from "./identity.ts";
import { mergeDuplicateFindings } from "./merge-findings.ts";
import type { CompletionSignal } from "./signal.ts";
import type {
  PullRequestAuthor,
  ReviewIssueComment,
  ReviewProvider,
  ReviewState,
  ReviewThread,
} from "./types.ts";
// ---------------------------------------------------------------------------
// Pull-request author
// ---------------------------------------------------------------------------

export function parsePullRequestAuthor(payload: unknown): PullRequestAuthor {
  const pullRequest = asRecord(payload);
  if (pullRequest === null) {
    throw new TypeError("GitHub pull-request response was not an object");
  }
  const user = recordField(pullRequest, "user");
  if (user === null) {
    throw new TypeError(
      'GitHub pull-request response did not include an object field "user"',
    );
  }
  const login = stringField(user, "login");
  if (login === null || login === "") {
    throw new TypeError(
      'GitHub pull-request response did not include a non-empty string field "user.login"',
    );
  }
  const type = stringField(user, "type");
  if (type === null || type === "") {
    throw new TypeError(
      'GitHub pull-request response did not include a non-empty string field "user.type"',
    );
  }
  return { login, type };
}

export async function fetchPullRequestAuthor(input: {
  repo: string;
  number: number;
  token: string;
}): Promise<PullRequestAuthor> {
  const { owner, name } = splitRepo(input.repo);
  const url =
    `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}` +
    `/pulls/${String(input.number)}`;
  const { payload } = await getJsonWithLink(url, input.token);
  return parsePullRequestAuthor(payload);
}
// ---------------------------------------------------------------------------
// Review threads (provider-agnostic; priority parsed via the active provider)
// ---------------------------------------------------------------------------

export async function fetchReviewThreads(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
  /**
   * Issue comment already fetched this poll iteration (see
   * {@link ReviewStateResult.issueComment}). `undefined` means "not fetched",
   * so this function fetches it; `null` means "fetched, none found".
   */
  issueComment?: ReviewIssueComment | null | undefined;
}): Promise<{ threads: ReviewThread[]; headRefOid: string | null }> {
  const { owner, name } = splitRepo(input.repo);
  const parsed: ParsedReviewThread[] = [];
  const providerReviews: ProviderReview[] = [];
  let headRefOid: string | null = null;
  let cursor: string | null = null;
  for (;;) {
    const payload = await graphqlRequest(
      REVIEW_THREADS_QUERY,
      { owner, name, number: input.number, cursor },
      input.token,
    );
    const page = parseThreadPage(payload, input.provider);
    if (page.headRefOid !== null) headRefOid = page.headRefOid;
    parsed.push(...page.threads);
    if (!page.hasNextPage || page.endCursor === null) break;
    cursor = page.endCursor;
  }
  let reviewCursor: string | null = null;
  for (;;) {
    const payload = await graphqlRequest(
      REVIEW_REVIEWS_QUERY,
      { owner, name, number: input.number, cursor: reviewCursor },
      input.token,
    );
    const page = parseReviewPage(payload);
    providerReviews.push(...page.reviews);
    if (!page.hasNextPage || page.endCursor === null) break;
    reviewCursor = page.endCursor;
  }
  // Attribution needs every page: a thread's ordinal is its review's position
  // among all of this provider's reviews, including clean reviews that opened
  // no thread and therefore do not appear in `parsed`.
  const threads: ReviewThread[] = attributeRaisedInReview(
    parsed,
    input.provider,
    ALWAYS_BLOCKING_PRIORITY,
    providerReviews,
  );
  const { completion } = input.provider;
  if (completion.kind === "issue-comment") {
    const comment =
      input.issueComment === undefined
        ? await fetchLatestProviderIssueComment({
            repo: input.repo,
            number: input.number,
            token: input.token,
            provider: input.provider,
          })
        : input.issueComment;
    if (comment !== null) {
      threads.push(...completion.parseFindings(comment));
    }
  }
  return {
    threads: mergeDuplicateFindings(threads, input.provider),
    headRefOid,
  };
}

// ---------------------------------------------------------------------------
// Completion — check-run strategy (Greptile)
// ---------------------------------------------------------------------------

type CheckRunRecord = {
  status: string;
  conclusion: CheckConclusion;
  url: string | null;
  updatedAt: string | null;
};

function parseMatchingCheckRuns(
  payload: unknown,
  pattern: RegExp,
): CheckRunRecord[] {
  const payloadRecord = asRecord(payload);
  if (payloadRecord === null) {
    throw new Error("GitHub check-runs response was not an object");
  }
  const matches: CheckRunRecord[] = [];
  for (const rawItem of arrayField(payloadRecord, "check_runs")) {
    const item = asRecord(rawItem);
    if (item === null) continue;
    const name = stringField(item, "name");
    const status = stringField(item, "status");
    if (name === null || status === null || !pattern.test(name)) continue;
    matches.push({
      status,
      conclusion: conclusionField(stringField(item, "conclusion")),
      url: stringField(item, "html_url"),
      updatedAt:
        stringField(item, "completed_at") ??
        stringField(item, "started_at") ??
        stringField(item, "created_at"),
    });
  }
  return matches;
}

function pickLatestCheck(
  checks: readonly CheckRunRecord[],
): CheckRunRecord | null {
  let chosen: CheckRunRecord | null = null;
  let chosenScore = Number.NEGATIVE_INFINITY;
  for (const check of checks) {
    const parsed = Date.parse(check.updatedAt ?? "");
    const score = Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
    if (chosen === null || score >= chosenScore) {
      chosen = check;
      chosenScore = score;
    }
  }
  return chosen;
}

async function fetchCheckRunState(input: {
  repo: string;
  head: string;
  token: string;
  pattern: RegExp;
}): Promise<{ state: ReviewState; reviewedAt: string | null }> {
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/commits/${encodeURIComponent(input.head)}/check-runs?per_page=100`;
  const matches: CheckRunRecord[] = [];
  while (url !== null) {
    const { payload, linkNext } = await getJsonWithLink(url, input.token);
    matches.push(...parseMatchingCheckRuns(payload, input.pattern));
    url = linkNext;
  }
  const chosen = pickLatestCheck(matches);
  if (chosen?.status !== "completed") {
    return { state: "reviewing", reviewedAt: null };
  }
  const errored = new Set<CheckConclusion>([
    "failure",
    "cancelled",
    "timed_out",
    "startup_failure",
  ]);
  return {
    state: errored.has(chosen.conclusion) ? "errored" : "reviewed",
    reviewedAt: chosen.updatedAt,
  };
}

/** Detect a provider skip-review issue comment; returns the reason or null. */
export async function fetchSkipReason(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
}): Promise<string | null> {
  const skip = input.provider.detectSkip;
  if (skip === null) return null;
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/issues/${String(input.number)}/comments?per_page=100`;
  while (url !== null) {
    const { payload, linkNext } = await getJsonWithLink(url, input.token);
    const comments = Array.isArray(payload) ? payload : [];
    for (const rawItem of comments) {
      const item = asRecord(rawItem);
      if (item === null) continue;
      const user = recordField(item, "user");
      const login = user === null ? null : stringField(user, "login");
      if (!isProviderAuthor(input.provider, login)) continue;
      const body = stringField(item, "body");
      if (body === null) continue;
      if (!body.includes(skip.marker)) continue;
      for (const { match, reason } of skip.reasons) {
        if (body.includes(match)) return reason;
      }
    }
    url = linkNext;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Completion — review-at-head strategy (Codex)
// ---------------------------------------------------------------------------

/** The latest PR review authored by the provider, if any. */
export async function fetchLatestProviderReview(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
}): Promise<{ commitId: string | null; submittedAt: string | null } | null> {
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/pulls/${String(input.number)}/reviews?per_page=100`;
  let latest: { commitId: string | null; submittedAt: string | null } | null =
    null;
  let latestScore = Number.NEGATIVE_INFINITY;
  while (url !== null) {
    const { payload, linkNext } = await getJsonWithLink(url, input.token);
    const reviews = Array.isArray(payload) ? payload : [];
    for (const rawItem of reviews) {
      const item = asRecord(rawItem);
      if (item === null) continue;
      const user = recordField(item, "user");
      const login = user === null ? null : stringField(user, "login");
      if (!isProviderAuthor(input.provider, login)) continue;
      const submittedAt = stringField(item, "submitted_at");
      const score = Date.parse(submittedAt ?? "");
      const normalized = Number.isFinite(score)
        ? score
        : Number.NEGATIVE_INFINITY;
      if (latest === null || normalized >= latestScore) {
        latest = {
          commitId: stringField(item, "commit_id"),
          submittedAt,
        };
        latestScore = normalized;
      }
    }
    url = linkNext;
  }
  return latest;
}

/**
 * The provider's 👍 (`+1`) reaction on the PR issue — the "reviewed clean,
 * nothing to flag" signal for `review-at-head` providers — or null when the
 * provider left none. Returns the reaction's `createdAt` so the caller can
 * bind the (commit-less) reaction to a specific head by timestamp; when the
 * provider reacted more than once the most recent reaction wins.
 *
 * SURFACE: this reads reactions on the PR ISSUE body — confirmed on a live
 * no-findings Codex review (PR #1690, 2026-07-26) to be where Codex attaches
 * its clean-review 👍 (`+1`). Binding that commit-less reaction to the current
 * head (it must post-date the head push) is done separately by
 * `reactionBoundToHead` / `resolveHeadPushedAt` in ./head-pushed-at.ts.
 */
export async function fetchProviderThumbsUp(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
}): Promise<{ createdAt: string | null } | null> {
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/issues/${String(input.number)}/reactions?per_page=100`;
  let latest: { createdAt: string | null } | null = null;
  let latestScore = Number.NEGATIVE_INFINITY;
  while (url !== null) {
    const { payload, linkNext } = await getJsonWithLink(url, input.token);
    const reactions = Array.isArray(payload) ? payload : [];
    for (const rawItem of reactions) {
      const item = asRecord(rawItem);
      if (item === null) continue;
      if (stringField(item, "content") !== "+1") continue;
      const user = recordField(item, "user");
      const login = user === null ? null : stringField(user, "login");
      if (!isProviderAuthor(input.provider, login)) continue;
      const createdAt = stringField(item, "created_at");
      const score = Date.parse(createdAt ?? "");
      const normalized = Number.isFinite(score)
        ? score
        : Number.NEGATIVE_INFINITY;
      if (latest === null || normalized >= latestScore) {
        latest = { createdAt };
        latestScore = normalized;
      }
    }
    url = linkNext;
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Unified completion resolution
// ---------------------------------------------------------------------------

export type ReviewStateResult = {
  state: ReviewState;
  completionSignal: CompletionSignal;
  /** Commit the provider most recently reviewed, when known. */
  reviewedCommit: string | null;
  /** ISO time of that review/reaction, when known. */
  reviewedAt: string | null;
  /**
   * A clean 👍 reaction exists but could not be bound to the current head (it
   * predates the head push, or the push time is unknown), so it did NOT satisfy
   * the gate. Telemetry only — the `state` already reflects the non-pass.
   */
  staleReaction: boolean;
  /**
   * The provider's persistent issue comment, for issue-comment providers only.
   * Carried so `fetchReviewThreads` can reuse this poll iteration's fetch
   * instead of paginating the whole comment history a second time.
   * `undefined` means "not fetched"; `null` means "fetched, none found".
   */
  issueComment?: ReviewIssueComment | null;
  /** Provider skip reason (check-run providers only), or null. */
  skipReason: string | null;
};

/**
 * Resolve whether `provider` has finished reviewing `head`, using the
 * provider's completion strategy. Pure `evaluateGate` consumes the `state` +
 * `skipReason` this returns.
 */
export async function resolveReviewState(input: {
  provider: ReviewProvider;
  repo: string;
  head: string;
  prNumber: number;
  token: string;
  /**
   * ISO time the head commit was pushed (`fetchHeadPushedAt`). Required to bind
   * a commit-less 👍 clean-review reaction to the current head: a reaction that
   * predates the head push — or any reaction when the push time is unknown —
   * cannot be trusted as a review OF this head and must not satisfy the gate.
   */
  headPushedAt: string | null;
}): Promise<ReviewStateResult> {
  const { provider, repo, head, prNumber, token, headPushedAt } = input;

  if (provider.completion.kind === "issue-comment") {
    return resolveIssueCommentReview({
      provider,
      repo,
      head,
      prNumber,
      token,
      headPushedAt,
    });
  }

  if (provider.completion.kind === "check-run") {
    const { state, reviewedAt } = await fetchCheckRunState({
      repo,
      head,
      token,
      pattern: provider.completion.namePattern,
    });
    if (state !== "reviewing") {
      return {
        state,
        completionSignal: "check-run",
        reviewedCommit: state === "reviewed" ? head : null,
        reviewedAt,
        staleReaction: false,
        skipReason: null,
      };
    }
    // No completed check-run yet — the provider may have skipped review.
    const skipReason = await fetchSkipReason({
      repo,
      number: prNumber,
      token,
      provider,
    });
    // A skip is `reviewed` (nothing to review) but is NOT a check-run
    // completion — no check-run ran for this head. Reporting `check-run` here
    // would mislabel the completion mechanism for every skip, corrupting
    // provider comparisons. The
    // completion signal stays `none`; `skipReason` carries the real reason.
    return {
      state: skipReason === null ? "reviewing" : "reviewed",
      completionSignal: "none",
      reviewedCommit: null,
      reviewedAt: null,
      staleReaction: false,
      skipReason,
    };
  }

  // review-at-head (Codex): reviewed iff the latest review is at head; else a
  // 👍 reaction means reviewed-clean.
  const review = await fetchLatestProviderReview({
    repo,
    number: prNumber,
    token,
    provider,
  });
  if (review !== null && review.commitId === head) {
    return {
      state: "reviewed",
      completionSignal: "review-at-head",
      reviewedCommit: head,
      reviewedAt: review.submittedAt,
      staleReaction: false,
      skipReason: null,
    };
  }
  const thumbsUp = await fetchProviderThumbsUp({
    repo,
    number: prNumber,
    token,
    provider,
  });
  // A 👍 reaction carries no commit SHA, so it only counts as "reviewed clean
  // at head" when it can be independently tied to the current head: the
  // reaction must have been created at/after the head was pushed. A reaction
  // that predates the head push (a leftover 👍 from an earlier commit) — or any
  // reaction when the push time is unknown — leaves the gate `reviewing` so a
  // new head cannot pass before the provider re-reviews it. Such a reaction is
  // still reported via `staleReaction` for telemetry.
  if (thumbsUp !== null) {
    if (reactionBoundToHead(thumbsUp.createdAt, headPushedAt)) {
      return {
        state: "reviewed",
        completionSignal: "thumbsup-reaction",
        reviewedCommit: head,
        reviewedAt: thumbsUp.createdAt,
        staleReaction: false,
        skipReason: null,
      };
    }
    return {
      state: "reviewing",
      completionSignal: "none",
      reviewedCommit: review?.commitId ?? null,
      reviewedAt: review?.submittedAt ?? null,
      staleReaction: true,
      skipReason: null,
    };
  }
  return {
    state: "reviewing",
    completionSignal: "none",
    reviewedCommit: review?.commitId ?? null,
    reviewedAt: review?.submittedAt ?? null,
    staleReaction: false,
    skipReason: null,
  };
}
