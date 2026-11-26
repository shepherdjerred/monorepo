import os from "node:os";
import path from "node:path";
import {
  type CloneFile,
  cloneFileCopyOnWrite,
  directoryDevice,
} from "./dedupe/clone.ts";
import { dedupeWorktreePass } from "./dedupe/plan.ts";
import type {
  DedupeContext,
  DedupePassResult,
  DedupeRefresh,
  DedupeRegistry,
  DedupeWorktree,
} from "./dedupe/types.ts";
import { pruneDedupeState } from "./dedupe/state.ts";
import {
  canonicalizeExistingPath,
  isPathInside,
  resolveTendPaths,
  type TendPaths,
} from "./paths.ts";
import {
  defaultCommandRunner,
  isProcessAliveByKillZero,
} from "./process-probe.ts";
import {
  type CommandRunner,
  formatByteSize,
  type LivenessSnapshot,
  type SurfaceSweepResult,
  type TendActionOutcome,
  type TendCandidate,
} from "./types.ts";
import { discoverGitRepositories } from "./worktrees.ts";
import {
  directoryExists,
  isMidGitOperation,
  parsePorcelainWorktrees,
  resolveWorktreeGitDir,
  type WorktreePorcelainEntry,
} from "./worktrees-git.ts";
import {
  collectSessionHoldSources,
  findLiveHold,
  type WorktreeHoldSource,
} from "./worktrees-inspect.ts";
import {
  classifyWorktreeLock,
  type WorktreeLockProbe,
} from "./worktrees-policy.ts";

/** Below this a file is not worth an inode change and a re-hash by git. */
export const DEFAULT_DEDUPE_MIN_SIZE_BYTES = 64 * 1024;

export type SweepDedupeOptions = {
  readonly liveness: LivenessSnapshot;
  readonly runner?: CommandRunner | undefined;
  readonly apply: boolean;
  readonly paths?: TendPaths | undefined;
  readonly gitDirs?: readonly string[] | undefined;
  readonly homeDir?: string | undefined;
  readonly minSizeBytes?: number | undefined;
  /** Replace files only in this worktree; every worktree still lends its own. */
  readonly worktree?: string | undefined;
  readonly cloneFile?: CloneFile | undefined;
  /** `false` never refreshes an index after replacing files. */
  readonly refreshIndex?: boolean | undefined;
  /** Device a directory is on; replaced in tests to stand in for a volume. */
  readonly deviceOf?:
    ((directory: string) => Promise<number | null>) | undefined;
  readonly selfCwd?: string | undefined;
  readonly nowMs?: number | undefined;
};

type RepoScope = {
  readonly repoPath: string;
  readonly platform: NodeJS.Platform;
  readonly forumNoticePaths: ReadonlySet<string>;
  /** Canonical path of the only worktree to replace files in, if limited. */
  readonly onlyWorktree: string | undefined;
  readonly sessionHolds: readonly WorktreeHoldSource[];
  readonly lockProbe: WorktreeLockProbe;
};

/**
 * Why a worktree counts as in use, by the reaper's own signals. Dedupe still
 * replaces files there; it only declines to take the index lock.
 */
function liveReasonFor(
  entry: WorktreePorcelainEntry,
  canonicalWt: string,
  scope: RepoScope,
): string | undefined {
  const lock = classifyWorktreeLock({
    locked: entry.locked,
    lockReason: entry.lockReason,
    ...scope.lockProbe,
  });
  return lock.kind === "claude-agent" && lock.alive
    ? "locked by a live Claude agent"
    : findLiveHold(canonicalWt, scope.sessionHolds, scope.platform)?.category;
}

