import { z } from "zod";
import { GitHubRateLimitError } from "@shepherdjerred/code-review/github-request";
import { GitHubClient, resolvePrNumber } from "#lib/ci/github.ts";
import { RESUME_SPREAD_MS } from "#lib/ci/github/budget.ts";
import { sleep } from "#lib/ci/wait/sleep.ts";
import { githubToken, tryGithubToken } from "#lib/ci/process.ts";
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
  lookupExecutable,
} from "#lib/passthrough.ts";
import { populateGitSpiceEnvironment } from "#lib/git-spice/env.ts";
import { waitForPr, withCancellation } from "#commands/ci.ts";

export type LandOptions = {
  json: boolean;
  head?: string | undefined;
  timeoutMs?: number | undefined;
  allowRedMain: boolean;
};

export type MergeResult =
  number | { code: number; stderr?: string | undefined };

/**
 * Merges one ready branch and returns the merge command's exit code (plus
 * captured stderr when available). A cancelled `signal` must terminate the
 * merge before it resolves.
 */
export type MergeBranch = (
  branch: string,
  signal: AbortSignal,
) => Promise<MergeResult>;

/**
 * git-spice keeps stack restacking and asks GitHub once (`--ready-timeout 0`)
 * after toolkit has already proven exact-head readiness. `--no-prompt` keeps
 * non-interactive shells from blocking on stdin, and stdout goes to stderr so
 * `--json` keeps stdout for the single report.
 */
export function gitSpiceMergeArgs(branch: string): string[] {
  return [
    "branch",
    "merge",
    "--method",
    "squash",
    "--ready-timeout",
    "0",
    "--no-prompt",
    "--branch",
    branch,
  ];
}

async function teeStreamToStderr(
  stream: ReadableStream<Uint8Array>,
  captured?: string[],
): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    process.stderr.write(chunk);
    captured?.push(decoder.decode(chunk, { stream: true }));
  }
  captured?.push(decoder.decode());
}

