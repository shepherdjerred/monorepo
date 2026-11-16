import { readdir, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  canonicalizeExistingPath,
  DEFAULT_WORKTREE_MIN_AGE_MS,
  formatDurationCompact,
  isPathProtected,
  isUnderProtectedPrefix,
  normalizeHostPath,
} from "./paths.ts";
import { defaultCommandRunner } from "./process-probe.ts";
import type {
  ClassifiedLease,
  CommandRunner,
  LivenessSnapshot,
  SurfaceSweepResult,
  TendActionOutcome,
  TendCandidate,
} from "./types.ts";
import {
  computeWorktreeLastActivityMs,
  directoryExists,
  evaluateBranchAndPrEligibility,
  fileOrDirExists,
  isMidGitOperation,
  parseBatchPullRequests,
  parsePorcelainWorktrees,
  type RepoPrRecord,
  resolveDefaultBranch,
  resolveWorktreeGitDir,
  type WorktreePorcelainEntry,
} from "./worktrees-git.ts";

async function discoverGitRepositories(options: {
  readonly gitDirs: readonly string[];
  readonly platform: NodeJS.Platform;
}): Promise<string[]> {
  const seenCanonical = new Set<string>();
  const repos: string[] = [];

  for (const rootDir of options.gitDirs) {
    let entries: string[];
    try {
      entries = await readdir(rootDir);
    } catch {
      continue;
    }
    for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
      const candidate = path.join(rootDir, entry);
      if (!(await fileOrDirExists(path.join(candidate, ".git")))) {
        continue;
      }
      const canonical = await canonicalizeExistingPath(
        candidate,
        options.platform,
      );
      if (!seenCanonical.has(canonical)) {
        seenCanonical.add(canonical);
        repos.push(candidate);
      }
    }
  }
  return repos;
}

function collectActiveProtectedWorktreePaths(
  liveness: LivenessSnapshot,
  leases: readonly ClassifiedLease[],
  selfCwd: string,
): Set<string> {
  const protectedSet = new Set<string>(liveness.protectedPaths);
  const normalizedSelf = normalizeHostPath(selfCwd, liveness.platform);
  if (normalizedSelf.length > 0) {
    protectedSet.add(normalizedSelf);
  }
  for (const item of leases) {
    if (item.status !== "active") {
      continue;
    }
    if (item.lease.kind === "dir") {
      protectedSet.add(normalizeHostPath(item.lease.target, liveness.platform));
    }
    if (item.lease.worktree !== undefined) {
      protectedSet.add(
        normalizeHostPath(item.lease.worktree, liveness.platform),
      );
    }
  }
  return protectedSet;
}

async function applyWorktreeRemoval(options: {
  readonly repoPath: string;
  readonly wt: WorktreePorcelainEntry;
  readonly forceDeleteBranch: boolean;
  readonly runner: CommandRunner;
}): Promise<{ readonly ok: boolean; readonly detail?: string | undefined }> {
  const { repoPath, wt, runner } = options;
  if (wt.locked) {
    await runner(["git", "worktree", "unlock", wt.path], {
      cwd: repoPath,
      timeoutMs: 5000,
    });
  }
  const rmRes = await runner(["git", "worktree", "remove", wt.path], {
    cwd: repoPath,
    timeoutMs: 15_000,
  });
  if (rmRes.exitCode !== 0) {
    return {
      ok: false,
      detail:
        rmRes.stderr.trim() ||
        `git worktree remove exited ${String(rmRes.exitCode)}`,
    };
  }
  if (wt.branch !== undefined) {
    const flag = options.forceDeleteBranch ? "-D" : "-d";
    const branchRes = await runner(["git", "branch", flag, wt.branch], {
      cwd: repoPath,
      timeoutMs: 5000,
    });
    if (branchRes.exitCode !== 0) {
      return {
        ok: true,
        detail: `worktree removed; branch ${wt.branch} kept (${branchRes.stderr.trim() || "not deleted"})`,
      };
    }
  }
  return { ok: true };
}

async function removeEmptyChildDirectories(parentDir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(parentDir);
  } catch {
    return;
  }
  for (const name of names) {
    const child = path.join(parentDir, name);
    try {
      const subEntries = await readdir(child);
      if (subEntries.length === 0) {
        await rmdir(child);
      }
    } catch {
      // Ignore files or non-empty directories.
    }
  }
  try {
    const remaining = await readdir(parentDir);
    if (remaining.length === 0) {
      await rmdir(parentDir);
    }
  } catch {
    // Keep non-empty parent.
  }
}

export type SweepWorktreesOptions = {
  readonly liveness: LivenessSnapshot;
  readonly leases?: readonly ClassifiedLease[] | undefined;
  readonly runner?: CommandRunner | undefined;
  readonly apply: boolean;
  readonly worktreeMinAgeMs?: number | undefined;
  readonly gitDirs?: readonly string[] | undefined;
  readonly homeDir?: string | undefined;
  readonly selfCwd?: string | undefined;
  readonly checkPullRequests?: boolean | undefined;
  readonly includeClosedPrs?: boolean | undefined;
  readonly nowMs?: number | undefined;
};

