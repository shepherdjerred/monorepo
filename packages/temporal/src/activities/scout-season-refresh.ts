import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import { simpleGit } from "simple-git";
import {
  scoutSeasonRefreshDurationSeconds,
  scoutSeasonRefreshRunsTotal,
} from "#observability/metrics.ts";
import { getTraceContext } from "#observability/tracing.ts";
import {
  runClaude,
  type ClaudeRunResult,
} from "./scout-season-refresh-claude.ts";
import {
  changedFilesInPaths,
  getUnifiedDiff,
  openSeasonRefreshPr,
  runCommand,
} from "./scout-season-refresh-git.ts";

const COMPONENT = "scout-season-refresh";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const SEASONS_FILE = "packages/scout-for-lol/packages/data/src/seasons.ts";
const SEASONS_TEST_FILE =
  "packages/scout-for-lol/packages/data/src/seasons.test.ts";
const SEASON_PATHS = [SEASONS_FILE, SEASONS_TEST_FILE] as const;

const HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TURNS = 40;

const NO_DRIFT_SENTINEL = "NO_DRIFT";
const DRIFTED_SENTINEL = "DRIFTED";

export type ScoutSeasonRefreshInput = {
  dryRun?: boolean;
  workdir?: string;
  model?: string;
  maxTurns?: number;
};

export type ScoutSeasonRefreshOutcome =
  | "no-drift"
  | "pr-created"
  | "pr-skipped-dry-run"
  | "failed";

export type ScoutSeasonRefreshResult = {
  outcome: ScoutSeasonRefreshOutcome;
  reason: string;
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  diff: string | undefined;
  durationSeconds: number;
  costUsd: number | undefined;
  numTurns: number | undefined;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const info = activityInfoOrUndefined();
  const base: Record<string, unknown> = {
    level,
    msg: message,
    component: COMPONENT,
    ...getTraceContext(),
    ...fields,
  };
  if (info !== undefined) Object.assign(base, info);
  console.warn(JSON.stringify(base));
}

function activityInfoOrUndefined(): Record<string, unknown> | undefined {
  try {
    const info = Context.current().info;
    return {
      workflow: info.workflowType,
      workflowId: info.workflowExecution.workflowId,
      runId: info.workflowExecution.runId,
      activity: info.activityType,
      attempt: info.attempt,
    };
  } catch {
    return undefined;
  }
}

function captureWithContext(
  error: unknown,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    const info = activityInfoOrUndefined();
    if (info !== undefined) {
      scope.setTag("workflow", String(info["workflow"]));
      scope.setTag("activity", String(info["activity"]));
    }
    scope.setContext("scoutSeasonRefresh", { ...info, ...extra });
    Sentry.captureException(error);
  });
}

function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    // Outside an activity (local dev script): heartbeats are a no-op.
  }
}

function branchNameFor(id: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `scout-season-refresh/${date}-${id.slice(0, 8)}`;
}

function logSentinelDisagreement(
  filesChanged: number,
  sentinelText: string,
): void {
  const drifted = sentinelText.includes(DRIFTED_SENTINEL);
  const noDrift = sentinelText.includes(NO_DRIFT_SENTINEL);
  if (filesChanged === 0 && drifted) {
    jsonLog("warning", "Sentinel reported DRIFTED but no files changed", {
      sentinelText: sentinelText.slice(0, 200),
    });
  }
  if (filesChanged > 0 && noDrift) {
    jsonLog("warning", "Sentinel reported NO_DRIFT but files changed");
  }
}

function noDriftResult(
  claude: ClaudeRunResult,
  durationSeconds: number,
): ScoutSeasonRefreshResult {
  scoutSeasonRefreshRunsTotal.inc({ outcome: "no-drift" });
  scoutSeasonRefreshDurationSeconds.observe(
    { outcome: "no-drift" },
    durationSeconds,
  );
  jsonLog("info", "Season refresh detected no drift", {
    durationSeconds,
    costUsd: claude.costUsd,
    numTurns: claude.numTurns,
  });
  return {
    outcome: "no-drift",
    reason: "no-diff",
    changedFiles: [],
    branchName: undefined,
    commitHash: undefined,
    prUrl: undefined,
    diff: undefined,
    durationSeconds,
    costUsd: claude.costUsd,
    numTurns: claude.numTurns,
  };
}

