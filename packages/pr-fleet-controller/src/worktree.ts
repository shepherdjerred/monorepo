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

  // A worktree UNDER `#worktreeRoot` is a fleet-managed, disposable worktree.
  // The operator may have the same PR branch checked out in their own normal
  // worktree elsewhere; `findWorktree` prefers a fleet worktree but falls back
  // to reusing an operator worktree in place (see its note), and
  // `assignWorktreeBranch` guards that reuse so the operator's uncommitted work
  // is never `reset --hard`-ed away and their committed-but-unpushed work is
  // never force-pushed under the fleet's PR.
  #isFleetWorktree(worktreePath: string): boolean {
    const relative = path.relative(this.#worktreeRoot, worktreePath);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  }

  // Find a worktree that already has one of `branches` checked out. Git forbids
  // the same branch in two worktrees, so a `git worktree add` for a branch the
  // operator already holds fails and parks the PR for the whole run. To let the
  // fleet make progress on such a PR, reuse that existing checkout in place: a
  // fleet-owned worktree is always preferred (disposable, safe to hard-reset),
  // and an operator worktree is returned only as a fallback — `assignWorktreeBranch`
  // refuses to reuse it while it is dirty or when its HEAD has diverged from the
  // PR head, so operator edits are never lost and never force-pushed.
  async findWorktree(branches: string[]): Promise<string | null> {
    const output = await this.#mustRun("git", [
      "worktree",
      "list",
      "--porcelain",
    ]);
    let currentPath: string | null = null;
    let operatorFallback: string | null = null;
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice("worktree ".length);
      }
      if (line.startsWith("branch refs/heads/")) {
        const branch = line.slice("branch refs/heads/".length);
        if (currentPath !== null && branches.includes(branch)) {
          if (this.#isFleetWorktree(currentPath)) {
            return currentPath;
          }
          operatorFallback ??= currentPath;
        }
      }
    }
    return operatorFallback;
  }

  // Is a worktree registered at exactly this path, regardless of what (if any)
  // branch it currently has checked out? The branch-based `findWorktree` cannot
  // see a DETACHED worktree — a git-spice restack halted on a conflict, or a
  // controller restart mid-restack, leaves `git worktree list` with no
  // `branch refs/heads/...` line for it — so provisioning needs a path-based
  // check to recognize its own stack worktree.
  async #worktreeRegisteredAt(worktreePath: string): Promise<boolean> {
    const output = await this.#mustRun("git", [
      "worktree",
      "list",
      "--porcelain",
    ]);
    const target = path.resolve(worktreePath);
    for (const line of output.split("\n")) {
      if (
        line.startsWith("worktree ") &&
        path.resolve(line.slice("worktree ".length)) === target
      ) {
        return true;
      }
    }
    return false;
  }

  // A restack halted on a conflict leaves `worktreePath` mid-rebase (HEAD
  // detached with conflicted index entries). Detect the stopped rebase via
  // `REBASE_HEAD` — the ref Git maintains only while a rebase is paused — and
  // abort it so the shared worktree returns to a clean, branch-attached state
  // that `assignWorktreeBranch` can sync. The controller re-diagnoses and
  // re-attempts the restack from scratch, so nothing durable is lost: the
  // branch's commits remain and only the partial rebase is discarded.
  async #abortInProgressRebase(worktreePath: string): Promise<void> {
    const rebaseInProgress = await this.#run({
      executable: "git",
      args: ["rev-parse", "--verify", "--quiet", "REBASE_HEAD"],
      cwd: worktreePath,
      timeoutMs: 30_000,
    });
    if (rebaseInProgress.exitCode === 0) {
      await this.#mustRun("git", ["rebase", "--abort"], worktreePath);
    }
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
    // Reusing an operator-owned worktree in place: `findWorktree` falls back to
    // the operator's own checkout when they already hold this PR's branch (git
    // forbids the same branch in two worktrees, so the fleet cannot provision
    // its own). That checkout is `onBranch` by definition, so the switch guard
    // below never fires for it — yet the sync further down `reset --hard`s the
    // working tree. Refuse while the operator worktree carries uncommitted work
    // so their edits are never discarded; the PR pauses with an actionable
    // message instead of silently losing local changes.
    if (!this.#isFleetWorktree(worktree)) {
      const dirtyOutput = await this.#mustRun(
        "git",
        ["status", "--porcelain"],
        worktree,
      );
      if (dirtyOutput.trim().length > 0) {
        throw new Error(
          `Operator worktree ${worktree} has uncommitted changes; refusing to reuse it for PR #${n}. Commit or stash them, or remove the worktree, to let the fleet work this PR.`,
        );
      }
    }
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
      // Source fully qualified (`refs/pull/N/head`) on purpose: the unqualified
      // `pull/N/head` resolves to the existing local `pullRef` once it exists,
      // so git prunes the destination ("- [deleted] (none)") at exit 0 and the
      // following rev-parse fails. See the matching note in environment.ts.
      `refs/pull/${n}/head:${pullRef}`,
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
      // An operator-owned worktree must sit exactly at the fetched PR head.
      // Working-tree cleanliness is not enough: a clean checkout can still hold
      // committed-but-unpushed operator work (WIP, an unrelated branch tip), and
      // the ahead-of-remote branch below would preserve that local HEAD, which
      // `GitOperations.#submitBranch` later force-pushes — silently publishing
      // the operator's commits under this PR. Only a fleet-owned worktree may
      // carry an unpublished fix forward (it authored the commit); refuse an
      // operator worktree that has diverged so the PR pauses with an actionable
      // message instead.
      if (!this.#isFleetWorktree(worktree)) {
        throw new Error(
          `Operator worktree ${worktree} is at ${localHead}, not PR #${n} head ${fetchedHead}; refusing to reuse it because publishing would force-push the operator's local commits. Push or remove them, or remove the worktree, to let the fleet work this PR.`,
        );
      }
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
    // The fleet's stack worktree lives at this deterministic path. If it is
    // already registered but was missed by the branch-based lookups above (here
    // and the sibling-branch lookup in the caller), it is DETACHED — a restack
    // stopped on a conflict. Reuse it by path, aborting the incomplete rebase,
    // instead of trying to `git worktree add` a second worktree at the occupied
    // path (which fails and pauses the PR).
    if (await this.#worktreeRegisteredAt(worktreePath)) {
      await this.#abortInProgressRebase(worktreePath);
      return worktreePath;
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
