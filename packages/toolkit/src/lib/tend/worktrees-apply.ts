import { readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { canonicalizeExistingPath, isPathInside } from "./paths.ts";
import type { CommandRunner } from "./types.ts";
import {
  isGitPathTooLongDeletionError,
  type WorktreePorcelainEntry,
} from "./worktrees-git.ts";
import type { RepoSweepContext } from "./worktrees-inspect.ts";
import type { WorktreeDecision } from "./worktrees-policy.ts";
import {
  computeSnapshotTrees,
  rescueRefName,
  type RescueResult,
  type SnapshotTrees,
  snapshotDirtyWorktree,
  writeRescueRef,
} from "./worktrees-rescue.ts";
import { readWorktreeStatus } from "./worktrees-status.ts";

type RemovalResult = {
  readonly ok: boolean;
  readonly detail?: string | undefined;
};

async function isWorktreeClean(
  wtPath: string,
  runner: CommandRunner,
): Promise<boolean> {
  const status = await readWorktreeStatus(wtPath, runner);
  return status.kind === "clean";
}

async function removeWorktreeDirectory(options: {
  readonly repoPath: string;
  readonly wtPath: string;
  /** Uncommitted work is already in a rescue ref. */
  readonly snapshotted: boolean;
  readonly runner: CommandRunner;
}): Promise<RemovalResult> {
  const { repoPath, wtPath, snapshotted, runner } = options;
  const rmRes = await runner(
    ["git", "worktree", "remove", ...(snapshotted ? ["--force"] : []), wtPath],
    { cwd: repoPath, timeoutMs: 600_000 },
  );
  if (rmRes.exitCode === 0) {
    return { ok: true };
  }
  // Git cannot unlink over-long paths. Deleting the tree directly is safe
  // only when nothing in it is unsaved.
  const canDeleteDirectly =
    isGitPathTooLongDeletionError(rmRes.stderr) &&
    (snapshotted || (await isWorktreeClean(wtPath, runner)));
  if (!canDeleteDirectly) {
    const detail =
      rmRes.stderr.trim() ||
      `git worktree remove exited ${String(rmRes.exitCode)}`;
    // Git may have deleted part of the tree, or its own metadata, before it
    // gave up. Nothing here can prove the rest is disposable, so it stays.
    return {
      ok: false,
      detail: isGitPathTooLongDeletionError(rmRes.stderr)
        ? `${detail}; ${wtPath} may be partly removed and was left for a manual check`
        : detail,
    };
  }
  try {
    await rm(wtPath, { recursive: true, force: true });
    await runner(["git", "worktree", "prune"], {
      cwd: repoPath,
      timeoutMs: 5000,
    });
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Lock reason recorded in the worktree's git dir; `null` when unlocked. */
async function readLockReason(gitDir: string): Promise<string | null> {
  const lockFile = Bun.file(path.join(gitDir, "locked"));
  if (!(await lockFile.exists())) {
    return null;
  }
  const text = await lockFile.text();
  return text.trim();
}

type RemovalTarget = {
  readonly wt: WorktreePorcelainEntry;
  readonly gitDir: string;
  readonly runner: CommandRunner;
};

/**
 * What no longer matches the facts the decision was made on, if anything.
 * The decision is from the start of the sweep; by the time a worktree's turn
 * comes someone may have committed in it or locked it.
 */
async function changedSinceInspection(
  target: RemovalTarget,
): Promise<string | null> {
  const { wt, gitDir, runner } = target;
  const head = await runner(["git", "rev-parse", "HEAD"], {
    cwd: wt.path,
    timeoutMs: 5000,
  });
  if (head.exitCode !== 0) {
    return "HEAD could not be read";
  }
  const current = head.stdout.trim();
  if (current !== wt.headSha) {
    return `HEAD moved from ${wt.headSha.slice(0, 12)} to ${current.slice(0, 12)}`;
  }
  const expectedLock = wt.locked ? (wt.lockReason ?? "") : null;
  return (await readLockReason(gitDir)) === expectedLock
    ? null
    : "its lock changed";
}

async function preserveWork(
  target: RemovalTarget,
  decision: WorktreeDecision,
  nowMs: number,
): Promise<RescueResult | null> {
  const { wt, gitDir, runner } = target;
  const ref = rescueRefName(wt.path, nowMs);
  if (decision.preserve.includes("dirty-snapshot")) {
    return snapshotDirtyWorktree({
      wtPath: wt.path,
      gitDir,
      head: wt.headSha,
      ref,
      runner,
      nowMs,
    });
  }
  return decision.preserve.includes("detached-head-ref")
    ? writeRescueRef({ cwd: wt.path, ref, commit: wt.headSha, runner })
    : null;
}

/**
 * The last look before the worktree is deleted. A clean worktree is checked
 * by `git worktree remove` itself, but a forced removal checks nothing, so a
 * snapshotted worktree is read again here and must still be exactly what was
 * saved. An edit in the instant after this check is the one window left.
 */
async function changedSinceSnapshot(
  target: RemovalTarget,
  saved: SnapshotTrees | undefined,
): Promise<string | null> {
  const moved = await changedSinceInspection(target);
  if (moved !== null || saved === undefined) {
    return moved;
  }
  const now = await computeSnapshotTrees({
    wtPath: target.wt.path,
    gitDir: target.gitDir,
    runner: target.runner,
  });
  if (!now.ok) {
    return `its files could not be read again (${now.detail})`;
  }
  return now.indexTree === saved.indexTree && now.workTree === saved.workTree
    ? null
    : "files changed after they were saved";
}

/**
 * Why a branch must not be deleted by ref: some worktree has it checked out.
 * `git branch -D` refuses such a branch; deleting the ref directly does not,
 * and would leave that checkout on a branch that no longer exists.
 */
async function checkedOutProblem(
  repoPath: string,
  branch: string,
  runner: CommandRunner,
): Promise<string | null> {
  const res = await runner(
    ["git", "for-each-ref", "--format=%(worktreepath)", `refs/heads/${branch}`],
    { cwd: repoPath, timeoutMs: 5000 },
  );
  if (res.exitCode !== 0) {
    return "could not tell whether it is checked out";
  }
  const worktreePath = res.stdout.trim();
  return worktreePath.length === 0 ? null : `checked out in ${worktreePath}`;
}

/**
 * Delete the branch only if it is still the commit the decision was made on
 * and no worktree has it checked out. A forced delete is done as a
 * compare-and-delete of the ref, so a commit that lands on the branch in
 * between is never dropped with it.
 */
async function deleteWorktreeBranch(
  repoPath: string,
  wt: WorktreePorcelainEntry & { readonly branch: string },
  decision: WorktreeDecision,
  runner: CommandRunner,
): Promise<string | undefined> {
  const { branch } = wt;
  if (decision.deleteBranch === "none") {
    return `branch ${branch} kept`;
  }
  if (decision.deleteBranch === "force-delete") {
    // Another session can check the branch out once this worktree is gone.
    const problem = await checkedOutProblem(repoPath, branch, runner);
    if (problem !== null) {
      return `branch ${branch} kept (${problem})`;
    }
  }
  const argv =
    decision.deleteBranch === "force-delete"
      ? ["git", "update-ref", "-d", `refs/heads/${branch}`, wt.headSha]
      : ["git", "branch", "-d", branch];
  const branchRes = await runner(argv, { cwd: repoPath, timeoutMs: 5000 });
  if (branchRes.exitCode !== 0) {
    return `branch ${branch} kept (${branchRes.stderr.trim() || "not deleted"})`;
  }
  if (decision.deleteBranch === "force-delete") {
    // `git branch -D` also drops the branch's configuration; the exit code
    // only says whether there was any.
    await runner(["git", "config", "--remove-section", `branch.${branch}`], {
      cwd: repoPath,
      timeoutMs: 5000,
    });
  }
  return undefined;
}

type WorktreeRemovalOutcome = {
  /** `skipped`: the worktree changed during the sweep and was left alone. */
  readonly status: "removed" | "failed" | "skipped";
  readonly detail?: string | undefined;
  readonly rescueRef?: string | undefined;
};

function joinNotes(notes: readonly (string | undefined)[]): string {
  return notes.filter((part) => part !== undefined).join("; ");
}

/**
 * Carry out a `remove` decision. The worktree must still be what was
 * inspected, its work is preserved first, and it is read once more
 * immediately before it is deleted. A worktree that changed, or whose work
 * could not be preserved, is left exactly as it was.
 */
export async function applyWorktreeRemoval(options: {
  readonly repoPath: string;
  readonly wt: WorktreePorcelainEntry;
  readonly gitDir: string;
  readonly decision: WorktreeDecision;
  readonly runner: CommandRunner;
  readonly nowMs: number;
}): Promise<WorktreeRemovalOutcome> {
  const { repoPath, wt, decision, runner } = options;
  const target: RemovalTarget = { wt, gitDir: options.gitDir, runner };
  const stale = await changedSinceInspection(target);
  if (stale !== null) {
    return { status: "skipped", detail: `changed during the sweep: ${stale}` };
  }
  const rescue = await preserveWork(target, decision, options.nowMs);
  if (rescue !== null && !rescue.ok) {
    return {
      status: "failed",
      detail: `worktree kept: could not save its work (${rescue.detail})`,
    };
  }
  const rescueRef = rescue?.ref;
  const savedNote =
    rescueRef === undefined ? undefined : `work saved to ${rescueRef}`;

  // A daemon left watching a deleted tree never exits on its own. The exit
  // code only says whether one was running.
  await runner(["git", "fsmonitor--daemon", "stop"], {
    cwd: wt.path,
    timeoutMs: 10_000,
  });
  const changed = await changedSinceSnapshot(target, rescue?.trees);
  if (changed !== null) {
    return {
      status: "skipped",
      detail: joinNotes([`changed during the sweep: ${changed}`, savedNote]),
      rescueRef,
    };
  }
  if (decision.unlock) {
    await runner(["git", "worktree", "unlock", wt.path], {
      cwd: repoPath,
      timeoutMs: 5000,
    });
  }
  const removed = await removeWorktreeDirectory({
    repoPath,
    wtPath: wt.path,
    snapshotted: decision.preserve.includes("dirty-snapshot"),
    runner,
  });
  if (!removed.ok) {
    return {
      status: "failed",
      detail: joinNotes([removed.detail, savedNote]),
      rescueRef,
    };
  }
  const branchNote =
    wt.branch === undefined
      ? undefined
      : await deleteWorktreeBranch(
          repoPath,
          { ...wt, branch: wt.branch },
          decision,
          runner,
        );
  const notes = joinNotes([savedNote, branchNote]);
  return {
    status: "removed",
    ...(notes.length === 0 ? {} : { detail: notes }),
    rescueRef,
  };
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

function worktreeParentDirectories(ctx: RepoSweepContext): string[] {
  return [
    path.join(ctx.homeDir, ".herdr", "worktrees", path.basename(ctx.repoPath)),
    path.join(ctx.repoPath, ".claude", "worktrees"),
  ];
}

/**
 * Directories with something in them, in the places worktrees are created,
 * that git has no worktree for. They are reported and never removed: nothing
 * here knows what they are. An empty one is what a removed worktree leaves
 * behind, and an applied sweep clears those.
 */
export async function findUnknownWorktreeDirectories(
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
      if (!(await isNonEmptyDirectory(child))) {
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

async function isNonEmptyDirectory(dir: string): Promise<boolean> {
  try {
    const names = await readdir(dir);
    return names.length > 0;
  } catch {
    return false;
  }
}

export async function pruneRepoWorktreeMetadataAndDirs(
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
