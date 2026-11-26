import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectHcTerminals } from "./liveness.ts";
import {
  canonicalizeExistingPath,
  DEFAULT_WORKTREE_MIN_AGE_MS,
  isPathInside,
} from "./paths.ts";
import {
  defaultCommandRunner,
  isProcessAliveByKillZero,
} from "./process-probe.ts";
import type {
  ClassifiedLease,
  CommandRunner,
  LivenessSnapshot,
  SurfaceSweepResult,
  TendActionOutcome,
  TendCandidate,
  TendDecision,
} from "./types.ts";
import {
  applyWorktreeRemoval,
  removeEmptyChildDirectories,
} from "./worktrees-apply.ts";
import {
  directoryExists,
  fileOrDirExists,
  parsePorcelainWorktrees,
  resolveDefaultBranch,
  type WorktreePorcelainEntry,
} from "./worktrees-git.ts";
import {
  collectWorktreeHoldSources,
  fetchRepoPullRequests,
  inspectWorktree,
  type RepoSweepContext,
  type WorktreeInspection,
} from "./worktrees-inspect.ts";
import type { WorktreeDecision } from "./worktrees-policy.ts";

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
  /** Liveness of the pid named in a Claude-agent worktree lock. */
  readonly isPidAlive?: ((pid: number) => boolean) | undefined;
};

type RepoSweepResult = {
  readonly inspected: number;
  readonly candidates: TendCandidate[];
  readonly actions: TendActionOutcome[];
  readonly decisions: TendDecision[];
  readonly warnings: string[];
};

function worktreeParentDirectories(ctx: RepoSweepContext): string[] {
  return [
    path.join(ctx.homeDir, ".herdr", "worktrees", path.basename(ctx.repoPath)),
    path.join(ctx.repoPath, ".claude", "worktrees"),
  ];
}

/**
 * Directories in the places worktrees are created that git has no worktree
 * for. They are reported and never removed: nothing here knows what they are.
 */
async function findUnknownWorktreeDirectories(
  ctx: RepoSweepContext,
  worktrees: readonly WorktreePorcelainEntry[],
): Promise<string[]> {
  const known: string[] = [];
  for (const wt of worktrees) {
    known.push(await canonicalizeExistingPath(wt.path, ctx.platform));
  }
  const unknown: string[] = [];
  for (const parentDir of worktreeParentDirectories(ctx)) {
    let names: string[];
    try {
      names = await readdir(parentDir);
    } catch {
      continue;
    }
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      const child = path.join(parentDir, name);
      if (!(await directoryExists(child))) {
        continue;
      }
      const canonicalChild = await canonicalizeExistingPath(
        child,
        ctx.platform,
      );
      // A directory may also be the parent of worktrees named `a/b`.
      if (
        !known.some((wtPath) =>
          isPathInside(wtPath, canonicalChild, ctx.platform),
        )
      ) {
        unknown.push(child);
      }
    }
  }
  return unknown;
}

async function pruneRepoWorktreeMetadataAndDirs(
  ctx: RepoSweepContext,
): Promise<void> {
  await ctx.runner(["git", "worktree", "prune"], {
    cwd: ctx.repoPath,
    timeoutMs: 5000,
  });
  for (const parentDir of worktreeParentDirectories(ctx)) {
    await removeEmptyChildDirectories(parentDir);
  }
}

function toCandidate(
  wt: WorktreePorcelainEntry,
  decision: WorktreeDecision,
  ctx: RepoSweepContext,
): TendCandidate {
  if (decision.action === "prune-metadata") {
    return {
      id: `worktree-prunable:${wt.path}`,
      surface: "worktrees",
      kind: "worktree-metadata",
      target: wt.path,
      reason: decision.reason,
    };
  }
  return {
    id: `worktree:${wt.path}`,
    surface: "worktrees",
    kind: wt.detached ? "detached-worktree" : "branch-worktree",
    target: wt.path,
    reason: decision.reason,
    ...(decision.idleMs === undefined
      ? {}
      : { ageSeconds: Math.floor(decision.idleMs / 1000) }),
    metadata: {
      repo: ctx.repoPath,
      ...(wt.branch === undefined ? {} : { branch: wt.branch }),
      locked: wt.locked,
      preserve: decision.preserve.join(","),
      deleteBranch: decision.deleteBranch,
    },
  };
}

/**
 * A reason to leave a removable worktree alone that only shows up now: a
 * Herdr terminal opened in it after the liveness snapshot, or Herdr can no
 * longer be asked.
 */
async function recheckLiveTerminals(
  wt: WorktreePorcelainEntry,
  ctx: RepoSweepContext,
): Promise<{ readonly category: string; readonly reason: string } | null> {
  const terminals = await ctx.listLiveTerminals();
  if (terminals === null) {
    return {
      category: "Herdr sessions unknown",
      reason:
        "hc ls --json failed before removal; live Herdr sessions cannot be seen",
    };
  }
  const canonicalWt = await canonicalizeExistingPath(wt.path, ctx.platform);
  for (const terminal of terminals) {
    for (const cwd of [terminal.cwd, terminal.foregroundCwd]) {
      if (cwd !== undefined && isPathInside(cwd, canonicalWt, ctx.platform)) {
        return {
          category: "live Herdr terminal",
          reason: `live Herdr terminal appeared during the sweep: ${cwd}`,
        };
      }
    }
  }
  return null;
}

