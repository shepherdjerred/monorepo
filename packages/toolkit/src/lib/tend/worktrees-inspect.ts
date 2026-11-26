import path from "node:path";
import {
  canonicalizeExistingPath,
  isPathInside,
  normalizeHostPath,
} from "./paths.ts";
import type {
  ClassifiedLease,
  CommandRunner,
  HcTerminalEntry,
  LivenessSnapshot,
} from "./types.ts";
import {
  computeWorktreeLastActivityMs,
  countCommitsAhead,
  directoryExists,
  evaluateBranchAndPrEligibility,
  fileOrDirExists,
  isMidGitOperation,
  parsePullRequestList,
  type RepoPrRecord,
  resolveWorktreeGitDir,
  type WorktreePorcelainEntry,
} from "./worktrees-git.ts";
import {
  classifyWorktreeLock,
  decideWorktree,
  decideWorktreeEarly,
  type WorktreeDecision,
  type WorktreeFacts,
  type WorktreeLiveHold,
  type WorktreeLockState,
  type WorktreePrState,
  type WorktreeWorkFacts,
} from "./worktrees-policy.ts";
import { readWorktreeStatus } from "./worktrees-status.ts";

export type WorktreeHoldSource = {
  readonly category: string;
  readonly paths: ReadonlySet<string>;
  /** Also holds a worktree that sits inside one of the paths. */
  readonly coversDescendants?: boolean | undefined;
};

export type RepoSweepContext = {
  readonly repoPath: string;
  readonly holds: readonly WorktreeHoldSource[];
  readonly platform: NodeJS.Platform;
  readonly runner: CommandRunner;
  readonly apply: boolean;
  readonly worktreeMinAgeMs: number;
  readonly checkPullRequests: boolean;
  readonly includeClosedPrs: boolean;
  readonly nowMs: number;
  readonly homeDir: string;
  readonly isPidAlive: (pid: number) => boolean;
  /** Start time of the process that holds `pid` in the liveness snapshot. */
  readonly processStartOf: (pid: number) => string | undefined;
  /** Start time of the process that holds `pid` right now. */
  readonly readProcessStart: (pid: number) => Promise<string | undefined>;
  /**
   * Live Herdr terminals right now, or `null` when they cannot be listed.
   * Asked again before each removal, because the liveness snapshot is taken
   * once and a sweep that removes worktrees can run for minutes.
   */
  readonly listLiveTerminals: () => Promise<readonly HcTerminalEntry[] | null>;
};

/**
 * What shows a session is working in a worktree right now: a Herdr terminal,
 * a Herdr active file, a process, or the caller itself.
 */
export function collectSessionHoldSources(
  liveness: LivenessSnapshot,
  selfCwd: string,
): WorktreeHoldSource[] {
  const terminalPaths = new Set<string>();
  for (const terminal of liveness.hcTerminals) {
    terminalPaths.add(terminal.cwd);
    if (terminal.foregroundCwd !== undefined) {
      terminalPaths.add(terminal.foregroundCwd);
    }
  }
  return [
    { category: "live Herdr terminal", paths: terminalPaths },
    { category: "Herdr active worktree", paths: liveness.herdrActivePaths },
    { category: "process working directory", paths: liveness.processCwds },
    {
      category: "caller working directory",
      paths: new Set([normalizeHostPath(selfCwd, liveness.platform)]),
    },
  ];
}

/**
 * Everything that marks a worktree as in use, kept apart by source so a kept
 * worktree can say what is holding it.
 */
export function collectWorktreeHoldSources(
  liveness: LivenessSnapshot,
  leases: readonly ClassifiedLease[],
  selfCwd: string,
): WorktreeHoldSource[] {
  const leasePaths = new Set<string>();
  for (const item of leases) {
    if (item.status !== "active") {
      continue;
    }
    if (item.lease.kind === "dir") {
      leasePaths.add(normalizeHostPath(item.lease.target, liveness.platform));
    }
    if (item.lease.worktree !== undefined) {
      leasePaths.add(normalizeHostPath(item.lease.worktree, liveness.platform));
    }
  }
  return [
    ...collectSessionHoldSources(liveness, selfCwd),
    { category: "active lease", paths: leasePaths },
    {
      category: "Forum notice path",
      paths: liveness.forumNoticePaths,
      coversDescendants: true,
    },
    { category: "protected path", paths: liveness.protectedPaths },
  ];
}

export function findLiveHold(
  canonicalWt: string,
  holds: readonly WorktreeHoldSource[],
  platform: NodeJS.Platform,
): WorktreeLiveHold | undefined {
  for (const source of holds) {
    for (const held of source.paths) {
      if (
        isPathInside(held, canonicalWt, platform) ||
        (source.coversDescendants === true &&
          isPathInside(canonicalWt, held, platform))
      ) {
        return { category: source.category, detail: held };
      }
    }
  }
  return undefined;
}