type RepoSweepContext = {
  readonly repoPath: string;
  readonly protectedPaths: ReadonlySet<string>;
  readonly forumNoticePaths: ReadonlySet<string>;
  readonly platform: NodeJS.Platform;
  readonly runner: CommandRunner;
  readonly apply: boolean;
  readonly worktreeMinAgeMs: number;
  readonly checkPullRequests: boolean;
  readonly includeClosedPrs: boolean;
  readonly nowMs: number;
  readonly homeDir: string;
};

async function inspectSingleWorktree(
  wt: WorktreePorcelainEntry,
  defaultBranch: string,
  prMap: ReadonlyMap<string, RepoPrRecord>,
  ctx: RepoSweepContext,
): Promise<{
  readonly candidate?: TendCandidate | undefined;
  readonly forceDeleteBranch?: boolean | undefined;
}> {
  if (wt.prunable || !(await directoryExists(wt.path))) {
    return {
      candidate: {
        id: `worktree-prunable:${wt.path}`,
        surface: "worktrees",
        kind: "worktree-metadata",
        target: wt.path,
        reason: "prunable stale worktree metadata (directory already missing)",
      },
    };
  }

  const canonicalWt = await canonicalizeExistingPath(wt.path, ctx.platform);
  if (
    isPathProtected(canonicalWt, ctx.protectedPaths, ctx.platform) ||
    isUnderProtectedPrefix(canonicalWt, ctx.forumNoticePaths, ctx.platform)
  ) {
    return {};
  }

  const statusRes = await ctx.runner(["git", "status", "--porcelain"], {
    cwd: wt.path,
    timeoutMs: 5000,
  });
  if (statusRes.exitCode !== 0 || statusRes.stdout.trim().length > 0) {
    return {};
  }

  const gitDir = await resolveWorktreeGitDir(wt.path, ctx.runner);
  if (gitDir === null || (await isMidGitOperation(gitDir))) {
    return {};
  }

  const { lastActivityMs, commitEpochMs } = await computeWorktreeLastActivityMs(
    { wtPath: wt.path, gitDir, runner: ctx.runner },
  );
  const ageMs = Math.max(0, ctx.nowMs - lastActivityMs);
  if (lastActivityMs > 0 && ageMs < ctx.worktreeMinAgeMs) {
    return {};
  }

  const pr = wt.branch === undefined ? undefined : prMap.get(wt.branch);
  const verdict = await evaluateBranchAndPrEligibility({
    wt,
    defaultBranch,
    pr,
    commitEpochMs,
    includeClosedPrs: ctx.includeClosedPrs,
    runner: ctx.runner,
  });
  if (!verdict.prune) {
    return {};
  }

  return {
    forceDeleteBranch: verdict.forceDeleteBranch,
    candidate: {
      id: `worktree:${wt.path}`,
      surface: "worktrees",
      kind: wt.detached ? "detached-worktree" : "branch-worktree",
      target: wt.path,
      reason: `${verdict.reason} (idle ${formatDurationCompact(ageMs)})`,
      ageSeconds: Math.floor(ageMs / 1000),
      metadata: {
        repo: ctx.repoPath,
        ...(wt.branch === undefined ? {} : { branch: wt.branch }),
        locked: wt.locked,
      },
    },
  };
}

async function fetchRepoPullRequestMap(
  ctx: RepoSweepContext,
  nonMain: readonly WorktreePorcelainEntry[],
  warnings: string[],
): Promise<Map<string, RepoPrRecord>> {
  const hasNamedBranches = nonMain.some((wt) => wt.branch !== undefined);
  if (!hasNamedBranches || !ctx.checkPullRequests) {
    return new Map();
  }
  const ghRes = await ctx.runner(
    [
      "gh",
      "pr",
      "list",
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "headRefName,state,updatedAt,headRefOid",
    ],
    { cwd: ctx.repoPath, timeoutMs: 15_000 },
  );
  if (ghRes.exitCode === 0) {
    return parseBatchPullRequests(ghRes.stdout);
  }
  warnings.push(
    `gh pr list unavailable in ${ctx.repoPath}; checking git ancestry only`,
  );
  return new Map();
}

async function pruneRepoWorktreeMetadataAndDirs(
  ctx: RepoSweepContext,
): Promise<void> {
  await ctx.runner(["git", "worktree", "prune"], {
    cwd: ctx.repoPath,
    timeoutMs: 5000,
  });
  const repoName = path.basename(ctx.repoPath);
  await removeEmptyChildDirectories(
    path.join(ctx.homeDir, ".herdr", "worktrees", repoName),
  );
  await removeEmptyChildDirectories(
    path.join(ctx.repoPath, ".claude", "worktrees"),
  );
}