/** Act on one candidate and say what became of the worktree. */
async function actOnCandidate(
  wt: WorktreePorcelainEntry,
  inspection: WorktreeInspection,
  candidate: TendCandidate,
  ctx: RepoSweepContext,
): Promise<{
  readonly action: TendActionOutcome;
  readonly decision: TendDecision;
}> {
  const { decision } = inspection;
  const record: TendDecision = {
    target: wt.path,
    action: decision.action,
    category: decision.category,
    reason: decision.reason,
  };
  if (!ctx.apply) {
    return { action: { candidate, status: "planned" }, decision: record };
  }
  if (decision.action === "prune-metadata") {
    return { action: { candidate, status: "removed" }, decision: record };
  }
  if (inspection.gitDir === undefined) {
    throw new Error(`No git dir was resolved for removable ${wt.path}`);
  }
  const held = await recheckLiveTerminals(wt, ctx);
  if (held !== null) {
    return {
      action: { candidate, status: "skipped", detail: held.reason },
      decision: { target: wt.path, action: "keep", ...held },
    };
  }
  const outcome = await applyWorktreeRemoval({
    repoPath: ctx.repoPath,
    wt,
    gitDir: inspection.gitDir,
    decision,
    runner: ctx.runner,
    nowMs: ctx.nowMs,
  });
  return {
    action: {
      candidate,
      status: outcome.status,
      ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
    },
    decision:
      outcome.status === "removed"
        ? record
        : {
            target: wt.path,
            action: "keep",
            category: "removal failed",
            reason: outcome.detail ?? "removal failed",
          },
  };
}

async function sweepRepositoryWorktrees(
  ctx: RepoSweepContext,
): Promise<RepoSweepResult> {
  const result: RepoSweepResult = {
    inspected: 0,
    candidates: [],
    actions: [],
    decisions: [],
    warnings: [],
  };
  const listRes = await ctx.runner(["git", "worktree", "list", "--porcelain"], {
    cwd: ctx.repoPath,
    timeoutMs: 5000,
  });
  if (listRes.exitCode !== 0) {
    result.warnings.push(`git worktree list failed in ${ctx.repoPath}`);
    return result;
  }

  const nonMain = parsePorcelainWorktrees(listRes.stdout).slice(1);
  for (const unknownDir of await findUnknownWorktreeDirectories(ctx, nonMain)) {
    result.warnings.push(`Not a git worktree, left in place: ${unknownDir}`);
  }
  if (nonMain.length === 0) {
    return result;
  }

  const defaultBranch = await resolveDefaultBranch(ctx.repoPath, ctx.runner);
  if (defaultBranch === null) {
    result.warnings.push(
      `Skipping ${ctx.repoPath}: could not determine origin default branch`,
    );
    return { ...result, inspected: nonMain.length };
  }

  const prs = await fetchRepoPullRequests(ctx, nonMain, result.warnings);

  for (const wt of nonMain) {
    const inspection = await inspectWorktree(wt, defaultBranch, prs, ctx);
    const { decision } = inspection;
    if (decision.action === "keep") {
      result.decisions.push({
        target: wt.path,
        action: "keep",
        category: decision.category,
        reason: decision.reason,
      });
      continue;
    }
    const candidate = toCandidate(wt, decision, ctx);
    const acted = await actOnCandidate(wt, inspection, candidate, ctx);
    result.candidates.push(candidate);
    result.actions.push(acted.action);
    result.decisions.push(acted.decision);
  }

  if (ctx.apply) {
    await pruneRepoWorktreeMetadataAndDirs(ctx);
  }

  return { ...result, inspected: nonMain.length };
}

export async function sweepWorktrees(
  options: SweepWorktreesOptions,
): Promise<SurfaceSweepResult> {
  // Without `hc ls` a live Herdr session is invisible, and a worktree that is
  // in use would look idle.
  const heldReason =
    options.liveness.holdSurfaces.get("worktrees") ??
    (options.liveness.hcAvailable
      ? undefined
      : "hc ls --json unavailable; live Herdr sessions cannot be seen");
  if (heldReason !== undefined) {
    return {
      surface: "worktrees",
      heldReason,
      inspectedCount: 0,
      candidates: [],
      actions: [],
      decisions: [],
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
  const { processes, platform, localHostAliases } = options.liveness;
  const probePid = options.isPidAlive ?? isProcessAliveByKillZero;
  const listLiveTerminals = async () => {
    const live = await collectHcTerminals({
      runner,
      homeDir,
      platform,
      localAliases: localHostAliases,
    });
    return live.available ? live.terminals : null;
  };
  const holds = collectWorktreeHoldSources(
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
  const decisions: TendDecision[] = [];
  const warnings: string[] = [];

  for (const repoPath of repos) {
    const repoSweep = await sweepRepositoryWorktrees({
      repoPath,
      holds,
      platform: options.liveness.platform,
      runner,
      apply: options.apply,
      worktreeMinAgeMs: options.worktreeMinAgeMs ?? DEFAULT_WORKTREE_MIN_AGE_MS,
      checkPullRequests: options.checkPullRequests ?? true,
      includeClosedPrs: options.includeClosedPrs ?? false,
      nowMs: options.nowMs ?? Date.now(),
      homeDir,
      isPidAlive: (pid) => processes.has(pid) || probePid(pid),
      processStartOf: (pid) => processes.get(pid)?.processStart,
      listLiveTerminals,
    });
    inspectedCount += repoSweep.inspected;
    candidates.push(...repoSweep.candidates);
    actions.push(...repoSweep.actions);
    decisions.push(...repoSweep.decisions);
    warnings.push(...repoSweep.warnings);
  }

  return {
    surface: "worktrees",
    inspectedCount,
    candidates,
    actions,
    decisions,
    warnings,
  };
}
