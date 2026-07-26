/**
 * GitHub I/O for the review gate and the observability collector. Everything
 * here is provider-parameterised: fetching review threads, resolving whether a
 * provider has reviewed the head commit (check-run vs review-at-head + 👍
 * reaction), and detecting a deliberate skip. Pure decisions stay in
 * `./gate.ts`; this module only reads GitHub.
 */

import {
  arrayField,
  asRecord,
  boolField,
  type CheckConclusion,
  conclusionField,
  GITHUB_API_URL,
  getJsonWithLink,
  graphqlRequest,
  numberField,
  recordField,
  splitRepo,
  stringField,
} from "./github-http.ts";
import { isProviderAuthor } from "./identity.ts";
import type { CompletionSignal } from "./signal.ts";
import type { ReviewProvider, ReviewState, ReviewThread } from "./types.ts";

// ---------------------------------------------------------------------------
// Review threads (provider-agnostic; priority parsed via the active provider)
// ---------------------------------------------------------------------------

const REVIEW_THREADS_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 1) {
            nodes { author { login } url body }
          }
        }
      }
    }
  }
}`;

function parseThreadPage(
  payload: unknown,
  provider: ReviewProvider,
): {
  headRefOid: string | null;
  threads: ReviewThread[];
  hasNextPage: boolean;
  endCursor: string | null;
} {
  const payloadRecord = asRecord(payload);
  const data =
    payloadRecord === null ? null : recordField(payloadRecord, "data");
  const repository = data === null ? null : recordField(data, "repository");
  const pullRequest =
    repository === null ? null : recordField(repository, "pullRequest");
  if (pullRequest === null) {
    throw new Error(
      "GitHub GraphQL response did not include repository.pullRequest",
    );
  }
  const reviewThreads = recordField(pullRequest, "reviewThreads");
  if (reviewThreads === null) {
    throw new Error("GitHub GraphQL response did not include reviewThreads");
  }

  const threads: ReviewThread[] = [];
  for (const rawNode of arrayField(reviewThreads, "nodes")) {
    const node = asRecord(rawNode);
    if (node === null) continue;
    const comments = recordField(node, "comments");
    const commentNodes = comments === null ? [] : arrayField(comments, "nodes");
    const firstComment = asRecord(commentNodes[0]);
    let authorLogin: string | null = null;
    let url: string | null = null;
    let priority: number | null = null;
    if (firstComment !== null) {
      const author = recordField(firstComment, "author");
      authorLogin = author === null ? null : stringField(author, "login");
      url = stringField(firstComment, "url");
      priority = provider.parseSeverity(stringField(firstComment, "body"));
    }
    threads.push({
      authorLogin,
      isResolved: boolField(node, "isResolved"),
      isOutdated: boolField(node, "isOutdated"),
      path: stringField(node, "path"),
      line: numberField(node, "line"),
      url,
      priority,
    });
  }

  const pageInfo = recordField(reviewThreads, "pageInfo");
  return {
    headRefOid: stringField(pullRequest, "headRefOid"),
    threads,
    hasNextPage: pageInfo !== null && boolField(pageInfo, "hasNextPage"),
    endCursor: pageInfo === null ? null : stringField(pageInfo, "endCursor"),
  };
}

export async function fetchReviewThreads(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
}): Promise<{ threads: ReviewThread[]; headRefOid: string | null }> {
  const { owner, name } = splitRepo(input.repo);
  const threads: ReviewThread[] = [];
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
    threads.push(...page.threads);
    if (!page.hasNextPage || page.endCursor === null) break;
    cursor = page.endCursor;
  }
  return { threads, headRefOid };
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

const HEAD_PUSHED_AT_QUERY = `
query($owner: String!, $name: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit {
        pushedDate
      }
    }
  }
}`;

/**
 * The ISO time a commit was PUSHED (GitHub's `Commit.pushedDate`) — the
 * reference point for review-latency and for binding a clean 👍 reaction to the
 * current head. Returns null when GitHub does not report a real push time.
 *
 * We deliberately do NOT fall back to `committedDate`: the committer date is
 * embedded in the commit and can predate the actual push (local delay,
 * cherry-pick, rebase, or reusing an existing commit as the new head). Binding a
 * 👍 to `committedDate` would let a stale reaction created between that embedded
 * date and the real head-update satisfy the gate without a review of the new
 * head. When the push time is unknown, callers treat the reaction as unbound
 * (gate stays `reviewing`) and latency as null — correct-but-unmeasured beats a
 * falsely-bound completion.
 */
export async function fetchHeadPushedAt(input: {
  repo: string;
  sha: string;
  token: string;
}): Promise<string | null> {
  const { owner, name } = splitRepo(input.repo);
  const payload = await graphqlRequest(
    HEAD_PUSHED_AT_QUERY,
    { owner, name, oid: input.sha },
    input.token,
  );
  const payloadRecord = asRecord(payload);
  const data =
    payloadRecord === null ? null : recordField(payloadRecord, "data");
  const repository = data === null ? null : recordField(data, "repository");
  const object = repository === null ? null : recordField(repository, "object");
  if (object === null) return null;
  return stringField(object, "pushedDate");
}

/**
 * The provider's 👍 (`+1`) reaction on the PR issue — the "reviewed clean,
 * nothing to flag" signal for `review-at-head` providers — or null when the
 * provider left none. Returns the reaction's `createdAt` so the caller can
 * bind the (commit-less) reaction to a specific head by timestamp; when the
 * provider reacted more than once the most recent reaction wins.
 * NOTE: the exact surface Codex reacts on is probe-confirmed; issue-level is
 * the documented "react with 👍" location.
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

/**
 * Whether a commit-less 👍 reaction can be trusted as a review OF the current
 * head: it must have been created at/after the head was pushed. A reaction that
 * predates the head push (a leftover from an earlier commit), or any reaction
 * when the push time is unknown or unparseable, is NOT bound to the head.
 */
function reactionBoundToHead(
  reactionCreatedAt: string | null,
  headPushedAt: string | null,
): boolean {
  if (reactionCreatedAt === null || headPushedAt === null) return false;
  const reacted = Date.parse(reactionCreatedAt);
  const pushed = Date.parse(headPushedAt);
  if (!Number.isFinite(reacted) || !Number.isFinite(pushed)) return false;
  return reacted >= pushed;
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
    // would inflate the check-run completion metric and archive a false
    // completion mechanism for every skip, corrupting provider comparisons. The
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