async function dryRunResult(args: {
  claude: ClaudeRunResult;
  files: string[];
  diff: string;
  id: string;
  durationSeconds: number;
}): Promise<ScoutSeasonRefreshResult> {
  const { claude, files, diff, id, durationSeconds } = args;
  scoutSeasonRefreshRunsTotal.inc({ outcome: "pr-created" });
  scoutSeasonRefreshDurationSeconds.observe(
    { outcome: "pr-created" },
    durationSeconds,
  );
  const diffPath = `/tmp/scout-season-refresh-${id}.diff`;
  await Bun.write(diffPath, diff);
  jsonLog("info", "Season refresh DRY_RUN — diff written, no PR opened", {
    diffPath,
    changedFiles: files,
    durationSeconds,
  });
  return {
    outcome: "pr-skipped-dry-run",
    reason: "dry-run",
    changedFiles: files,
    branchName: undefined,
    commitHash: undefined,
    prUrl: undefined,
    diff,
    durationSeconds,
    costUsd: claude.costUsd,
    numTurns: claude.numTurns,
  };
}

async function realPrResult(args: {
  claude: ClaudeRunResult;
  files: string[];
  diff: string;
  id: string;
  durationSeconds: number;
  repoDir: string;
  tempDir: string;
  ghToken: string;
  sentinelText: string;
}): Promise<ScoutSeasonRefreshResult> {
  const branch = branchNameFor(args.id);
  const title = "chore(scout-for-lol): refresh LoL season dates";
  const body = [
    "Automated weekly refresh of the LoL season schedule by the temporal",
    "`scout-season-refresh-weekly` workflow.",
    "",
    `Changed files: ${String(args.files.length)}`,
    "",
    "## Claude's notes",
    "",
    args.sentinelText.length > 0 ? args.sentinelText : "(no notes; see diff)",
  ].join("\n");

  const { commitHash, prUrl } = await openSeasonRefreshPr({
    repoDir: args.repoDir,
    tempDir: args.tempDir,
    branch,
    title,
    body,
    files: SEASON_PATHS,
    ghToken: args.ghToken,
    repoSlug: REPO_SLUG,
    mainBranch: MAIN_BRANCH,
  });

  scoutSeasonRefreshRunsTotal.inc({ outcome: "pr-created" });
  scoutSeasonRefreshDurationSeconds.observe(
    { outcome: "pr-created" },
    args.durationSeconds,
  );
  jsonLog("info", "Season refresh opened PR (awaiting human review)", {
    prUrl,
    branch,
    commitHash,
    changedFiles: args.files,
    durationSeconds: args.durationSeconds,
  });

  return {
    outcome: "pr-created",
    reason: "drift-detected",
    changedFiles: args.files,
    branchName: branch,
    commitHash,
    prUrl,
    diff: args.diff,
    durationSeconds: args.durationSeconds,
    costUsd: args.claude.costUsd,
    numTurns: args.claude.numTurns,
  };
}

async function prepareWorkdir(input: ScoutSeasonRefreshInput): Promise<{
  tempDir: string;
  repoDir: string;
  ownedByUs: boolean;
}> {
  if (input.workdir !== undefined) {
    return { tempDir: input.workdir, repoDir: input.workdir, ownedByUs: false };
  }
  const id = crypto.randomUUID();
  const tempDir = `/tmp/scout-season-refresh-${id}`;
  const repoDir = `${tempDir}/monorepo`;
  await runCommand(["mkdir", "-p", tempDir], { cwd: "/tmp" });
  await simpleGit().clone(REPO_URL, repoDir, [
    "--branch",
    MAIN_BRANCH,
    "--single-branch",
    "--depth",
    "1",
  ]);
  return { tempDir, repoDir, ownedByUs: true };
}

