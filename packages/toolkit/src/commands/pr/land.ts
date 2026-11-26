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
  evaluateStaleBase,
  type StaleBaseReport,
} from "#lib/ci/stale-base/evaluate.ts";
import { recordAndGateStaleBase } from "#lib/ci/stale-base/receipts.ts";
import { waitForPr, withCancellation } from "#commands/ci.ts";
import {
  formatMergeStderr,
  preflightGitSpiceLand,
  prepareGitSpiceMerge,
  spawnGitSpiceMergeProcess,
  type MergePreparation,
  type MergeTarget,
} from "./land-git-spice.ts";

export type LandOptions = {
  json: boolean;
  head?: string | undefined;
  timeoutMs?: number | undefined;
  allowRedMain: boolean;
  allowStaleBase?: boolean | undefined;
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

export function createGitSpiceMerge(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): MergeBranch {
  return (branch, signal) =>
    spawnGitSpiceMergeProcess({
      args: gitSpiceMergeArgs(branch),
      signal,
      environment,
    });
}

export const mergeWithGitSpice: MergeBranch = createGitSpiceMerge();

const HeadSchema = z.object({
  head: z.object({ ref: z.string(), sha: z.string() }),
  base: z.object({ ref: z.string() }).optional(),
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
  /** Checks local git-spice bootstrap prerequisites before entering CI wait. */
  preflight?: ((signal: AbortSignal) => Promise<void>) | undefined;
  /** Validates local branch sync and retargets stale stack bases before merge. */
  prepareMerge?:
    | ((target: MergeTarget, signal: AbortSignal) => Promise<MergePreparation>)
    | undefined;
  quota?: (signal: AbortSignal, fresh: boolean) => Promise<number | null>;
  pause?: (
    resumeAt: number,
    signal: AbortSignal,
    deadline: number | null,
  ) => Promise<void>;
  staleBase?: (
    headSha: string,
    baseRef: string,
    mainHeadSha: string | undefined,
    signal: AbortSignal,
  ) => Promise<StaleBaseReport>;
  stateDir?: string | undefined;
  secrets?: readonly string[] | undefined;
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
  staleBase: NonNullable<LandDependencies["staleBase"]>;
  allowStaleBase: boolean;
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
  if (postMergeWarning !== null) console.error(postMergeWarning);
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
  stderr = "",
): LandOutcome {
  const detail = formatMergeStderr(stderr);
  return {
    result: landed(result, {
      outcome: "merge_failed",
      reasons: [
        `Toolkit reported PR #${String(number)} ready, but git-spice branch merge exited ${String(code)} and the PR is not merged. Its output is above on stderr.`,
        ...(detail === null ? [] : [detail]),
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

async function evaluatePreMergeBlocker(
  context: LandContext,
  result: WaitResult,
  ready: Snapshot,
  current: z.infer<typeof HeadSchema>,
): Promise<Attempt | null> {
  const { number, signal, started } = context;
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
  const staleVerdict = await recordAndGateStaleBase({
    pr: number,
    baseRef: ready.pr.base.ref,
    report: await context.staleBase(
      ready.pr.head.sha,
      ready.pr.base.ref,
      ready.main.headSha,
      signal,
    ),
    allowStaleBase: context.allowStaleBase,
    secrets: context.dependencies.secrets,
    stateDir: context.dependencies.stateDir,
  });
  if (staleVerdict !== null) {
    return {
      done: { result: landed(result, staleVerdict), mergeCommitSha: null },
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
  if (context.dependencies.prepareMerge !== undefined) {
    const preparation = await context.dependencies.prepareMerge(
      {
        number,
        branch: current.head.ref,
        headSha: ready.pr.head.sha,
        baseRef: current.base?.ref ?? ready.pr.base.ref,
      },
      signal,
    );
    if (!preparation.ok) {
      return {
        done: {
          result: landed(result, {
            outcome: "merge_failed",
            reasons: preparation.reasons,
            commands: preparation.commands,
          }),
          mergeCommitSha: null,
        },
      };
    }
  }
  return null;
}

/** Merge a PR proven ready, unless its head moved, its base is stale, or the bucket is too low. */
async function attemptMerge(
  context: LandContext,
  result: WaitResult,
  ready: Snapshot,
  retryState: RetryState,
): Promise<Attempt> {
  const { number, observer, signal } = context;
  const current = await observer.github.read(
    `/repos/${observer.github.repo}/pulls/${String(number)}`,
    HeadSchema,
    signal,
  );
  const preMerge = await evaluatePreMergeBlocker(
    context,
    result,
    ready,
    current,
  );
  if (preMerge !== null) return preMerge;
  console.error(
    `PR #${String(number)} is ready; merging ${current.head.ref} with git-spice.`,
  );
  const { code, stderr } = normalizeMergeResult(
    await context.dependencies.merge(current.head.ref, signal),
  );
  signal.throwIfAborted();
  const after = await observer.github.pr(number, signal);
  if (after.merged) {
    return {
      done: mergedOutcome(number, result, after.merge_commit_sha, code),
    };
  }
  const failed = failedOutcome(number, result, code, stderr);
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
    if (deadline !== null && Date.now() >= deadline) return false;
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
  if (attempt.kind === "refused") retryState.quotaRetried = true;
  return pauseWithin(attempt.retryAt, deadline, signal, pause);
}

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
  const staleBase =
    dependencies.staleBase ??
    ((headSha, baseRef, mainHeadSha, read) =>
      evaluateStaleBase({
        github: observer.github,
        prNumber: number,
        headSha,
        baseRef,
        mainHeadSha,
        signal: read,
      }));
  const context: LandContext = {
    number,
    observer,
    signal,
    dependencies,
    quota,
    staleBase,
    allowStaleBase: options.allowStaleBase === true,
    deadline,
    started,
  };
  const pause = dependencies.pause ?? pauseForQuota;
  const mainPolicy = options.allowRedMain ? "ignore" : "require";
  const retryState: RetryState = { quotaRetried: false, transportRetries: 0 };
  await dependencies.preflight?.(signal);
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
    if ("done" in attempt) return attempt.done;
    if (!(await pauseBeforeRetry(context, attempt, retryState, pause))) {
      return attempt.otherwise;
    }
  }
}

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
    const mergeEnv = { ...Bun.env, GH_TOKEN: token };
    const merger = merge ?? createGitSpiceMerge(mergeEnv);
    await withCancellation(async (signal) => {
      const { result, mergeCommitSha } = await landPr(
        { number, observer, signal },
        options,
        {
          wait: waitForPr,
          merge: merger,
          secrets,
          ...(merge === undefined
            ? {
                preflight: (read) =>
                  preflightGitSpiceLand({
                    number,
                    observer,
                    signal: read,
                    env: mergeEnv,
                  }),
                prepareMerge: (target, read) =>
                  prepareGitSpiceMerge(target, read, { env: mergeEnv }),
              }
            : {}),
        },
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
