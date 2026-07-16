import { Context } from "@temporalio/activity";
import { Octokit } from "octokit";
import * as Sentry from "@sentry/bun";
import {
  createGitHubAppInstallationToken,
  type GitHubAppTokenResult,
} from "#lib/github-app-token.ts";
import {
  prMergeConflictCheckDurationSeconds,
  prMergeConflictCheckTotal,
} from "#observability/metrics.ts";
import type { CheckPrMergeConflictsInput } from "#shared/schemas.ts";
import {
  defaultPrepareWorkDir,
  defaultRunMergeBase,
  defaultRunMergeTree,
  parseConflictPaths as parseConflictPathsImpl,
} from "./check-pr-merge-conflicts-git.ts";

/**
 * Re-exposed for test use; the underlying parser lives in
 * `./check-pr-merge-conflicts-git.ts`.
 */
export function parseConflictPaths(stdout: string): string[] {
  return parseConflictPathsImpl(stdout);
}

const COMPONENT = "pr-merge-conflict-check";
const STATUS_CONTEXT = "ci/merge-conflict";
const CONCURRENCY_LIMIT = 5;
const HEARTBEAT_INTERVAL_MS = 10_000;

export type ConflictCheckPullRef = {
  number: number;
  head: { sha: string; ref: string };
  base: { ref: string };
};

export type CommitStatusState = "success" | "failure" | "pending" | "error";

/**
 * Minimal client surface the activity needs. Production wraps `new Octokit()`,
 * tests inject a stub — neither has to grapple with Octokit's full type tree.
 */
export type ConflictCheckClient = {
  listOpenPrs: (params: {
    owner: string;
    repo: string;
    base: string;
  }) => Promise<ConflictCheckPullRef[]>;
  createCommitStatus: (params: {
    owner: string;
    repo: string;
    sha: string;
    context: string;
    state: CommitStatusState;
    description: string;
    target_url?: string;
  }) => Promise<void>;
};

/**
 * Inject token minting + the client wrapper + the git executor so the unit
 * test can drive a fixture repo without hitting github.com or doing a real
 * clone. `prepareWorkDir` returns the path of the already-fetched bare repo
 * (main + every refs/pull/<N>/head landed); production creates and populates
 * a tempdir, tests return a fixture path built up front.
 */
export type ConflictCheckDeps = {
  createInstallationToken?: () => Promise<GitHubAppTokenResult>;
  createClient?: (token: string) => ConflictCheckClient;
  prepareWorkDir?: (input: {
    token: string;
    owner: string;
    repo: string;
    prNumbers: number[];
  }) => Promise<{ workDir: string; cleanup: () => Promise<void> }>;
  runMergeBase?: (workDir: string, prNumber: number) => Promise<string>;
  runMergeTree?: (
    workDir: string,
    mergeBase: string,
    prNumber: number,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  targetUrl?: string;
};

type PrToCheck = {
  number: number;
  headSha: string;
  headRef: string;
  baseRef: string;
};

type CheckOutcome = "success" | "failure" | "errored" | "skipped-dry-run";

type CheckResult = {
  prNumber: number;
  headSha: string;
  outcome: CheckOutcome;
  conflictPaths: string[];
  errorMessage?: string;
};

export type CheckPrMergeConflictsResult = {
  trigger: "main" | "pr";
  prsChecked: number;
  conflicts: number;
  clean: number;
  errored: number;
  skippedKillSwitch: boolean;
  dryRun: boolean;
  durationSeconds: number;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({ level, msg: message, component: COMPONENT, ...fields }),
  );
}

function isKillSwitchEnabled(): boolean {
  return (
    (Bun.env["MERGE_CONFLICT_CHECK_ENABLED"] ?? "true").toLowerCase() === "true"
  );
}

function isDryRun(): boolean {
  return (
    (Bun.env["MERGE_CONFLICT_CHECK_DRY_RUN"] ?? "false").toLowerCase() ===
    "true"
  );
}

function triggerLabel(input: CheckPrMergeConflictsInput): "main" | "pr" {
  return input.kind === "all-prs" ? "main" : "pr";
}