async function dispatchOutcome(args: {
  claude: ClaudeRunResult;
  files: string[];
  diff: string;
  id: string;
  durationSeconds: number;
  repoDir: string;
  tempDir: string;
  dryRun: boolean;
  ghToken: string;
  sentinelText: string;
}): Promise<ScoutSeasonRefreshResult> {
  if (args.files.length === 0) {
    return noDriftResult(args.claude, args.durationSeconds);
  }
  if (args.dryRun) {
    return await dryRunResult({
      claude: args.claude,
      files: args.files,
      diff: args.diff,
      id: args.id,
      durationSeconds: args.durationSeconds,
    });
  }
  return await realPrResult({
    claude: args.claude,
    files: args.files,
    diff: args.diff,
    id: args.id,
    durationSeconds: args.durationSeconds,
    repoDir: args.repoDir,
    tempDir: args.tempDir,
    ghToken: args.ghToken,
    sentinelText: args.sentinelText,
  });
}

async function run(
  input: ScoutSeasonRefreshInput,
): Promise<ScoutSeasonRefreshResult> {
  const start = Date.now();
  const id = crypto.randomUUID();
  const dryRun = input.dryRun === true;
  const ghToken = Bun.env["GH_TOKEN"] ?? "";

  if (!dryRun && ghToken === "") {
    throw new Error("GH_TOKEN is required to open season-refresh PRs");
  }

  const envHeartbeat = setInterval(() => {
    safeHeartbeat({ phase: "envelope", elapsedMs: Date.now() - start });
  }, HEARTBEAT_INTERVAL_MS);

  const workdir = await prepareWorkdir(input);

  try {
    const claude = await runClaude({
      workdir: workdir.repoDir,
      model: input.model ?? DEFAULT_MODEL,
      maxTurns: input.maxTurns ?? DEFAULT_MAX_TURNS,
      seasonsFile: SEASONS_FILE,
      seasonsTestFile: SEASONS_TEST_FILE,
      noDriftSentinel: NO_DRIFT_SENTINEL,
      driftedSentinel: DRIFTED_SENTINEL,
    });

    const sentinelText = claude.resultText.trim();
    const files = await changedFilesInPaths(workdir.repoDir, SEASON_PATHS);
    const diff =
      files.length > 0
        ? await getUnifiedDiff(workdir.repoDir, SEASON_PATHS)
        : "";
    const durationSeconds = (Date.now() - start) / 1000;

    logSentinelDisagreement(files.length, sentinelText);

    return await dispatchOutcome({
      claude,
      files,
      diff,
      id,
      durationSeconds,
      repoDir: workdir.repoDir,
      tempDir: workdir.tempDir,
      dryRun,
      ghToken,
      sentinelText,
    });
  } catch (error) {
    const durationSeconds = (Date.now() - start) / 1000;
    scoutSeasonRefreshRunsTotal.inc({ outcome: "failed" });
    scoutSeasonRefreshDurationSeconds.observe(
      { outcome: "failed" },
      durationSeconds,
    );
    captureWithContext(error, { durationSeconds });
    jsonLog("error", "Season refresh failed", {
      durationSeconds,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearInterval(envHeartbeat);
    if (workdir.ownedByUs) {
      try {
        await Bun.$`rm -rf ${workdir.tempDir}`.quiet();
      } catch (cleanupError) {
        jsonLog("warning", "Failed to clean up workdir", {
          tempDir: workdir.tempDir,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
    }
  }
}

export type ScoutSeasonRefreshActivities = typeof scoutSeasonRefreshActivities;

export const scoutSeasonRefreshActivities = {
  async runScoutSeasonRefresh(
    input: ScoutSeasonRefreshInput,
  ): Promise<ScoutSeasonRefreshResult> {
    return run(input);
  },
};
