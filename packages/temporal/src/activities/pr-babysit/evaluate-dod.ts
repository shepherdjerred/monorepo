/**
 * `evaluateBabysitDoD` — the deterministic gate. Reads CI status, runs a REAL
 * local merge-tree against the base branch (never the gh `mergeable` field —
 * the same source of truth as `check-pr-merge-conflicts`), and reads review
 * threads, then composes a `BabysitVerdict` via the pure `dod.ts` classifiers.
 *
 * It runs against the persistent workdir the babysitter already has checked out
 * on the PR branch, so the conflict check needs no fresh clone.
 */
import { parseConflictPaths } from "#activities/check-pr-merge-conflicts-git.ts";
import {
  classifyChecks,
  classifyReviewThreads,
  computeDodMet,
  type NormalizedCheck,
} from "#shared/pr-babysit/dod.ts";
import {
  type BabysitVerdict,
  type CiVerdict,
  type ConflictVerdict,
  type ReviewSeverity,
} from "#shared/pr-babysit/types.ts";
import { capture, run } from "./exec.ts";
import {
  getChecks,
  getPrSnapshot,
  getRequiredCheckContexts,
  getReviewThreads,
  type RequiredChecksResult,
} from "./github.ts";

/** Sentinel kept in `missingRequired` when required checks can't be determined. */
const REQUIRED_CHECKS_UNKNOWN = "(required checks could not be determined)";

/**
 * Required contexts the babysitter does NOT fold into the CI gate because it
 * tracks them through dedicated signals: merge-conflict via the local
 * merge-tree, and the Greptile review gate via review-thread resolution. A
 * required context matching any of these is excluded; the remainder (e.g. the
 * build-completion aggregate) must be present-and-passing for `ci.green`.
 */
function isBabysitterTrackedContext(context: string): boolean {
  const lower = context.toLowerCase();
  return lower.includes("merge-conflict") || lower.includes("greptile");
}

/**
 * Build the CI verdict, failing CLOSED when the required-check set could not be
 * determined. Reporting green on an unverified required set would reopen the
 * partial-checks gap (a fast check passing while the slow required jobs have not
 * registered), so instead force not-green and surface a sentinel in
 * `missingRequired` — the loop then waits/retries rather than declaring done.
 */
export function classifyCiFailClosed(
  checks: readonly NormalizedCheck[],
  required: RequiredChecksResult,
): CiVerdict {
  if (required.known) {
    return classifyChecks(
      checks,
      required.contexts.filter((c) => !isBabysitterTrackedContext(c)),
    );
  }
  console.warn(
    JSON.stringify({
      level: "warning",
      component: "pr-babysit",
      msg: "required checks undetermined; failing closed (CI not green)",
      reason: required.reason,
    }),
  );
  const base = classifyChecks(checks, []);
  return {
    ...base,
    green: false,
    missingRequired: [...base.missingRequired, REQUIRED_CHECKS_UNKNOWN],
  };
}

export type EvaluateBabysitDoDInput = {
  owner: string;
  repo: string;
  prNumber: number;
  baseRef: string;
  /** Persistent checkout on the PR branch; conflicts are computed here. */
  workdir: string;
  blockingSeverity: ReviewSeverity;
  /** Extra env (GH_TOKEN, GIT_ASKPASS, ...) for gh/git. */
  env?: Record<string, string>;
  /** Injected clock — keeps the activity testable / replay-friendly. */
  now?: () => Date;
};

/**
 * Compute the merge-conflict verdict by fetching the base ref into the existing
 * workdir and running `git merge-tree` against the PR's HEAD. Exit 1 from
 * merge-tree is a conflict (a legitimate answer), not an error.
 */
export async function checkConflictsInWorkdir(input: {
  workdir: string;
  baseRef: string;
  env?: Record<string, string>;
}): Promise<ConflictVerdict> {
  const opts = {
    cwd: input.workdir,
    ...(input.env === undefined ? {} : { env: input.env }),
  };
  await run(["git", "fetch", "origin", input.baseRef], opts);
  const mergeBase = await run(
    ["git", "merge-base", "HEAD", "FETCH_HEAD"],
    opts,
  );
  const mergeTree = await capture(
    [
      "git",
      "merge-tree",
      "--write-tree",
      `--merge-base=${mergeBase}`,
      "HEAD",
      "FETCH_HEAD",
    ],
    opts,
  );
  if (mergeTree.exitCode === 0) {
    return { clean: true, paths: [], baseRef: input.baseRef };
  }
  if (mergeTree.exitCode === 1) {
    return {
      clean: false,
      paths: parseConflictPaths(mergeTree.stdout),
      baseRef: input.baseRef,
    };
  }
  throw new Error(
    `git merge-tree failed (exit ${String(mergeTree.exitCode)}): ${mergeTree.stderr.trim()}`,
  );
}

export async function evaluateBabysitDoD(
  input: EvaluateBabysitDoDInput,
): Promise<BabysitVerdict> {
  const now = input.now ?? (() => new Date());
  const ghCtx = {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    ...(input.env === undefined ? {} : { env: input.env }),
  };

  const snapshot = await getPrSnapshot(ghCtx);

  // If the PR is closed/merged there is nothing to babysit; short-circuit the
  // expensive checks and report the terminal state.
  if (snapshot.prState !== "open") {
    const empty = {
      green: false,
      failing: [],
      pending: [],
      ignoredSoft: [],
      noChecksReported: false,
      missingRequired: [],
    };
    return {
      headSha: snapshot.headSha,
      prState: snapshot.prState,
      ci: empty,
      conflicts: { clean: true, paths: [], baseRef: input.baseRef },
      reviews: { allResolved: true, blocking: [], advisory: [] },
      dodMet: false,
      evaluatedAt: now().toISOString(),
    };
  }

  const [checks, threads, conflicts, requiredContexts] = await Promise.all([
    getChecks(ghCtx),
    getReviewThreads(ghCtx),
    checkConflictsInWorkdir({
      workdir: input.workdir,
      baseRef: input.baseRef,
      ...(input.env === undefined ? {} : { env: input.env }),
    }),
    getRequiredCheckContexts({
      owner: input.owner,
      repo: input.repo,
      baseRef: input.baseRef,
      ...(input.env === undefined ? {} : { env: input.env }),
    }),
  ]);

  const ci = classifyCiFailClosed(checks, requiredContexts);
  const reviews = classifyReviewThreads(threads, input.blockingSeverity);
  const dodMet = computeDodMet(ci, conflicts, reviews, snapshot.prState);

  return {
    headSha: snapshot.headSha,
    prState: snapshot.prState,
    ci,
    conflicts,
    reviews,
    dodMet,
    evaluatedAt: now().toISOString(),
  };
}
