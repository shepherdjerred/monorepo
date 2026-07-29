#!/usr/bin/env bun

import {
  branchDeletionFlag,
  type CleanupOptions,
  formatStatus,
  isSafeWorktree,
  parseCleanupArguments,
  parsePullRequest,
  parseWorktrees,
  readConfirmationLine,
  type PullRequest,
  pullRequestAgeInDays,
  type Worktree,
} from "./git_cleanup_core.ts";

type CommandResult = { readonly exitCode: number; readonly stdout: string };
async function command(
  cwd: string,
  commandArguments: readonly string[],
): Promise<CommandResult> {
  const child = Bun.spawn([...commandArguments], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0 && stderr.length > 0) console.error(stderr.trim());
  return { exitCode, stdout: stdout.trim() };
}

async function pullRequest(repo: string, branch: string): Promise<PullRequest> {
  const result = await command(repo, [
    "gh",
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "all",
    "--json",
    "state,updatedAt",
    "--limit",
    "1",
  ]);
  if (result.exitCode !== 0)
    throw new Error(`Could not inspect PR for ${branch}`);
  return parsePullRequest(result.stdout);
}

async function commitsAheadOfUpstream(worktree: string): Promise<number> {
  const upstream = await command(worktree, [
    "git",
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  if (upstream.exitCode !== 0) return Number.POSITIVE_INFINITY;
  const count = await command(worktree, [
    "git",
    "rev-list",
    "--count",
    "@{u}..HEAD",
  ]);
  if (count.exitCode !== 0 || !/^\d+$/.test(count.stdout)) {
    throw new Error(`Could not count unpushed commits in ${worktree}`);
  }
  return Number(count.stdout);
}

async function commitsAheadOfDefaultBranch(
  worktree: string,
  defaultBranch: string,
): Promise<number> {
  const count = await command(worktree, [
    "git",
    "rev-list",
    "--count",
    `origin/${defaultBranch}..HEAD`,
  ]);
  if (count.exitCode !== 0 || !/^\d+$/.test(count.stdout)) {
    throw new Error(
      `Could not count commits ahead of origin/${defaultBranch} in ${worktree}`,
    );
  }
  return Number(count.stdout);
}

type WorktreeInspection = {
  readonly eligible: boolean;
  readonly safe: boolean;
  readonly pullRequest: PullRequest;
};

async function inspectWorktree(
  repo: string,
  worktree: Worktree & { readonly branch: string },
  defaultBranch: string,
  options: CleanupOptions,
): Promise<WorktreeInspection> {
  const status = await command(worktree.path, ["git", "status", "--porcelain"]);
  if (status.exitCode !== 0)
    throw new Error(`Status failed in ${worktree.path}`);
  const ahead = await commitsAheadOfUpstream(worktree.path);
  const mergeBase = await command(repo, [
    "git",
    "merge-base",
    "--is-ancestor",
    worktree.branch,
    `origin/${defaultBranch}`,
  ]);
  const merged = mergeBase.exitCode === 0;
  const pullRequestResult = options.checkPullRequests
    ? await pullRequest(repo, worktree.branch)
    : { state: "NONE" as const };
  const eligibleByBranchState =
    merged ||
    pullRequestResult.state === "MERGED" ||
    (options.includeClosedPullRequests && pullRequestResult.state === "CLOSED");
  const commitsAheadOfDefault =
    !eligibleByBranchState && options.removeCleanWorktrees
      ? await commitsAheadOfDefaultBranch(worktree.path, defaultBranch)
      : undefined;
  return {
    eligible: eligibleByBranchState || options.removeCleanWorktrees,
    safe: isSafeWorktree(status.stdout, ahead, commitsAheadOfDefault),
    pullRequest: pullRequestResult,
  };
}

function reportStalePullRequest(
  worktree: Worktree & { readonly branch: string },
  pullRequestResult: PullRequest,
  options: CleanupOptions,
): void {
  if (
    pullRequestResult.state !== "OPEN" ||
    pullRequestResult.updatedAt === undefined
  )
    return;
  const ageInDays = pullRequestAgeInDays(pullRequestResult.updatedAt);
  if (ageInDays >= options.stalePullRequestDays) {
    console.warn(
      formatStatus(
        "STALE",
        `${worktree.branch}: pull request inactive for ${ageInDays.toString()} days`,
        options.color,
      ),
    );
  }
}

async function removeWorktree(
  repo: string,
  worktree: Worktree & { readonly branch: string },
  pullRequestResult: PullRequest,
  options: CleanupOptions,
): Promise<void> {
  console.log(
    formatStatus(
      options.apply ? "REMOVE" : "WOULD REMOVE",
      worktree.path,
      options.color,
    ),
  );
  if (!options.apply) return;
  const remove = await command(repo, [
    "git",
    "worktree",
    "remove",
    worktree.path,
  ]);
  if (remove.exitCode !== 0) {
    throw new Error(`git worktree remove failed for ${worktree.path}`);
  }
  const removeBranch = await command(repo, [
    "git",
    "branch",
    branchDeletionFlag(pullRequestResult, options.includeClosedPullRequests),
    worktree.branch,
  ]);
  if (removeBranch.exitCode !== 0) {
    throw new Error(`Branch deletion failed for ${worktree.branch}`);
  }
}

async function cleanupRepository(
  repo: string,
  options: CleanupOptions,
): Promise<number> {
  const remoteHead = await command(repo, [
    "git",
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "--short",
  ]);
  if (remoteHead.exitCode !== 0) throw new Error(`No origin HEAD in ${repo}`);
  const defaultBranch = remoteHead.stdout.replace(/^origin\//, "");
  if (options.apply) {
    const fetch = await command(repo, ["git", "fetch", "--prune", "origin"]);
    if (fetch.exitCode !== 0) throw new Error(`Fetch failed in ${repo}`);
  }
  const worktreeResult = await command(repo, [
    "git",
    "worktree",
    "list",
    "--porcelain",
  ]);
  if (worktreeResult.exitCode !== 0)
    throw new Error(`Worktree list failed in ${repo}`);
  const worktrees = parseWorktrees(worktreeResult.stdout);
  const mainPath = worktrees[0]?.path;
  let actions = 0;
  for (const worktree of worktrees) {
    if (worktree.path === mainPath || worktree.branch === undefined) continue;
    const inspection = await inspectWorktree(
      repo,
      { path: worktree.path, branch: worktree.branch },
      defaultBranch,
      options,
    );
    reportStalePullRequest(
      { path: worktree.path, branch: worktree.branch },
      inspection.pullRequest,
      options,
    );
    if (!inspection.eligible) {
      if (options.verbose)
        console.log(
          formatStatus("KEEP", `${worktree.path}: not eligible`, options.color),
        );
      continue;
    }
    if (!inspection.safe) {
      console.warn(
        formatStatus(
          "KEEP",
          `${worktree.path}: dirty or has commits not present upstream`,
          options.color,
        ),
      );
      continue;
    }
    actions += 1;
    await removeWorktree(
      repo,
      { path: worktree.path, branch: worktree.branch },
      inspection.pullRequest,
      options,
    );
  }
  if (options.apply) {
    const prune = await command(repo, ["git", "worktree", "prune"]);
    if (prune.exitCode !== 0)
      throw new Error(`Worktree prune failed in ${repo}`);
  }
  return actions;
}

const usage = `git_cleanup [directory] [--apply] [--yes] [--no-prs]
  [--include-closed-prs] [--remove-clean-worktrees]
  [--stale-pr-days DAYS] [--summary] [--verbose] [--no-color]`;

if (import.meta.main) {
  const home = Bun.env["HOME"];
  if (home === undefined) throw new Error("HOME is required");
  let options: CleanupOptions;
  try {
    options = parseCleanupArguments(Bun.argv.slice(2), home);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(usage);
      process.exit(0);
    }
    throw error;
  }
  if (options.apply && !options.yes) {
    if (!process.stdin.isTTY)
      throw new Error("Non-interactive apply requires --yes");
    process.stdout.write("Type APPLY exactly to continue: ");
    const confirmation = await readConfirmationLine(Bun.stdin.stream());
    if (confirmation !== "APPLY") throw new Error("Apply cancelled");
  }
  const repositories = [
    ...new Bun.Glob("*/.git").scanSync({
      cwd: options.directory,
      onlyFiles: false,
    }),
  ]
    .map((path) => `${options.directory}/${path.replace(/\/\.git$/, "")}`)
    .sort();
  let totalActions = 0;
  const errors: string[] = [];
  for (const repo of repositories) {
    try {
      const actions = await cleanupRepository(repo, options);
      totalActions += actions;
      if (options.verbose || actions > 0)
        console.log(`${repo}: ${actions.toString()} action(s)`);
    } catch (error) {
      errors.push(
        `${repo}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (options.summary || options.verbose) {
    console.log(
      `${options.apply ? "Applied" : "Planned"} ${totalActions.toString()} action(s) across ${repositories.length.toString()} repositories`,
    );
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    throw new Error(
      `Cleanup failed in ${errors.length.toString()} repository/repositories`,
    );
  }
}