function isNamedByForumNotice(canonicalWt: string, scope: RepoScope): boolean {
  for (const noticePath of scope.forumNoticePaths) {
    if (
      isPathInside(noticePath, canonicalWt, scope.platform) ||
      isPathInside(canonicalWt, noticePath, scope.platform)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The repository's worktrees that can take part, main checkout first.
 * A worktree in the middle of a rebase, merge, cherry-pick or bisect is left
 * out entirely: its files are changing under git's own hands.
 */
async function listRepoWorktrees(
  scope: RepoScope,
  runner: CommandRunner,
  warnings: string[],
): Promise<DedupeWorktree[]> {
  const listRes = await runner(["git", "worktree", "list", "--porcelain"], {
    cwd: scope.repoPath,
    timeoutMs: 5000,
  });
  if (listRes.exitCode !== 0) {
    warnings.push(`git worktree list failed in ${scope.repoPath}`);
    return [];
  }
  const lenders: DedupeWorktree[] = [];
  const limited: DedupeWorktree[] = [];
  for (const entry of parsePorcelainWorktrees(listRes.stdout)) {
    if (entry.prunable || !(await directoryExists(entry.path))) {
      continue;
    }
    const gitDir = await resolveWorktreeGitDir(entry.path, runner);
    if (gitDir === null || (await isMidGitOperation(gitDir))) {
      continue;
    }
    const canonical = await canonicalizeExistingPath(
      entry.path,
      scope.platform,
    );
    const selected =
      scope.onlyWorktree === undefined || scope.onlyWorktree === canonical;
    const worktree: DedupeWorktree = {
      path: entry.path,
      gitDir,
      isTarget: selected && !isNamedByForumNotice(canonical, scope),
      liveReason: liveReasonFor(entry, canonical, scope),
    };
    // A worktree named by --worktree goes last, so that every other worktree
    // has offered its copies before this one is read.
    if (scope.onlyWorktree === canonical) {
      limited.push(worktree);
    } else {
      lenders.push(worktree);
    }
  }
  return [...lenders, ...limited];
}

const REFRESH_NOTES: Readonly<Record<DedupeRefresh, string | undefined>> = {
  "not-needed": undefined,
  refreshed: undefined,
  live: "index left for the live session's next git status",
  disabled: "index not refreshed (--no-refresh)",
  failed: "index refresh failed; the next git status refreshes it",
};

/** What differed from the plan, and what was left for git to catch up on. */
function describeOutcome(
  wt: DedupeWorktree,
  pass: DedupePassResult,
): string | undefined {
  const notes: string[] = [];
  const refreshNote = REFRESH_NOTES[pass.refresh];
  if (refreshNote !== undefined) {
    notes.push(
      pass.refresh === "live" && wt.liveReason !== undefined
        ? `${refreshNote} (${wt.liveReason})`
        : refreshNote,
    );
  }
  if (pass.replacedFiles === pass.plannedFiles) {
    return notes[0];
  }
  if (pass.replacedFiles > 0) {
    notes.push(
      `${String(pass.replacedFiles)} file(s), ${formatByteSize(pass.replacedBytes)} now shared`,
    );
  }
  if (pass.changedFiles > 0) {
    notes.push(
      `${String(pass.changedFiles)} file(s) changed during the run and were left alone`,
    );
  }
  if (pass.failedFiles > 0) {
    notes.push(
      `${String(pass.failedFiles)} file(s) could not be replaced (${pass.firstFailure ?? "unknown error"})`,
    );
  }
  return notes.length === 0 ? undefined : notes.join("; ");
}

function toAction(
  wt: DedupeWorktree,
  pass: DedupePassResult,
  scope: RepoScope,
  apply: boolean,
): TendActionOutcome | null {
  if (pass.plannedFiles === 0) {
    return null;
  }
  const candidate: TendCandidate = {
    id: `dedupe:${wt.path}`,
    surface: "dedupe",
    kind: "worktree-files",
    target: wt.path,
    reason: `${String(pass.plannedFiles)} file(s), ${formatByteSize(pass.plannedBytes)} identical to another worktree's`,
    metadata: {
      repo: scope.repoPath,
      files: pass.plannedFiles,
      bytes: pass.plannedBytes,
      replacedFiles: pass.replacedFiles,
      replacedBytes: pass.replacedBytes,
      refresh: pass.refresh,
      filteredFiles: pass.filteredFiles,
      staleSourceFiles: pass.staleSourceFiles,
    },
  };
  if (!apply) {
    return { candidate, status: "planned" };
  }
  const detail = describeOutcome(wt, pass);
  let status: TendActionOutcome["status"] = "skipped";
  if (pass.failedFiles > 0) {
    status = "failed";
  } else if (pass.replacedFiles > 0) {
    status = "deduped";
  }
  return { candidate, status, ...(detail === undefined ? {} : { detail }) };
}

type DedupeTally = {
  inspectedCount: number;
  matchedWorktree: boolean;
  filteredFiles: number;
  staleSourceFiles: number;
  readonly actions: TendActionOutcome[];
  readonly warnings: string[];
};

async function dedupeRepository(
  scope: RepoScope,
  ctx: DedupeContext,
  tally: DedupeTally,
): Promise<void> {
  const worktrees = await listRepoWorktrees(scope, ctx.runner, tally.warnings);
  if (!worktrees.some((wt) => wt.isTarget)) {
    return;
  }
  tally.matchedWorktree = true;
  const registry: DedupeRegistry = new Map();
  for (const wt of worktrees) {
    const pass = await dedupeWorktreePass(wt, registry, ctx);
    tally.warnings.push(...pass.warnings);
    tally.filteredFiles += pass.filteredFiles;
    tally.staleSourceFiles += pass.staleSourceFiles;
    if (!wt.isTarget) {
      continue;
    }
    tally.inspectedCount += 1;
    const action = toAction(wt, pass, scope, ctx.apply);
    if (action !== null) {
      tally.actions.push(action);
    }
  }
}

/** What the whole run left alone, and why, as one line per reason. */
function summaryWarnings(tally: DedupeTally, ctx: DedupeContext): string[] {
  const warnings: string[] = [];
  if (tally.filteredFiles > 0) {
    warnings.push(
      `${String(tally.filteredFiles)} file(s) left alone: a filter, ident or working-tree-encoding attribute means equal blobs do not prove equal files`,
    );
  }
  if (tally.staleSourceFiles > 0) {
    warnings.push(
      `${String(tally.staleSourceFiles)} file(s) left alone: the copy they would be cloned from was no longer the blob its worktree listed; a later run takes them`,
    );
  }
  for (const [device, detail] of ctx.unsupportedDevices) {
    warnings.push(
      `Copy-on-write clones are not supported on device ${String(device)} (${detail}); nothing there was replaced`,
    );
  }
  return warnings;
}

/**
 * Replace tracked files that are byte-identical across a repository's
 * worktrees with copy-on-write clones of one copy. Nothing is deleted and no
 * content changes; the duplicate blocks are simply no longer stored twice.
 */
export async function sweepDedupe(
  options: SweepDedupeOptions,
): Promise<SurfaceSweepResult> {
  const { platform } = options.liveness;
  const empty = { surface: "dedupe", inspectedCount: 0 } as const;
  const none = { candidates: [], actions: [], warnings: [] };
  const heldReason = options.liveness.holdSurfaces.get("dedupe");
  if (heldReason !== undefined) {
    return { ...empty, ...none, heldReason };
  }
  if (platform !== "darwin") {
    return {
      ...empty,
      ...none,
      skippedReason:
        "copy-on-write clones need APFS; dedupe only runs on macOS",
    };
  }

  const homeDir = options.homeDir ?? Bun.env["HOME"] ?? os.homedir();
  const paths = options.paths ?? resolveTendPaths({ homeDir });
  const ctx: DedupeContext = {
    runner: options.runner ?? defaultCommandRunner,
    apply: options.apply,
    minSizeBytes: options.minSizeBytes ?? DEFAULT_DEDUPE_MIN_SIZE_BYTES,
    stateDir: path.join(paths.rootDir, "dedupe"),
    cloneFile: options.cloneFile ?? cloneFileCopyOnWrite,
    refreshIndex: options.refreshIndex ?? true,
    isPidAlive: isProcessAliveByKillZero,
    deviceOf: options.deviceOf ?? directoryDevice,
    unsupportedDevices: new Map(),
  };
  const onlyWorktree =
    options.worktree === undefined
      ? undefined
      : await canonicalizeExistingPath(options.worktree, platform);
  const gitDirs = options.gitDirs ?? [path.join(homeDir, "git")];
  const { processes } = options.liveness;
  const sessionHolds = collectSessionHoldSources(
    options.liveness,
    options.selfCwd ?? process.cwd(),
  );
  const lockProbe: WorktreeLockProbe = {
    isPidAlive: (pid) => processes.has(pid) || isProcessAliveByKillZero(pid),
    processStartOf: (pid) => processes.get(pid)?.processStart,
  };
  const tally: DedupeTally = {
    inspectedCount: 0,
    matchedWorktree: false,
    filteredFiles: 0,
    staleSourceFiles: 0,
    actions: [],
    warnings: [],
  };

  for (const repoPath of await discoverGitRepositories({ gitDirs, platform })) {
    await dedupeRepository(
      {
        repoPath,
        platform,
        forumNoticePaths: options.liveness.forumNoticePaths,
        onlyWorktree,
        sessionHolds,
        lockProbe,
      },
      ctx,
      tally,
    );
  }
  if (options.worktree !== undefined && !tally.matchedWorktree) {
    throw new Error(
      `${options.worktree} is not a worktree that can be deduplicated: it must belong to a repository under ${gitDirs.join(", ")}, not be mid rebase or merge, and not be named by a Forum notice`,
    );
  }
  tally.warnings.push(...summaryWarnings(tally, ctx));
  if (options.apply) {
    await pruneDedupeState(ctx.stateDir);
  }
  return {
    surface: "dedupe",
    inspectedCount: tally.inspectedCount,
    candidates: tally.actions.map((action) => action.candidate),
    actions: tally.actions,
    warnings: tally.warnings,
  };
}