export type RepoPullRequests = {
  readonly byBranch: ReadonlyMap<string, RepoPrRecord>;
  /** False when the open pull requests could not be listed completely. */
  readonly openKnown: boolean;
};

const OPEN_PR_LIMIT = 1000;
const RECENT_PR_LIMIT = 500;

/**
 * What `gh` says when it has no login or its token is refused: exit 4 with a
 * pointer to `gh auth login`, or `HTTP 401: Bad credentials`.
 */
const GH_NOT_AUTHENTICATED =
  /HTTP 401|bad credentials|gh auth (?:login|refresh)|not logged in|token .*invalid/iu;

/** `gh`'s own first line when the failure is one of authentication. */
export function ghAuthenticationFailure(result: {
  readonly exitCode: number;
  readonly stderr: string;
}): string | null {
  const stderr = result.stderr.trim();
  if (result.exitCode !== 4 && !GH_NOT_AUTHENTICATED.test(stderr)) {
    return null;
  }
  const [firstLine = ""] = stderr.split("\n");
  return firstLine.trim() || `gh exited ${String(result.exitCode)}`;
}

type PullRequestListing = {
  /** `null` when the pull requests could not be listed. */
  readonly records: Map<string, RepoPrRecord> | null;
  /** Set when `gh` failed because it has no valid login. */
  readonly notAuthenticated: string | null;
};

async function listPullRequests(
  ctx: RepoSweepContext,
  state: "open" | "all",
  limit: number,
): Promise<PullRequestListing> {
  const ghArgs = [
    "pr",
    "list",
    "--state",
    state,
    "--limit",
    String(limit),
    "--json",
    "headRefName,state,updatedAt,headRefOid",
  ];
  const ghCandidates =
    ctx.platform === "win32"
      ? ["gh", String.raw`C:\Program Files\GitHub CLI\gh.exe`]
      : ["gh"];
  let notAuthenticated: string | null = null;
  for (const ghBin of ghCandidates) {
    const ghRes = await ctx.runner([ghBin, ...ghArgs], {
      cwd: ctx.repoPath,
      timeoutMs: 30_000,
    });
    if (ghRes.exitCode === 0) {
      return {
        records: parsePullRequestList(ghRes.stdout),
        notAuthenticated: null,
      };
    }
    notAuthenticated ??= ghAuthenticationFailure(ghRes);
  }
  return { records: null, notAuthenticated };
}

/**
 * Two queries per repository. Open pull requests are asked for by state,
 * because the recent-history window (`--state all --limit 500`) can miss an
 * old open pull request in a repository with thousands of them. The history
 * window is only used to decide whether a merged branch may be deleted.
 */
export async function fetchRepoPullRequests(
  ctx: RepoSweepContext,
  nonMain: readonly WorktreePorcelainEntry[],
  warnings: string[],
): Promise<RepoPullRequests> {
  const hasNamedBranches = nonMain.some((wt) => wt.branch !== undefined);
  if (!hasNamedBranches || !ctx.checkPullRequests) {
    return { byBranch: new Map(), openKnown: true };
  }
  const openListing = await listPullRequests(ctx, "open", OPEN_PR_LIMIT);
  const recentListing = await listPullRequests(ctx, "all", RECENT_PR_LIMIT);
  const open = openListing.records;
  const recent = recentListing.records;
  const byBranch = new Map(recent);
  for (const [branch, record] of open ?? []) {
    byBranch.set(branch, record);
  }
  const openKnown = open !== null && open.size < OPEN_PR_LIMIT;
  const notAuthenticated =
    openListing.notAuthenticated ?? recentListing.notAuthenticated;
  if (notAuthenticated !== null) {
    // One cause, named as such: both queries fail for it, and neither
    // generic line would say which layer to fix.
    warnings.push(
      `gh is not authenticated: ${notAuthenticated}; pull requests could not be listed in ${ctx.repoPath}, so every branch worktree with commits ahead of the default branch is kept`,
    );
    return { byBranch, openKnown };
  }
  if (recent === null) {
    warnings.push(
      `gh pr list --state all failed in ${ctx.repoPath}; branches are deleted only when they have no commits ahead`,
    );
  }
  if (!openKnown) {
    warnings.push(
      `Open pull requests could not be listed in ${ctx.repoPath}; keeping every branch worktree with commits ahead of the default branch`,
    );
  }
  return { byBranch, openKnown };
}

function pullRequestState(
  wt: WorktreePorcelainEntry,
  prs: RepoPullRequests,
): WorktreePrState {
  if (wt.branch === undefined) {
    return "none";
  }
  const record = prs.byBranch.get(wt.branch);
  if (record?.state === "OPEN") {
    return "OPEN";
  }
  return prs.openKnown ? (record?.state ?? "none") : "unknown";
}