async function sweepRepositoryWorktrees(ctx: RepoSweepContext): Promise<{
  readonly inspected: number;
  readonly candidates: TendCandidate[];
  readonly actions: TendActionOutcome[];
  readonly warnings: string[];
}> {
  const warnings: string[] = [];
  const listRes = await ctx.runner(["git", "worktree", "list", "--porcelain"], {
    cwd: ctx.repoPath,
    timeoutMs: 5000,
  });
  if (listRes.exitCode !== 0) {
    warnings.push(`git worktree list failed in ${ctx.repoPath}`);
    return { inspected: 0, candidates: [], actions: [], warnings };
  }

  const nonMain = parsePorcelainWorktrees(listRes.stdout).slice(1);
  if (nonMain.length === 0) {
    return { inspected: 0, candidates: [], actions: [], warnings };
  }

  const defaultBranch = await resolveDefaultBranch(ctx.repoPath, ctx.runner);
  if (defaultBranch === null) {
    warnings.push(
      `Skipping ${ctx.repoPath}: could not determine origin default branch`,
    );
    return { inspected: nonMain.length, candidates: [], actions: [], warnings };
  }

  const prMap = await fetchRepoPullRequestMap(ctx, nonMain, warnings);
  const candidates: TendCandidate[] = [];
  const actions: TendActionOutcome[] = [];
  let needsMetadataPrune = false;

  for (const wt of nonMain) {
    const inspected = await inspectSingleWorktree(
      wt,
      defaultBranch,
      prMap,
      ctx,
    );
    if (inspected.candidate === undefined) {
      continue;
    }
    candidates.push(inspected.candidate);
    if (!ctx.apply) {
      actions.push({ candidate: inspected.candidate, status: "planned" });
      continue;
    }
    if (inspected.candidate.kind === "worktree-metadata") {
      needsMetadataPrune = true;
      actions.push({ candidate: inspected.candidate, status: "removed" });
      continue;
    }
    const removal = await applyWorktreeRemoval({
      repoPath: ctx.repoPath,
      wt,
      forceDeleteBranch: inspected.forceDeleteBranch === true,
      runner: ctx.runner,
    });
    actions.push({
      candidate: inspected.candidate,
      status: removal.ok ? "removed" : "failed",
      ...(removal.detail === undefined ? {} : { detail: removal.detail }),
    });
  }

  if (needsMetadataPrune || ctx.apply) {
    await pruneRepoWorktreeMetadataAndDirs(ctx);
  }

  return { inspected: nonMain.length, candidates, actions, warnings };
}

export async function sweepWorktrees(
  options: SweepWorktreesOptions,
): Promise<SurfaceSweepResult> {
  const heldReason = options.liveness.holdSurfaces.get("worktrees");
  if (heldReason !== undefined) {
    return {
      surface: "worktrees",
      heldReason,
      inspectedCount: 0,
      candidates: [],
      actions: [],
      warnings: [],
    };
  }

  const runner = options.runner ?? defaultCommandRunner;
  const homeDir = options.homeDir ?? Bun.env["HOME"] ?? os.homedir();
  const defaultGitDirs =
    options.liveness.platform === "win32"
      ? [path.join(homeDir, "git"), path.join(homeDir, "Git")]
      : [path.join(homeDir, "git")];
  const gitDirs = options.gitDirs ?? defaultGitDirs;
  const worktreeMinAgeMs =
    options.worktreeMinAgeMs ?? DEFAULT_WORKTREE_MIN_AGE_MS;
  const nowMs = options.nowMs ?? Date.now();
  const protectedPaths = collectActiveProtectedWorktreePaths(
    options.liveness,
    options.leases ?? [],
    options.selfCwd ?? process.cwd(),
  );

  const repos = await discoverGitRepositories({
    gitDirs,
    platform: options.liveness.platform,
  });

  let inspectedCount = 0;
  const candidates: TendCandidate[] = [];
  const actions: TendActionOutcome[] = [];
  const warnings: string[] = [];

  for (const repoPath of repos) {
    const repoSweep = await sweepRepositoryWorktrees({
      repoPath,
      protectedPaths,
      forumNoticePaths: options.liveness.forumNoticePaths,
      platform: options.liveness.platform,
      runner,
      apply: options.apply,
      worktreeMinAgeMs,
      checkPullRequests: options.checkPullRequests ?? true,
      includeClosedPrs: options.includeClosedPrs ?? false,
      nowMs,
      homeDir,
    });
    inspectedCount += repoSweep.inspected;
    candidates.push(...repoSweep.candidates);
    actions.push(...repoSweep.actions);
    warnings.push(...repoSweep.warnings);
  }

  return {
    surface: "worktrees",
    inspectedCount,
    candidates,
    actions,
    warnings,
  };
}
