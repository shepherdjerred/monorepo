import { z } from "zod";
import { GitHubRateLimitError } from "@shepherdjerred/code-review/github-request";
import { GitHubClient, resolvePrNumber } from "#lib/ci/github.ts";
import { RESUME_SPREAD_MS } from "#lib/ci/github/budget.ts";
import { sleep } from "#lib/ci/wait/sleep.ts";
import { githubToken } from "#lib/ci/process.ts";
import { loadWoodpeckerConfig } from "#lib/woodpecker/ci.ts";
import { CiObserver } from "#lib/ci/observer.ts";
import { EXIT_CODES, type Snapshot, type Verdict } from "#lib/ci/readiness.ts";
import { timeoutResult, type WaitResult } from "#lib/ci/wait/wait.ts";
import {
  formatResult,
  reportCommandError,
  resultReport,
} from "#lib/ci/output.ts";
import { sanitizeText } from "#lib/ci/redaction.ts";
import {
  buildPassthroughInvocation,
  spawnPassthroughInvocation,
} from "#lib/passthrough.ts";
import { waitForPr, withCancellation } from "#commands/ci.ts";

export type LandOptions = {
  json: boolean;
  head?: string | undefined;
  timeoutMs?: number | undefined;
  allowRedMain: boolean;
};

/**
 * Merges one ready branch and returns the merge command's exit code. A
 * cancelled `signal` must terminate the merge before it resolves.
 */
export type MergeBranch = (
  branch: string,
  signal: AbortSignal,
) => Promise<number>;

/**
 * git-spice keeps stack restacking and asks GitHub once (`--ready-timeout 0`)
 * after toolkit has already proven exact-head readiness. Its stdout goes to
 * stderr so `--json` keeps stdout for the single report.
 */
export function gitSpiceMergeArgs(branch: string): string[] {
  return [
    "branch",
    "merge",
    "--method",
    "squash",
    "--ready-timeout",
    "0",
    "--branch",
    branch,
  ];
}

export const mergeWithGitSpice: MergeBranch = async (branch, signal) => {
  const invocation = buildPassthroughInvocation(
    "git-spice",
    gitSpiceMergeArgs(branch),
    Bun.env,
  );
  if (invocation === null) throw new Error("git-spice passthrough is missing");
  return spawnPassthroughInvocation(invocation, {
    stdoutToStderr: true,
    signal,
  });
};

const HeadSchema = z.object({
  head: z.object({ ref: z.string(), sha: z.string() }),
});

function landed(result: WaitResult, verdict: Verdict): WaitResult {
  return { ...result, verdict };
}

/**
 * GraphQL points `git-spice branch merge` needs to finish. Below this the
 * merge would be refused part-way, so land waits for the reset first.
 */
export const MERGE_GRAPHQL_RESERVE = 200;

export type LandDependencies = {
  wait: typeof waitForPr;
  merge: MergeBranch;
  /**
   * Epoch ms to wait until before merging when the GraphQL bucket cannot
   * cover a merge, or null when it can. `fresh` skips recent observations.
   */
  quota?: (signal: AbortSignal, fresh: boolean) => Promise<number | null>;
  /** Waits until `resumeAt`; reports why on stderr. */
  pause?: (resumeAt: number, signal: AbortSignal) => Promise<void>;
};

export type LandRequest = {
  number: number;
  observer: CiObserver;
  signal: AbortSignal;
};

/** When the shared GraphQL bucket can next afford a merge, or null if now. */
export async function mergeQuota(
  github: GitHubClient,
  signal: AbortSignal,
  fresh: boolean,
): Promise<number | null> {
  try {
    const bucket = await github.graphqlBudget(signal, fresh ? 0 : 30_000);
    return bucket.remaining < MERGE_GRAPHQL_RESERVE ? bucket.resetAt : null;
  } catch (error) {
    if (error instanceof GitHubRateLimitError) return error.resumeAt;
    throw error;
  }
}

async function pauseForQuota(
  resumeAt: number,
  signal: AbortSignal,
): Promise<void> {
  const at = resumeAt + Math.floor(Math.random() * RESUME_SPREAD_MS);
  console.error(
    `GitHub GraphQL budget cannot cover a merge; resuming at ${new Date(at).toISOString()} and re-checking readiness. This does not mean CI failed.`,
  );
  await sleep(Math.max(0, at - Date.now()), signal);
}

type LandOutcome = { result: WaitResult; mergeCommitSha: string | null };

/**
 * One merge attempt's result, or when to prove readiness again and retry:
 * `budget` before merging, `refused` after a merge failed on quota.
 * `otherwise` is reported when the retry would pass the deadline.
 */
type Attempt =
  | { done: LandOutcome }
  | { retryAt: number; kind: "budget" | "refused"; otherwise: LandOutcome };

type LandContext = {
  number: number;
  observer: CiObserver;
  signal: AbortSignal;
  dependencies: LandDependencies;
  quota: NonNullable<LandDependencies["quota"]>;
  deadline: number | null;
  started: number;
};

function mergedOutcome(
  number: number,
  result: WaitResult,
  mergeCommitSha: string | null | undefined,
): LandOutcome {
  return {
    result: landed(result, {
      outcome: "merged",
      reasons: [
        `Merged PR #${String(number)} as ${mergeCommitSha ?? "an unknown commit"}.`,
      ],
      commands:
        mergeCommitSha === undefined || mergeCommitSha === null
          ? []
          : [`toolkit ci wait --main --head ${mergeCommitSha}`],
    }),
    mergeCommitSha: mergeCommitSha ?? null,
  };
}

