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
  /**
   * Live Herdr terminals right now, or `null` when they cannot be listed.
   * Asked again before each removal, because the liveness snapshot is taken
   * once and a sweep that removes worktrees can run for minutes.
   */
  readonly listLiveTerminals: () => Promise<readonly HcTerminalEntry[] | null>;
};

/**
 * Everything that marks a worktree as in use, kept apart by source so a kept
 * worktree can say what is holding it.
 */
export function collectWorktreeHoldSources(
  liveness: LivenessSnapshot,
  leases: readonly ClassifiedLease[],
  selfCwd: string,
): WorktreeHoldSource[] {
  const terminalPaths = new Set<string>();
  for (const terminal of liveness.hcTerminals) {
    terminalPaths.add(terminal.cwd);
    if (terminal.foregroundCwd !== undefined) {
      terminalPaths.add(terminal.foregroundCwd);
    }
  }
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
    { category: "live Herdr terminal", paths: terminalPaths },
    { category: "Herdr active worktree", paths: liveness.herdrActivePaths },
    { category: "process working directory", paths: liveness.processCwds },
    { category: "active lease", paths: leasePaths },
    {
      category: "Forum notice path",
      paths: liveness.forumNoticePaths,
      coversDescendants: true,
    },
    {
      category: "caller working directory",
      paths: new Set([normalizeHostPath(selfCwd, liveness.platform)]),
    },
    { category: "protected path", paths: liveness.protectedPaths },
  ];
}

function findLiveHold(
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

async function listPullRequests(
  ctx: RepoSweepContext,
  state: "open" | "all",
  limit: number,
): Promise<Map<string, RepoPrRecord> | null> {
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
  for (const ghBin of ghCandidates) {
    const ghRes = await ctx.runner([ghBin, ...ghArgs], {
      cwd: ctx.repoPath,
      timeoutMs: 30_000,
    });
    if (ghRes.exitCode === 0) {
      return parsePullRequestList(ghRes.stdout);
    }
  }
  return null;
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
  const open = await listPullRequests(ctx, "open", OPEN_PR_LIMIT);
  const recent = await listPullRequests(ctx, "all", RECENT_PR_LIMIT);
  const byBranch = new Map(recent);
  for (const [branch, record] of open ?? []) {
    byBranch.set(branch, record);
  }
  if (recent === null) {
    warnings.push(
      `gh pr list --state all failed in ${ctx.repoPath}; branches are deleted only when they have no commits ahead`,
    );
  }
  const openKnown = open !== null && open.size < OPEN_PR_LIMIT;
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
  const status = await readWorktreeStatus(wt.path, ctx.runner);
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
  return { status: status.kind, lastActivityMs, aheadOfDefault, branchVerdict };
}

export type WorktreeInspection = {
  readonly decision: WorktreeDecision;
  readonly gitDir?: string | undefined;
};

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
    lock: classifyWorktreeLock({
      locked: wt.locked,
      lockReason: wt.lockReason,
      isPidAlive: ctx.isPidAlive,
      processStartOf: ctx.processStartOf,
    }),
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