function defaultCreateClient(token: string): ConflictCheckClient {
  const octokit = new Octokit({ auth: token });
  return {
    async listOpenPrs(params) {
      const data = await octokit.paginate(octokit.rest.pulls.list, {
        owner: params.owner,
        repo: params.repo,
        state: "open",
        base: params.base,
        per_page: 100,
      });
      return data.map((pr) => ({
        number: pr.number,
        head: { sha: pr.head.sha, ref: pr.head.ref },
        base: { ref: pr.base.ref },
      }));
    },
    async createCommitStatus(params) {
      await octokit.rest.repos.createCommitStatus({
        owner: params.owner,
        repo: params.repo,
        sha: params.sha,
        context: params.context,
        state: params.state,
        description: params.description,
        ...(params.target_url === undefined
          ? {}
          : { target_url: params.target_url }),
      });
    },
  };
}

function pickSinglePr(input: CheckPrMergeConflictsInput): PrToCheck | null {
  if (input.kind !== "single-pr") {
    throw new Error("pickSinglePr called for non-single-pr kind");
  }
  if (input.baseRef !== "main") {
    return null;
  }
  return {
    number: input.prNumber,
    headSha: input.headSha,
    headRef: "",
    baseRef: input.baseRef,
  };
}

async function processBatches<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map((item) => fn(item)));
    results.push(...batchResults);
  }
  return results;
}

type ProcessPrArgs = {
  pr: PrToCheck;
  workDir: string;
  client: ConflictCheckClient;
  owner: string;
  repo: string;
  runMergeBase: NonNullable<ConflictCheckDeps["runMergeBase"]>;
  runMergeTree: NonNullable<ConflictCheckDeps["runMergeTree"]>;
  targetUrl: string | undefined;
  dryRun: boolean;
  trigger: "main" | "pr";
};

async function processPr(args: ProcessPrArgs): Promise<CheckResult> {
  const { pr, workDir, client, owner, repo, dryRun, trigger, targetUrl } = args;
  try {
    const mergeBase = await args.runMergeBase(workDir, pr.number);
    const result = await args.runMergeTree(workDir, mergeBase, pr.number);
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(
        `git merge-tree exited ${String(result.exitCode)} for PR #${String(pr.number)}: ${result.stderr}`,
      );
    }
    const hasConflict = result.exitCode === 1;
    const conflictPaths = hasConflict
      ? parseConflictPathsImpl(result.stdout)
      : [];
    const state: CommitStatusState = hasConflict ? "failure" : "success";
    const description = hasConflict
      ? `Conflicts with main in ${String(conflictPaths.length)} file(s)`
      : "Clean merge with main";

    if (dryRun) {
      jsonLog("info", "dry-run: would post commit status", {
        prNumber: pr.number,
        headSha: pr.headSha,
        state,
        description,
        conflictPaths: conflictPaths.slice(0, 20),
      });
      return {
        prNumber: pr.number,
        headSha: pr.headSha,
        outcome: "skipped-dry-run",
        conflictPaths,
      };
    }

    await client.createCommitStatus({
      owner,
      repo,
      sha: pr.headSha,
      context: STATUS_CONTEXT,
      state,
      description: description.slice(0, 140),
      ...(targetUrl === undefined ? {} : { target_url: targetUrl }),
    });
    prMergeConflictCheckTotal.inc({
      trigger,
      result: hasConflict ? "failure" : "success",
    });
    jsonLog("info", "posted ci/merge-conflict status", {
      prNumber: pr.number,
      headSha: pr.headSha,
      state,
      conflictPathCount: conflictPaths.length,
    });
    return {
      prNumber: pr.number,
      headSha: pr.headSha,
      outcome: hasConflict ? "failure" : "success",
      conflictPaths,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.withScope((scope) => {
      scope.setTag("component", COMPONENT);
      scope.setContext("pr", {
        prNumber: pr.number,
        headSha: pr.headSha,
        owner,
        repo,
      });
      Sentry.captureException(error);
    });
    prMergeConflictCheckTotal.inc({ trigger, result: "errored" });
    jsonLog("warning", "PR merge-conflict check errored", {
      prNumber: pr.number,
      headSha: pr.headSha,
      error: message,
    });
    return {
      prNumber: pr.number,
      headSha: pr.headSha,
      outcome: "errored",
      conflictPaths: [],
      errorMessage: message,
    };
  }
}

function emptyResult(
  trigger: "main" | "pr",
  start: number,
  flags: { skippedKillSwitch: boolean; dryRun: boolean },
): CheckPrMergeConflictsResult {
  return {
    trigger,
    prsChecked: 0,
    conflicts: 0,
    clean: 0,
    errored: 0,
    skippedKillSwitch: flags.skippedKillSwitch,
    dryRun: flags.dryRun,
    durationSeconds: (Date.now() - start) / 1000,
  };
}

