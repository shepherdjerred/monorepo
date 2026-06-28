/**
 * Pure "definition of done" classifiers for the PR babysitter.
 *
 * Given already-fetched GitHub data, decide whether CI is green (ignoring soft
 * Buildkite failures) and whether review threads are resolved (no unresolved
 * P3-or-higher comment). The fetch/orchestration lives in the activity
 * (`activities/pr-babysit/evaluate-dod.ts`); keeping the decision logic pure
 * here makes it replay-safe and fixture-testable — the same philosophy as the
 * existing merge-tree conflict check.
 */
import {
  REVIEW_SEVERITIES,
  SOFT_FAILURE_CONTEXT_SUBSTRINGS,
  type CiVerdict,
  type ConflictVerdict,
  type PrState,
  type ReviewSeverity,
  type ReviewVerdict,
  type UnresolvedThread,
} from "./types.ts";

/** GitHub login of the Greptile review app (comments may have a `[bot]` suffix). */
export const GREPTILE_LOGIN_SUBSTRING = "greptile";

/** A check context is a SOFT failure (ignored) when its name matches policy. */
export function isSoftFailureContext(name: string): boolean {
  const lower = name.toLowerCase();
  return SOFT_FAILURE_CONTEXT_SUBSTRINGS.some((s) => lower.includes(s));
}

/**
 * One normalized check, as produced by `gh pr checks --json name,state,bucket`.
 * `bucket` is gh's coarse rollup: pass | fail | pending | skipping | cancel.
 */
export type NormalizedCheck = {
  name: string;
  bucket: string;
};

/**
 * Classify checks into a CI verdict. Soft-failure contexts that fail are moved
 * to `ignoredSoft` and never block. `green` requires at least one reported check
 * plus no non-soft failing or pending checks. An empty check set (none reported
 * yet — e.g. right after a push, before contexts register) is flagged
 * `noChecksReported` and is never green, so the DoD can't read "done" before CI
 * has started. A `cancel` bucket counts as failing (not green) — a cancelled
 * required check is not a pass.
 */
export function classifyChecks(checks: readonly NormalizedCheck[]): CiVerdict {
  const failing: string[] = [];
  const pending: string[] = [];
  const ignoredSoft: string[] = [];
  for (const check of checks) {
    const bucket = check.bucket.toLowerCase();
    if (bucket === "pass" || bucket === "skipping") {
      continue;
    }
    if (bucket === "pending") {
      pending.push(check.name);
      continue;
    }
    // fail | cancel | anything else → a non-pass terminal state.
    if (isSoftFailureContext(check.name)) {
      ignoredSoft.push(check.name);
    } else {
      failing.push(check.name);
    }
  }
  const noChecksReported = checks.length === 0;
  return {
    green: !noChecksReported && failing.length === 0 && pending.length === 0,
    failing: failing.toSorted(),
    pending: pending.toSorted(),
    ignoredSoft: ignoredSoft.toSorted(),
    noChecksReported,
  };
}

const SEVERITY_RE = /\bP([0-3])\b/g;

/**
 * Parse the most-severe `P0`–`P3` token from a comment body (lower number =
 * more severe). Returns undefined when no severity token is present.
 */
export function parseReviewSeverity(
  body: string | null | undefined,
): ReviewSeverity | undefined {
  if (typeof body !== "string" || body.length === 0) {
    return undefined;
  }
  let best: number | undefined;
  for (const match of body.matchAll(SEVERITY_RE)) {
    const n = Number(match[1]);
    if (best === undefined || n < best) {
      best = n;
    }
  }
  if (best === undefined) {
    return undefined;
  }
  return REVIEW_SEVERITIES[best];
}

export function isGreptileAuthor(login: string | null | undefined): boolean {
  return (
    typeof login === "string" &&
    login.toLowerCase().includes(GREPTILE_LOGIN_SUBSTRING)
  );
}

/** True when `severity` is at or above (more/equally severe as) `threshold`. */
export function severityBlocks(
  severity: ReviewSeverity,
  threshold: ReviewSeverity,
): boolean {
  return (
    REVIEW_SEVERITIES.indexOf(severity) <= REVIEW_SEVERITIES.indexOf(threshold)
  );
}

/** A normalized review thread, as read from the GraphQL `reviewThreads` query. */
export type NormalizedReviewThread = {
  id: string;
  isResolved: boolean;
  author: string | null;
  body: string | null;
  url?: string;
};

function snippetOf(body: string | null): string {
  if (typeof body !== "string") {
    return "";
  }
  const firstLine = body.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.trim().slice(0, 200);
}

function toUnresolved(thread: NormalizedReviewThread): UnresolvedThread {
  const severity = parseReviewSeverity(thread.body);
  const base: UnresolvedThread = {
    threadId: thread.id,
    author: thread.author ?? "unknown",
    isGreptile: isGreptileAuthor(thread.author),
    snippet: snippetOf(thread.body),
    ...(severity === undefined ? {} : { severity }),
    ...(thread.url === undefined ? {} : { url: thread.url }),
  };
  return base;
}

/**
 * Classify review threads. An unresolved thread BLOCKS the DoD when it carries
 * a severity at/above the threshold (default P3 — i.e. "P3 or higher"). Threads
 * that are unresolved but carry no severity (or one below the threshold) are
 * surfaced as `advisory` so a human sees them, but do not block — this prevents
 * the loop from getting stuck on un-severitied nits.
 */
export function classifyReviewThreads(
  threads: readonly NormalizedReviewThread[],
  blockingSeverity: ReviewSeverity,
): ReviewVerdict {
  const blocking: UnresolvedThread[] = [];
  const advisory: UnresolvedThread[] = [];
  for (const thread of threads) {
    if (thread.isResolved) {
      continue;
    }
    const unresolved = toUnresolved(thread);
    if (
      unresolved.severity !== undefined &&
      severityBlocks(unresolved.severity, blockingSeverity)
    ) {
      blocking.push(unresolved);
    } else {
      advisory.push(unresolved);
    }
  }
  return { allResolved: blocking.length === 0, blocking, advisory };
}

/** The DoD is met only when CI is green, no conflicts, no blocking threads, PR open. */
export function computeDodMet(
  ci: CiVerdict,
  conflicts: ConflictVerdict,
  reviews: ReviewVerdict,
  prState: PrState,
): boolean {
  return (
    prState === "open" && ci.green && conflicts.clean && reviews.allResolved
  );
}