async function gatherWorkFacts(options: {
  readonly wt: WorktreePorcelainEntry;
  readonly gitDir: string;
  readonly defaultBranch: string;
  readonly pr: RepoPrRecord | undefined;
  readonly ctx: RepoSweepContext;
}): Promise<WorktreeWorkFacts> {
  const { wt, gitDir, defaultBranch, pr, ctx } = options;
  const status = await readWorktreeStatus(wt.path, ctx.runner, "all");
  if (status.kind === "timeout") {
    return { status: "timeout", timeoutMs: status.timeoutMs };
  }
  if (status.kind === "failed") {
    return { status: "failed", detail: status.detail };
  }
  const { lastActivityMs, commitEpochMs } = await computeWorktreeLastActivityMs(
    {
      wtPath: wt.path,
      gitDir,
      runner: ctx.runner,
      changedPaths: status.kind === "dirty" ? status.paths : [],
    },
  );
  const aheadOfDefault = await countCommitsAhead(
    wt.path,
    `origin/${defaultBranch}..HEAD`,
    ctx.runner,
  );
  const branchVerdict = await evaluateBranchAndPrEligibility({
    wt,
    defaultBranch,
    pr,
    commitEpochMs,
    aheadOfDefault,
    includeClosedPrs: ctx.includeClosedPrs,
    runner: ctx.runner,
  });
  const hasSubmodules =
    (await fileOrDirExists(path.join(wt.path, ".gitmodules"))) ||
    (await fileOrDirExists(path.join(gitDir, "modules")));
  return {
    status: status.kind,
    lastActivityMs,
    aheadOfDefault,
    branchVerdict,
    hasSubmodules,
  };
}

export type WorktreeInspection = {
  readonly decision: WorktreeDecision;
  readonly gitDir?: string | undefined;
};

/**
 * Classify a worktree's lock. The process snapshot is older than the lock
 * that was just read, so a start-time mismatch against it is not proof: the
 * pid may have been reused by the very agent that now holds the lock. A lock
 * is only called dead on a start time read after the lock was.
 */
async function classifyLockNow(
  wt: WorktreePorcelainEntry,
  ctx: RepoSweepContext,
): Promise<WorktreeLockState> {
  const lock = classifyWorktreeLock({
    locked: wt.locked,
    lockReason: wt.lockReason,
    isPidAlive: ctx.isPidAlive,
    processStartOf: ctx.processStartOf,
  });
  if (lock.kind !== "claude-agent" || lock.alive || !ctx.isPidAlive(lock.pid)) {
    return lock;
  }
  const startNow = await ctx.readProcessStart(lock.pid);
  return classifyWorktreeLock({
    locked: wt.locked,
    lockReason: wt.lockReason,
    isPidAlive: ctx.isPidAlive,
    processStartOf: () => startNow,
  });
}

/** Gather the facts about one worktree and run them through the policy. */
export async function inspectWorktree(
  wt: WorktreePorcelainEntry,
  defaultBranch: string,
  prs: RepoPullRequests,
  ctx: RepoSweepContext,
): Promise<WorktreeInspection> {
  const missing = wt.prunable || !(await directoryExists(wt.path));
  const canonicalWt = missing
    ? normalizeHostPath(wt.path, ctx.platform)
    : await canonicalizeExistingPath(wt.path, ctx.platform);
  const gitDir = missing
    ? null
    : await resolveWorktreeGitDir(wt.path, ctx.runner);
  const facts: WorktreeFacts = {
    missing,
    detached: wt.detached,
    branch: wt.branch,
    defaultBranch,
    lock: await classifyLockNow(wt, ctx),
    poolSlot: isPathInside(
      canonicalWt,
      path.join(ctx.homeDir, ".herdr", "worktrees", ".pool"),
      ctx.platform,
    ),
    liveHold: findLiveHold(canonicalWt, ctx.holds, ctx.platform),
    gitDirResolved: gitDir !== null,
    midGitOperation: gitDir !== null && (await isMidGitOperation(gitDir)),
    prState: pullRequestState(wt, prs),
    nowMs: ctx.nowMs,
    minAgeMs: ctx.worktreeMinAgeMs,
  };
  const early = decideWorktreeEarly(facts);
  if (early !== null || gitDir === null) {
    return {
      decision: early ?? decideWorktree(facts),
      ...(gitDir === null ? {} : { gitDir }),
    };
  }
  const work = await gatherWorkFacts({
    wt,
    gitDir,
    defaultBranch,
    pr: wt.branch === undefined ? undefined : prs.byBranch.get(wt.branch),
    ctx,
  });
  return { decision: decideWorktree({ ...facts, work }), gitDir };
}