async function enumeratePrs(
  input: CheckPrMergeConflictsInput,
  client: ConflictCheckClient,
): Promise<PrToCheck[] | { skipped: true; reason: string }> {
  if (input.kind === "all-prs") {
    const refs = await client.listOpenPrs({
      owner: input.owner,
      repo: input.repo,
      base: "main",
    });
    return refs.map((pr) => ({
      number: pr.number,
      headSha: pr.head.sha,
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
    }));
  }
  const single = pickSinglePr(input);
  if (single === null) {
    return { skipped: true, reason: "base-not-main" };
  }
  return [single];
}

export async function runCheckPrMergeConflictsImpl(
  input: CheckPrMergeConflictsInput,
  deps: ConflictCheckDeps,
): Promise<CheckPrMergeConflictsResult> {
  const start = Date.now();
  const trigger = triggerLabel(input);
  const dryRun = isDryRun();

  if (!isKillSwitchEnabled()) {
    jsonLog("info", "kill switch: MERGE_CONFLICT_CHECK_ENABLED=false; no-op", {
      kind: input.kind,
    });
    return emptyResult(trigger, start, { skippedKillSwitch: true, dryRun });
  }

  const tokenResult = await (
    deps.createInstallationToken ?? createGitHubAppInstallationToken
  )();
  const client = (deps.createClient ?? defaultCreateClient)(tokenResult.token);

  const enumerated = await enumeratePrs(input, client);
  if ("skipped" in enumerated) {
    jsonLog("info", "skipping single-pr check: base is not main", {
      prNumber: input.kind === "single-pr" ? input.prNumber : undefined,
      baseRef: input.kind === "single-pr" ? input.baseRef : undefined,
    });
    return emptyResult(trigger, start, { skippedKillSwitch: false, dryRun });
  }
  const prs = enumerated;

  if (prs.length === 0) {
    jsonLog("info", "no open PRs targeting main; nothing to check", {
      kind: input.kind,
    });
    const elapsed = (Date.now() - start) / 1000;
    prMergeConflictCheckDurationSeconds.observe({ trigger }, elapsed);
    return emptyResult(trigger, start, { skippedKillSwitch: false, dryRun });
  }

  const prepare = deps.prepareWorkDir ?? defaultPrepareWorkDir;
  const runMergeBase = deps.runMergeBase ?? defaultRunMergeBase;
  const runMergeTree = deps.runMergeTree ?? defaultRunMergeTree;

  const { workDir, cleanup } = await prepare({
    token: tokenResult.token,
    owner: input.owner,
    repo: input.repo,
    prNumbers: prs.map((pr) => pr.number),
  });

  try {
    const results = await processBatches(prs, CONCURRENCY_LIMIT, (pr) =>
      processPr({
        pr,
        workDir,
        client,
        owner: input.owner,
        repo: input.repo,
        runMergeBase,
        runMergeTree,
        targetUrl: deps.targetUrl,
        dryRun,
        trigger,
      }),
    );

    const conflicts = results.filter((r) => r.outcome === "failure").length;
    const clean = results.filter((r) => r.outcome === "success").length;
    const errored = results.filter((r) => r.outcome === "errored").length;
    const durationSeconds = (Date.now() - start) / 1000;
    prMergeConflictCheckDurationSeconds.observe({ trigger }, durationSeconds);

    jsonLog("info", "runCheckPrMergeConflicts complete", {
      kind: input.kind,
      trigger,
      prsChecked: prs.length,
      conflicts,
      clean,
      errored,
      dryRun,
      durationSeconds,
    });

    return {
      trigger,
      prsChecked: prs.length,
      conflicts,
      clean,
      errored,
      skippedKillSwitch: false,
      dryRun,
      durationSeconds,
    };
  } finally {
    await cleanup();
  }
}

export type CheckPrMergeConflictsActivities =
  typeof checkPrMergeConflictsActivities;

export const checkPrMergeConflictsActivities = {
  async runCheckPrMergeConflicts(
    input: CheckPrMergeConflictsInput,
  ): Promise<CheckPrMergeConflictsResult> {
    const start = Date.now();
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "runCheckPrMergeConflicts",
        elapsedMs: Date.now() - start,
      });
    }, HEARTBEAT_INTERVAL_MS);
    try {
      return await runCheckPrMergeConflictsImpl(input, {});
    } finally {
      clearInterval(heartbeat);
    }
  },
};