export function createGitSpiceMerge(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): MergeBranch {
  return async (branch, signal) => {
    signal.throwIfAborted();
    const existing = environment["GH_TOKEN"]?.trim();
    const resolved =
      existing !== undefined && existing.length > 0
        ? existing
        : await tryGithubToken({ ...environment });
    const args = gitSpiceMergeArgs(branch);
    const env = await populateGitSpiceEnvironment(args, {
      ...environment,
      ...(resolved === null ? {} : { GH_TOKEN: resolved }),
    });
    const invocation = buildPassthroughInvocation("git-spice", args, env);
    if (invocation === null) {
      throw new Error("git-spice passthrough is missing");
    }
    const executable = lookupExecutable(
      invocation.executable,
      invocation.env["PATH"],
    );
    if (executable === null) {
      throw new Error(
        `toolkit: required executable not found: ${invocation.executable}`,
      );
    }
    const child = Bun.spawn([executable, ...invocation.args], {
      env: invocation.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const abort = () => {
      child.kill();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const stderrChunks: string[] = [];
      const outcomes = await Promise.all([
        teeStreamToStderr(child.stdout),
        teeStreamToStderr(child.stderr, stderrChunks),
        child.exited,
      ]);
      return { code: outcomes[2], stderr: stderrChunks.join("") };
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
}

export const mergeWithGitSpice: MergeBranch = createGitSpiceMerge();

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
  pause?: (
    resumeAt: number,
    signal: AbortSignal,
    deadline: number | null,
  ) => Promise<void>;
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

/** Sleep until the reset plus jitter, but never past the land deadline. */
async function pauseForQuota(
  resumeAt: number,
  signal: AbortSignal,
  deadline: number | null,
): Promise<void> {
  const spread = resumeAt + Math.floor(Math.random() * RESUME_SPREAD_MS);
  const at = deadline === null ? spread : Math.min(spread, deadline);
  console.error(
    `GitHub GraphQL budget cannot cover a merge; resuming at ${new Date(at).toISOString()} and re-checking readiness. This does not mean CI failed.`,
  );
  await sleep(Math.max(0, at - Date.now()), signal);
}

const GIT_SPICE_TRANSPORT_ERROR =
  /connection reset by peer|ECONNRESET|ETIMEDOUT|TLS handshake timeout|unexpected EOF/iu;

const MAX_MERGE_TRANSPORT_RETRIES = 2;

type LandOutcome = { result: WaitResult; mergeCommitSha: string | null };

/**
 * One merge attempt's result, or when to prove readiness again and retry:
 * `budget` before merging, `refused` after a merge failed on quota, or
 * `transport` after an unmerged connection drop. `otherwise` is reported when
 * the retry would pass the deadline.
 */
type Attempt =
  | { done: LandOutcome }
  | { retryAt: number; kind: "budget" | "refused"; otherwise: LandOutcome }
  | {
      retryDelayMs: number;
      kind: "transport";
      attemptNumber: number;
      otherwise: LandOutcome;
    };

type LandContext = {
  number: number;
  observer: CiObserver;
  signal: AbortSignal;
  dependencies: LandDependencies;
  quota: NonNullable<LandDependencies["quota"]>;
  deadline: number | null;
  started: number;
};

type RetryState = {
  quotaRetried: boolean;
  transportRetries: number;
};

function normalizeMergeResult(outcome: MergeResult): {
  code: number;
  stderr: string;
} {
  return typeof outcome === "number"
    ? { code: outcome, stderr: "" }
    : { code: outcome.code, stderr: outcome.stderr ?? "" };
}

function mergedOutcome(
  number: number,
  result: WaitResult,
  mergeCommitSha: string | null | undefined,
  exitCode = 0,
): LandOutcome {
  const postMergeWarning =
    exitCode === 0
      ? null
      : `git-spice branch merge exited ${String(exitCode)} during post-merge local trunk sync after GitHub merged PR #${String(number)}.`;
  if (postMergeWarning !== null) {
    console.error(postMergeWarning);
  }
  return {
    result: landed(result, {
      outcome: "merged",
      reasons: [
        `Merged PR #${String(number)} as ${mergeCommitSha ?? "an unknown commit"}.`,
        ...(postMergeWarning === null ? [] : [postMergeWarning]),
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
): LandOutcome {
  return {
    result: landed(result, {
      outcome: "merge_failed",
      reasons: [
        `Toolkit reported PR #${String(number)} ready, but git-spice branch merge exited ${String(code)} and the PR is not merged. Its output is above on stderr.`,
      ],
      commands: [
        `toolkit pr health ${String(number)}`,
        `toolkit pr land ${String(number)}`,
      ],
    }),
    mergeCommitSha: null,
  };
}

function canRetryTransportFailure(options: {
  code: number;
  stderr: string;
  after: { merged: boolean; state: string; head: { sha: string } };
  expectedHeadSha: string;
  transportRetries: number;
}): boolean {
  const { code, stderr, after, expectedHeadSha, transportRetries } = options;
  return (
    code !== 0 &&
    !after.merged &&
    after.state === "open" &&
    after.head.sha === expectedHeadSha &&
    transportRetries < MAX_MERGE_TRANSPORT_RETRIES &&
    GIT_SPICE_TRANSPORT_ERROR.test(stderr)
  );
}

/** Merge a PR proven ready, unless its head moved or the bucket is too low. */
async function attemptMerge(
  context: LandContext,
  result: WaitResult,
  ready: Snapshot,
  retryState: RetryState,
): Promise<Attempt> {
  const { number, observer, signal, started } = context;
  const current = await observer.github.read(
    `/repos/${observer.github.repo}/pulls/${String(number)}`,
    HeadSchema,
    signal,
  );
  if (current.head.sha !== ready.pr.head.sha) {
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
  }
  const before = await context.quota(signal, false);
  if (before !== null) {
    return {
      retryAt: before,
      kind: "budget",
      otherwise: {
        result: timeoutResult(ready, started),
        mergeCommitSha: null,
      },
    };
  }
  console.error(
    `PR #${String(number)} is ready; merging ${current.head.ref} with git-spice.`,
  );
  const { code, stderr } = normalizeMergeResult(
    await context.dependencies.merge(current.head.ref, signal),
  );
  // A cancelled merge may or may not have landed; report the cancellation,
  // not a merge result read after it.
  signal.throwIfAborted();
  const after = await observer.github.pr(number, signal);
  if (after.merged) {
    return {
      done: mergedOutcome(number, result, after.merge_commit_sha, code),
    };
  }
  const failed = failedOutcome(number, result, code);
  if (
    canRetryTransportFailure({
      code,
      stderr,
      after,
      expectedHeadSha: ready.pr.head.sha,
      transportRetries: retryState.transportRetries,
    })
  ) {
    const attemptNumber = retryState.transportRetries + 1;
    const retryDelayMs =
      Bun.env.NODE_ENV === "test" ? 5 : 1000 * 2 ** (attemptNumber - 1);
    return {
      kind: "transport",
      retryDelayMs,
      attemptNumber,
      otherwise: failed,
    };
  }
  const refused = retryState.quotaRetried
    ? null
    : await context.quota(signal, true);
  return refused === null
    ? { done: failed }
    : { retryAt: refused, kind: "refused", otherwise: failed };
}

async function pauseBeforeRetry(
  context: LandContext,
  attempt: Exclude<Attempt, { done: LandOutcome }>,
  retryState: RetryState,
  pause: NonNullable<LandDependencies["pause"]>,
): Promise<boolean> {
  const { number, deadline, signal } = context;
  if (attempt.kind === "transport") {
    retryState.transportRetries = attempt.attemptNumber;
    if (deadline !== null && Date.now() >= deadline) {
      return false;
    }
    console.error(
      `git-spice branch merge hit a transient GitHub transport error on PR #${String(number)} (retry ${String(attempt.attemptNumber)}/${String(MAX_MERGE_TRANSPORT_RETRIES)}); re-checking readiness before retrying.`,
    );
    const waitMs =
      deadline === null
        ? attempt.retryDelayMs
        : Math.max(0, Math.min(attempt.retryDelayMs, deadline - Date.now()));
    await sleep(waitMs, signal);
    return deadline === null || Date.now() < deadline;
  }
  if (attempt.kind === "refused") {
    retryState.quotaRetried = true;
  }
  return pauseWithin(attempt.retryAt, deadline, signal, pause);
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
  const deadline =
    options.timeoutMs === undefined ? null : started + options.timeoutMs;
  const quota =
    dependencies.quota ??
    ((read, fresh) => mergeQuota(observer.github, read, fresh));
  const context: LandContext = {
    number,
    observer,
    signal,
    dependencies,
    quota,
    deadline,
    started,
  };
  const pause = dependencies.pause ?? pauseForQuota;
  const mainPolicy = options.allowRedMain ? "ignore" : "require";
  const retryState: RetryState = { quotaRetried: false, transportRetries: 0 };
  let head = options.head;
  for (;;) {
    const timeoutMs =
      deadline === null ? undefined : Math.max(0, deadline - Date.now());
    const result = await dependencies.wait(
      number,
      observer,
      { head, timeoutMs, until: "first-failure", mainPolicy },
      signal,
    );
    const ready = result.snapshot;
    if (ready === null || result.verdict.outcome !== "ready") {
      return { result, mergeCommitSha: null };
    }
    head = ready.pr.head.sha;
    const attempt = await attemptMerge(context, result, ready, retryState);
    if ("done" in attempt) {
      return attempt.done;
    }
    if (!(await pauseBeforeRetry(context, attempt, retryState, pause))) {
      return attempt.otherwise;
    }
  }
}

/**
 * Pause for a retry. False when the retry cannot start before the deadline,
 * either because the reset is later or because the deadline passed while
 * paused.
 */
async function pauseWithin(
  retryAt: number,
  deadline: number | null,
  signal: AbortSignal,
  pause: NonNullable<LandDependencies["pause"]>,
): Promise<boolean> {
  if (deadline === null) {
    await pause(retryAt, signal, null);
    return true;
  }
  if (retryAt > deadline) return false;
  await pause(retryAt, signal, deadline);
  return Date.now() < deadline;
}

export async function landCommand(
  pr: string | undefined,
  options: LandOptions,
  merge?: MergeBranch,
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
    const merger =
      merge ?? createGitSpiceMerge({ ...Bun.env, GH_TOKEN: token });
    await withCancellation(async (signal) => {
      const { result, mergeCommitSha } = await landPr(
        { number, observer, signal },
        options,
        { wait: waitForPr, merge: merger },
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
