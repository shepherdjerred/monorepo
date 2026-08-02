import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { CommandRequest, CommandResult } from "./ports.ts";
import type { PrIdentity } from "./schemas.ts";

type WorktreeManagerDependencies = {
  checkout: string;
  worktreeRoot: string;
  run: (request: CommandRequest) => Promise<CommandResult>;
  mustRun: (
    executable: string,
    args: string[],
    cwd?: string,
    options?: { timeoutMs?: number; signal?: AbortSignal | undefined },
  ) => Promise<string>;
};

/**
 * Provisions and (re)assigns the one shared git worktree per stack. A single
 * worktree is reused across sibling PRs of a stack, so assignment must keep it
 * clean and synced to the target PR's head before a worker touches it.
 */
export class WorktreeManager {
  readonly #checkout: string;
  readonly #worktreeRoot: string;
  readonly #run: WorktreeManagerDependencies["run"];
  readonly #mustRun: WorktreeManagerDependencies["mustRun"];

  constructor(dependencies: WorktreeManagerDependencies) {
    this.#checkout = dependencies.checkout;
    this.#worktreeRoot = dependencies.worktreeRoot;
    this.#run = dependencies.run;
    this.#mustRun = dependencies.mustRun;
  }

  // Only a worktree UNDER `#worktreeRoot` is a fleet-managed worktree. The
  // operator may have the same PR branch checked out in their own normal
  // worktree elsewhere; returning that would let `assignWorktreeBranch`
  // `reset --hard` the operator's real edits. Restrict the search to
  // fleet-owned paths so only disposable fleet worktrees are ever reused.
  #isFleetWorktree(worktreePath: string): boolean {
    const relative = path.relative(this.#worktreeRoot, worktreePath);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  }

  async findWorktree(branches: string[]): Promise<string | null> {
    const output = await this.#mustRun("git", [
      "worktree",
      "list",
      "--porcelain",
    ]);
    let currentPath: string | null = null;
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice("worktree ".length);
      }
      if (line.startsWith("branch refs/heads/")) {
        const branch = line.slice("branch refs/heads/".length);
        if (
          currentPath !== null &&
          branches.includes(branch) &&
          this.#isFleetWorktree(currentPath)
        ) {
          return currentPath;
        }
      }
    }
    return null;
  }

  async assignWorktreeBranch(worktree: string, pr: PrIdentity): Promise<void> {
    const n = String(pr.number);
    const branch = pr.headRefName;
    const currentBranchOutput = await this.#mustRun(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      worktree,
    );
    const onBranch = currentBranchOutput.trim() === branch;
    // Refuse to carry another PR's uncommitted work across a branch switch. A
    // prior worker that ended blocked/failed on a DIFFERENT branch may have left
    // dirty edits; `git checkout` preserves non-conflicting modifications, so
    // those edits would ride onto — and could be published under — this PR. (A
    // dirty worktree already ON this PR's branch is this PR's own prior attempt
    // and is discarded by the hard-reset below, not carried over.)
    if (!onBranch) {
      const dirtyOutput = await this.#mustRun(
        "git",
        ["status", "--porcelain"],
        worktree,
      );
      if (dirtyOutput.trim().length > 0) {
        throw new Error(
          `Worktree ${worktree} has uncommitted changes; refusing to reassign it to PR #${n}`,
        );
      }
    }
    // Sync to the PR head. An external push may have advanced the branch since
    // this shared worktree last used it (or the local ref is stale from an
    // earlier provision). Fetch the authoritative PR head and verify it matches
    // the head the evidence was gathered against; a mismatch means the PR moved
    // and the whole snapshot is stale, so fail rather than edit an old commit.
    const pullRef = `refs/remotes/pull/${n}/head`;
    await this.#mustRun("git", [
      "fetch",
      "origin",
      `pull/${n}/head:${pullRef}`,
    ]);
    const fetchedOutput = await this.#mustRun(
      "git",
      ["rev-parse", pullRef],
      worktree,
    );
    const fetchedHead = fetchedOutput.trim();
    if (fetchedHead !== pr.headSha) {
      throw new Error(
        `PR #${n} advanced during worktree assignment (${pr.headSha} -> ${fetchedHead})`,
      );
    }
    if (!onBranch) {
      // A freshly-checked-out sibling branch carries no in-progress local work
      // of this PR; align it to the fetched head.
      await this.#mustRun("git", ["checkout", branch], worktree);
      await this.#mustRun("git", ["reset", "--hard", fetchedHead], worktree);
      return;
    }
    // Reuse of THIS PR's own branch. A prior worker may have committed a fix
    // locally whose publication (git-spice submit / push) then failed before it
    // reached the remote — the remote PR head is therefore unchanged
    // (== fetchedHead) while the local branch is one or more commits AHEAD.
    // Hard-resetting to fetchedHead would silently delete that completed fix, so
    // preserve local commits that sit on top of the fetched head (publication
    // can then be retried) and discard only the uncommitted working-tree edits.
    const localHeadOutput = await this.#mustRun(
      "git",
      ["rev-parse", "HEAD"],
      worktree,
    );
    const localHead = localHeadOutput.trim();
    if (localHead !== fetchedHead) {
      const aheadOfRemote = await this.#run({
        executable: "git",
        args: ["merge-base", "--is-ancestor", fetchedHead, localHead],
        cwd: worktree,
        timeoutMs: 30_000,
      });
      if (aheadOfRemote.exitCode === 0) {
        // fetchedHead is an ancestor of the local head: the local branch holds a
        // completed-but-unpublished fix. Keep the commit(s); reset only clears
        // the uncommitted working-tree edits.
        await this.#mustRun("git", ["reset", "--hard", localHead], worktree);
        return;
      }
    }
    // Local ref is at, behind, or diverged from the confirmed PR head: align to
    // the remote head, discarding prior failed-attempt working-tree edits.
    await this.#mustRun("git", ["reset", "--hard", fetchedHead], worktree);
  }

  async provisionWorktree(pr: PrIdentity, stackId: string): Promise<string> {
    if (pr.crossRepository) {
      throw new Error(
        `PR #${String(pr.number)} is cross-repository and needs an existing authorized worktree`,
      );
    }
    await mkdir(this.#worktreeRoot, { recursive: true });
    const worktreePath = path.join(this.#worktreeRoot, `stack-${stackId}`);
    const existing = await this.findWorktree([pr.headRefName]);
    if (existing !== null) {
      return existing;
    }
    const branchExists = await this.#run({
      executable: "git",
      args: ["show-ref", "--verify", "--quiet", `refs/heads/${pr.headRefName}`],
      cwd: this.#checkout,
      timeoutMs: 30_000,
    });
    if (branchExists.exitCode !== 0) {
      await this.#mustRun("git", [
        "fetch",
        "origin",
        `refs/heads/${pr.headRefName}:refs/heads/${pr.headRefName}`,
      ]);
    }
    await this.#mustRun("git", [
      "worktree",
      "add",
      worktreePath,
      pr.headRefName,
    ]);
    return worktreePath;
  }
}
