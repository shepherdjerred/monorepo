import { readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import type { CommandRunner } from "./types.ts";
import {
  isGitPathTooLongDeletionError,
  type WorktreePorcelainEntry,
} from "./worktrees-git.ts";
import type { WorktreeDecision } from "./worktrees-policy.ts";
import {
  rescueRefName,
  type RescueResult,
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
    return {
      ok: false,
      detail:
        rmRes.stderr.trim() ||
        `git worktree remove exited ${String(rmRes.exitCode)}`,
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

async function preserveWork(options: {
  readonly wt: WorktreePorcelainEntry;
  readonly gitDir: string;
  readonly decision: WorktreeDecision;
  readonly runner: CommandRunner;
  readonly nowMs: number;
}): Promise<RescueResult | null> {
  const { wt, decision, runner, nowMs } = options;
  const ref = rescueRefName(wt.path, nowMs);
  if (decision.preserve.includes("dirty-snapshot")) {
    return snapshotDirtyWorktree({
      wtPath: wt.path,
      gitDir: options.gitDir,
      ref,
      runner,
      nowMs,
    });
  }
  return decision.preserve.includes("detached-head-ref")
    ? writeRescueRef({ cwd: wt.path, ref, commit: wt.headSha, runner })
    : null;
}

async function deleteWorktreeBranch(
  repoPath: string,
  branch: string,
  decision: WorktreeDecision,
  runner: CommandRunner,
): Promise<string | undefined> {
  if (decision.deleteBranch === "none") {
    return `branch ${branch} kept`;
  }
  const flag = decision.deleteBranch === "force-delete" ? "-D" : "-d";
  const branchRes = await runner(["git", "branch", flag, branch], {
    cwd: repoPath,
    timeoutMs: 5000,
  });
  return branchRes.exitCode === 0
    ? undefined
    : `branch ${branch} kept (${branchRes.stderr.trim() || "not deleted"})`;
}

type WorktreeRemovalOutcome = {
  readonly status: "removed" | "failed";
  readonly detail?: string | undefined;
  readonly rescueRef?: string | undefined;
};

/**
 * Carry out a `remove` decision. Work is preserved first, and a worktree
 * whose work could not be preserved is left exactly as it was.
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
  const rescue = await preserveWork(options);
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
      detail: [removed.detail, savedNote]
        .filter((part) => part !== undefined)
        .join("; "),
      rescueRef,
    };
  }
  const branchNote =
    wt.branch === undefined
      ? undefined
      : await deleteWorktreeBranch(repoPath, wt.branch, decision, runner);
  const notes = [savedNote, branchNote].filter((part) => part !== undefined);
  return {
    status: "removed",
    ...(notes.length === 0 ? {} : { detail: notes.join("; ") }),
    rescueRef,
  };
}

export async function removeEmptyChildDirectories(
  parentDir: string,
): Promise<void> {
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
