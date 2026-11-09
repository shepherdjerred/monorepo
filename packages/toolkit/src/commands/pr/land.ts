import { z } from "zod";
import { GitHubClient, resolvePrNumber } from "#lib/ci/github.ts";
import { githubToken } from "#lib/ci/process.ts";
import { loadWoodpeckerConfig } from "#lib/woodpecker/ci.ts";
import { CiObserver } from "#lib/ci/observer.ts";
import { EXIT_CODES, type Verdict } from "#lib/ci/readiness.ts";
import type { WaitResult } from "#lib/ci/wait/wait.ts";
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

export type LandDependencies = {
  wait: typeof waitForPr;
  merge: MergeBranch;
};

export type LandRequest = {
  number: number;
  observer: CiObserver;
  signal: AbortSignal;
};

/** Wait for exact-head readiness, then merge; any other outcome is reported. */
export async function landPr(
  { number, observer, signal }: LandRequest,
  options: LandOptions,
  dependencies: LandDependencies,
): Promise<{ result: WaitResult; mergeCommitSha: string | null }> {
  const result = await dependencies.wait(
    number,
    observer,
    {
      head: options.head,
      timeoutMs: options.timeoutMs,
      until: "first-failure",
      mainPolicy: options.allowRedMain ? "ignore" : "require",
    },
    signal,
  );
  const ready = result.snapshot;
  if (ready === null || result.verdict.outcome !== "ready")
    return { result, mergeCommitSha: null };
  const head = await observer.github.read(
    `/repos/${observer.github.repo}/pulls/${String(number)}`,
    HeadSchema,
    signal,
  );
  if (head.head.sha !== ready.pr.head.sha)
    return {
      result: landed(result, {
        outcome: "head_changed",
        reasons: [
          `PR head changed from ${ready.pr.head.sha} to ${head.head.sha} before merging`,
        ],
        commands: [`toolkit pr land ${String(number)}`],
      }),
      mergeCommitSha: null,
    };
  console.error(
    `PR #${String(number)} is ready; merging ${head.head.ref} with git-spice.`,
  );
  const code = await dependencies.merge(head.head.ref, signal);
  // A cancelled merge may or may not have landed; report the cancellation,
  // not a merge result read after it.
  signal.throwIfAborted();
  const after = await observer.github.pr(number, signal);
  if (code === 0 && after.merged)
    return {
      result: landed(result, {
        outcome: "merged",
        reasons: [
          `Merged PR #${String(number)} as ${after.merge_commit_sha ?? "an unknown commit"}.`,
        ],
        commands:
          after.merge_commit_sha === undefined ||
          after.merge_commit_sha === null
            ? []
            : [`toolkit ci wait --main --head ${after.merge_commit_sha}`],
      }),
      mergeCommitSha: after.merge_commit_sha ?? null,
    };
  return {
    result: landed(result, {
      outcome: "merge_failed",
      reasons: [
        `Toolkit reported PR #${String(number)} ready, but git-spice branch merge exited ${String(code)}${after.merged ? "" : " and the PR is not merged"}. Its output is above on stderr.`,
      ],
      commands: [
        `toolkit pr health ${String(number)}`,
        `toolkit pr land ${String(number)}`,
      ],
    }),
    mergeCommitSha: null,
  };
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
    const observer = new CiObserver(new GitHubClient(token), config);
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
