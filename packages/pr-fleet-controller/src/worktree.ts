import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { CommandRequest, CommandResult } from "./ports.ts";
import type { PrIdentity, WorktreeContext } from "./schemas.ts";

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
  // `assignWorktreeBranch` adopts matching-branch inherited work without a
  // reset and reports its provenance so the worker can validate or question it.
  #isFleetWorktree(worktreePath: string): boolean {
    const relative = path.relative(this.#worktreeRoot, worktreePath);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  }

  // Find a worktree already holding a relevant branch. Git forbids the same
  // branch in two worktrees, so a `git worktree add` for a branch that is
  // already checked out fails and parks the PR for the whole run. To let the
  // fleet make progress, reuse an existing checkout in place.
  //
  // A fleet-owned worktree (disposable, safe to hard-reset onto the candidate)
  // is reused when it holds ANY of `fleetBranches` — the whole stack shares one
  // fleet worktree, so a sibling's checkout is fair game and is always preferred.
  //
  // An operator worktree is reused only as a fallback and only when
  // `allowOperatorFallback` is set and it holds the EXACT `candidateBranch`.
  // Matching a mere sibling would let the caller switch the operator's checkout
  // to a different branch and hard-reset it — changing their checkout and
  // deleting committed-but-unpushed work on the sibling, whose divergence the
  // assign-time guard cannot catch because that guard only runs when the worktree
  // was already on the candidate branch. On the candidate branch itself,
  // `assignWorktreeBranch` adopts and inventories inherited work on the exact
  // branch, so operator edits are never lost and ambiguous work can be parked
  // for an answer before publication.
  //
  // `allowOperatorFallback` is false for cross-repository (fork) PRs: the fleet
  // can never publish a fork branch, so reusing an operator's fork checkout would
  // only leave an orphan repair commit in it before `#submitBranch` rejects the
  // push. Those PRs must fall through to `provisionWorktree`, which rejects them
  // with an actionable cross-repository message instead of dispatching a worker.
  async findWorktree(
    fleetBranches: string[],
    candidateBranch: string,
    allowOperatorFallback: boolean,
  ): Promise<string | null> {
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
        if (currentPath !== null) {
          if (
            fleetBranches.includes(branch) &&
            this.#isFleetWorktree(currentPath)
          ) {
            return currentPath;
          }
          if (
            allowOperatorFallback &&
            branch === candidateBranch &&
            !this.#isFleetWorktree(currentPath)
          ) {
            operatorFallback ??= currentPath;
          }
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

  async #worktreeContext(
    worktree: string,
    remoteHeadSha: string,
  ): Promise<WorktreeContext> {
    const localHeadOutput = await this.#mustRun(
      "git",
      ["rev-parse", "HEAD"],
      worktree,
    );
    const localHeadSha = localHeadOutput.trim();
    let relation: WorktreeContext["relation"] = "exact";
    if (localHeadSha !== remoteHeadSha) {
      const remoteIsAncestor = await this.#run({
        executable: "git",
        args: ["merge-base", "--is-ancestor", remoteHeadSha, localHeadSha],
        cwd: worktree,
        timeoutMs: 30_000,
      });
      if (remoteIsAncestor.exitCode === 0) {
        relation = "ahead";
      } else {
        const localIsAncestor = await this.#run({
          executable: "git",
          args: ["merge-base", "--is-ancestor", localHeadSha, remoteHeadSha],
          cwd: worktree,
          timeoutMs: 30_000,
        });
        relation = localIsAncestor.exitCode === 0 ? "behind" : "diverged";
      }
    }
    const stagedOutput = await this.#mustRun(
      "git",
      ["diff", "--cached", "--name-only", "--"],
      worktree,
    );
    const stagedPaths = stagedOutput
      .split("\n")
      .filter((value) => value.length > 0);
    const unstagedOutput = await this.#mustRun(
      "git",
      ["diff", "--name-only", "--"],
      worktree,
    );
    const unstagedTracked = unstagedOutput
      .split("\n")
      .filter((value) => value.length > 0);
    const untrackedOutput = await this.#mustRun(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      worktree,
    );
    const untracked = untrackedOutput
      .split("\n")
      .filter((value) => value.length > 0);
    const unstagedPaths = [...new Set([...unstagedTracked, ...untracked])];
    return {
      ownership: this.#isFleetWorktree(worktree) ? "fleet" : "operator",
      remoteHeadSha,
      localHeadSha,
      relation,
      dirty: stagedPaths.length > 0 || unstagedPaths.length > 0,
      stagedPaths,
      unstagedPaths,
    };
  }

  async assignWorktreeBranch(
    worktree: string,
    pr: PrIdentity,
  ): Promise<WorktreeContext> {
    const n = String(pr.number);
    const branch = pr.headRefName;
    const currentBranchOutput = await this.#mustRun(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      worktree,
    );
    const onBranch = currentBranchOutput.trim() === branch;
    // A worktree on another branch may contain that branch's work, so it remains
    // ineligible for reassignment while dirty. A worktree already on THIS PR's
    // branch is adopted best-effort: inherited changes and local commits are
    // preserved for the worker to inspect, validate, and either continue or ask
    // the operator about.
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
      `+refs/pull/${n}/head:${pullRef}`,
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
      return this.#worktreeContext(worktree, fetchedHead);
    }
    // Never reset a matching-branch worktree. This preserves both operator WIP
    // and a prior fleet attempt across controller restarts; the returned context
    // makes any ahead/behind/diverged state explicit to the worker and dashboard.
    return this.#worktreeContext(worktree, fetchedHead);
  }

  async provisionWorktree(pr: PrIdentity, stackId: string): Promise<string> {
    if (pr.crossRepository) {
      throw new Error(
        `PR #${String(pr.number)} is cross-repository and needs an existing authorized worktree`,
      );
    }
    await mkdir(this.#worktreeRoot, { recursive: true });
    const worktreePath = path.join(this.#worktreeRoot, `stack-${stackId}`);
    const existing = await this.findWorktree(
      [pr.headRefName],
      pr.headRefName,
      !pr.crossRepository,
    );
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