function failedOutcome(
  number: number,
  result: WaitResult,
  code: number,
  merged: boolean,
): LandOutcome {
  return {
    result: landed(result, {
      outcome: "merge_failed",
      reasons: [
        `Toolkit reported PR #${String(number)} ready, but git-spice branch merge exited ${String(code)}${merged ? "" : " and the PR is not merged"}. Its output is above on stderr.`,
      ],
      commands: [
        `toolkit pr health ${String(number)}`,
        `toolkit pr land ${String(number)}`,
      ],
    }),
    mergeCommitSha: null,
  };
}

/** Merge a PR proven ready, unless its head moved or the bucket is too low. */
async function attemptMerge(
  context: LandContext,
  result: WaitResult,
  ready: Snapshot,
  retried: boolean,
): Promise<Attempt> {
  const { number, observer, signal, started } = context;
  const current = await observer.github.read(
    `/repos/${observer.github.repo}/pulls/${String(number)}`,
    HeadSchema,
    signal,
  );
  if (current.head.sha !== ready.pr.head.sha)
    return {
      done: {
        result: landed(result, {
          outcome: "head_changed",
          reasons: [
            `PR head changed from ${ready.pr.head.sha} to ${current.head.sha} before merging`,
          ],
          commands: [`toolkit pr land ${String(number)}`],
        }),
        mergeCommitSha: null,
      },
    };
  const before = await context.quota(signal, false);
  if (before !== null)
    return {
      retryAt: before,
      kind: "budget",
      otherwise: {
        result: timeoutResult(ready, started),
        mergeCommitSha: null,
      },
    };
  console.error(
    `PR #${String(number)} is ready; merging ${current.head.ref} with git-spice.`,
  );
  const code = await context.dependencies.merge(current.head.ref, signal);
  // A cancelled merge may or may not have landed; report the cancellation,
  // not a merge result read after it.
  signal.throwIfAborted();
  const after = await observer.github.pr(number, signal);
  if (code === 0 && after.merged)
    return { done: mergedOutcome(number, result, after.merge_commit_sha) };
  const failed = failedOutcome(number, result, code, after.merged);
  const refused =
    retried || after.merged ? null : await context.quota(signal, true);
  return refused === null
    ? { done: failed }
    : { retryAt: refused, kind: "refused", otherwise: failed };
}

/**
 * Wait for exact-head readiness, then merge; any other outcome is reported.
 * The merge runs only when the shared GraphQL bucket can cover it, and a
 * merge that fails while the bucket is exhausted is retried once after the
 * reset. Every retry proves readiness of the same head again first.
 */
export async function landPr(
  { number, observer, signal }: LandRequest,
  options: LandOptions,
  dependencies: LandDependencies,
): Promise<LandOutcome> {
  const started = Date.now();
  const context: LandContext = {
    number,
    observer,
    signal,
    dependencies,
    quota:
      dependencies.quota ??
      ((read, fresh) => mergeQuota(observer.github, read, fresh)),
    deadline:
      options.timeoutMs === undefined ? null : started + options.timeoutMs,
    started,
  };
  const pause = dependencies.pause ?? pauseForQuota;
  let head = options.head;
  let retried = false;
  for (;;) {
    const { deadline } = context;
    const result = await dependencies.wait(
      number,
      observer,
      {
        head,
        timeoutMs:
          deadline === null ? undefined : Math.max(0, deadline - Date.now()),
        until: "first-failure",
        mainPolicy: options.allowRedMain ? "ignore" : "require",
      },
      signal,
    );
    const ready = result.snapshot;
    if (ready === null || result.verdict.outcome !== "ready")
      return { result, mergeCommitSha: null };
    head = ready.pr.head.sha;
    const attempt = await attemptMerge(context, result, ready, retried);
    if ("done" in attempt) return attempt.done;
    if (deadline !== null && attempt.retryAt > deadline)
      return attempt.otherwise;
    if (attempt.kind === "refused") retried = true;
    await pause(attempt.retryAt, signal);
  }
}

export async function landCommand(
  pr: string | undefined,
  options: LandOptions,
  merge: MergeBranch = mergeWithGitSpice,
): Promise<void> {
  const secrets: string[] = [];
  try {
    const number = await resolvePrNumber(pr);
    const [token, config] = await Promise.all([
      githubToken(),
      loadWoodpeckerConfig(),
    ]);
    secrets.push(token, config.token);
    const observer = new CiObserver(GitHubClient.shared(token), config);
    await withCancellation(async (signal) => {
      const { result, mergeCommitSha } = await landPr(
        { number, observer, signal },
        options,
        { wait: waitForPr, merge },
      );
      const report = {
        ...(await resultReport(result, observer, signal)),
        mergeCommitSha,
      };
      console.log(
        sanitizeText(
          options.json ? JSON.stringify(report, null, 2) : formatResult(report),
          secrets,
        ),
      );
      process.exitCode = EXIT_CODES[result.verdict.outcome];
    });
  } catch (error) {
    reportCommandError(error, secrets, options.json);
  }
}
