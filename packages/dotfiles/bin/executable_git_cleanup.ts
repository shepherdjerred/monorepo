#!/usr/bin/env bun

import {
  branchDeletionFlag,
  type CleanupOptions,
  type DetailedWorktree,
  formatStatus,
  isSafeWorktree,
  parseBatchPullRequests,
  parseCleanupArguments,
  parseWorktreesDetailed,
  type PullRequest,
  pullRequestAgeInDays,
  readConfirmationLine,
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
  if (exitCode !== 0 && stderr.length > 0) {
    console.error(stderr.trim());
  }
  return { exitCode, stdout: stdout.trim() };
}

async function fetchRepoPullRequests(
  repo: string,
): Promise<Map<string, PullRequest>> {
  const result = await command(repo, [
    "gh",
    "pr",
    "list",
    "--state",
    "all",
    "--limit",
    "500",
    "--json",
    "headRefName,state,updatedAt,headRefOid",
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`Could not inspect PRs in ${repo}`);
  }
  return parseBatchPullRequests(result.stdout);
}

async function commitsAheadOfUpstream(worktree: string): Promise<number> {
  const upstream = await command(worktree, [
    "git",
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  if (upstream.exitCode !== 0) {
    return Number.POSITIVE_INFINITY;
  }
  const count = await command(worktree, [
    "git",
    "rev-list",
    "--count",
    "@{u}..HEAD",
  ]);
  if (count.exitCode !== 0 || !/^\d+$/u.test(count.stdout)) {
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
  if (count.exitCode !== 0 || !/^\d+$/u.test(count.stdout)) {
    throw new Error(
      `Could not count commits ahead of origin/${defaultBranch} in ${worktree}`,
    );
  }
  return Number(count.stdout);
}

async function latestCommitEpochMs(worktree: string): Promise<number> {
  const log = await command(worktree, ["git", "log", "-1", "--format=%ct"]);
  const seconds = Number(log.stdout);
  return log.exitCode === 0 && Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : 0;
}

type WorktreeInspection = {
  readonly eligible: boolean;
  readonly safe: boolean;
  readonly pullRequest: PullRequest;
};

async function inspectDetachedWorktree(
  worktree: DetailedWorktree,
  defaultBranch: string,
  options: CleanupOptions,
): Promise<WorktreeInspection> {
  if (!options.removeCleanWorktrees) {
    return {
      eligible: false,
      safe: false,
      pullRequest: { state: "NONE" },
    };
  }
  const status = await command(worktree.path, ["git", "status", "--porcelain"]);
  if (status.exitCode !== 0) {
    throw new Error(`Status failed in ${worktree.path}`);
  }
  const aheadOfDefault = await commitsAheadOfDefaultBranch(
    worktree.path,
    defaultBranch,
  );
  return {
    eligible: true,
    safe: status.stdout.length === 0 && aheadOfDefault === 0,
    pullRequest: { state: "NONE" },
  };
}

async function inspectBranchWorktree(options: {
  readonly repo: string;
  readonly worktree: DetailedWorktree & { readonly branch: string };
  readonly defaultBranch: string;
  readonly prMap: ReadonlyMap<string, PullRequest>;
  readonly cleanupOptions: CleanupOptions;
}): Promise<WorktreeInspection> {
  const { repo, worktree, defaultBranch, prMap, cleanupOptions } = options;
  const status = await command(worktree.path, ["git", "status", "--porcelain"]);
  if (status.exitCode !== 0) {
    throw new Error(`Status failed in ${worktree.path}`);
  }
  const ahead = await commitsAheadOfUpstream(worktree.path);
  const mergeBase = await command(repo, [
    "git",
    "merge-base",
    "--is-ancestor",
    worktree.branch,
    `origin/${defaultBranch}`,
  ]);
  const merged = mergeBase.exitCode === 0;
  const pullRequestResult: PullRequest = cleanupOptions.checkPullRequests
    ? (prMap.get(worktree.branch) ?? { state: "NONE" })
    : { state: "NONE" };
  const eligibleByBranchState =
    merged ||
    pullRequestResult.state === "MERGED" ||
    (cleanupOptions.includeClosedPullRequests &&
      pullRequestResult.state === "CLOSED");
  const commitsAheadOfDefault =
    eligibleByBranchState || !cleanupOptions.removeCleanWorktrees
      ? undefined
      : await commitsAheadOfDefaultBranch(worktree.path, defaultBranch);
  const effectiveUpstreamAhead =
    merged || commitsAheadOfDefault === 0 ? 0 : ahead;
  const latestCommitAtMs =
    effectiveUpstreamAhead === Number.POSITIVE_INFINITY
      ? await latestCommitEpochMs(worktree.path)
      : undefined;

  return {
    eligible: eligibleByBranchState || cleanupOptions.removeCleanWorktrees,
    safe: isSafeWorktree(
      status.stdout,
      effectiveUpstreamAhead,
      commitsAheadOfDefault,
      {
        pullRequest: pullRequestResult,
        includeClosedPullRequests: cleanupOptions.includeClosedPullRequests,
        ...(worktree.headSha === undefined
          ? {}
          : { headSha: worktree.headSha }),
        ...(latestCommitAtMs === undefined ? {} : { latestCommitAtMs }),
      },
    ),
    pullRequest: pullRequestResult,
  };
}

function reportStalePullRequest(
  branch: string | undefined,
  pullRequestResult: PullRequest,
  options: CleanupOptions,
): void {
  if (
    branch === undefined ||
    pullRequestResult.state !== "OPEN" ||
    pullRequestResult.updatedAt === undefined
  ) {
    return;
  }
  const ageInDays = pullRequestAgeInDays(pullRequestResult.updatedAt);
  if (ageInDays >= options.stalePullRequestDays) {
    console.warn(
      formatStatus(
        "STALE",
        `${branch}: pull request inactive for ${ageInDays.toString()} days`,
        options.color,
      ),
    );
  }
}

async function removeWorktree(
  repo: string,
  worktree: DetailedWorktree,
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
  if (!options.apply) {
    return;
  }
  if (worktree.locked) {
    await command(repo, ["git", "worktree", "unlock", worktree.path]);
  }
  const remove = await command(repo, [
    "git",
    "worktree",
    "remove",
    worktree.path,
  ]);
  if (remove.exitCode !== 0) {
    throw new Error(`git worktree remove failed for ${worktree.path}`);
  }
  if (worktree.branch === undefined) {
    return;
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

async function inspectRepositoryWorktrees(
  repo: string,
  options: CleanupOptions,
): Promise<{
  readonly defaultBranch: string;
  readonly nonMain: readonly DetailedWorktree[];
  readonly prMap: ReadonlyMap<string, PullRequest>;
}> {
  const remoteHead = await command(repo, [
    "git",
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "--short",
  ]);
  if (remoteHead.exitCode !== 0) {
    throw new Error(`No origin HEAD in ${repo}`);
  }
  const defaultBranch = remoteHead.stdout.replace(/^origin\//u, "");
  if (options.apply) {
    const fetch = await command(repo, ["git", "fetch", "--prune", "origin"]);
    if (fetch.exitCode !== 0) {
      throw new Error(`Fetch failed in ${repo}`);
    }
  }
  const worktreeResult = await command(repo, [
    "git",
    "worktree",
    "list",
    "--porcelain",
  ]);
  if (worktreeResult.exitCode !== 0) {
    throw new Error(`Worktree list failed in ${repo}`);
  }
  const worktrees = parseWorktreesDetailed(worktreeResult.stdout);
  const nonMain = worktrees.slice(1);
  const hasNamedBranches = nonMain.some((wt) => wt.branch !== undefined);
  const prMap =
    hasNamedBranches && options.checkPullRequests
      ? await fetchRepoPullRequests(repo)
      : new Map<string, PullRequest>();
  return { defaultBranch, nonMain, prMap };
}

async function cleanupRepository(
  repo: string,
  options: CleanupOptions,
): Promise<number> {
  const { defaultBranch, nonMain, prMap } = await inspectRepositoryWorktrees(
    repo,
    options,
  );
  let actions = 0;

  for (const worktree of nonMain) {
    const inspection =
      worktree.branch === undefined
        ? await inspectDetachedWorktree(worktree, defaultBranch, options)
        : await inspectBranchWorktree({
            repo,
            worktree: { ...worktree, branch: worktree.branch },
            defaultBranch,
            prMap,
            cleanupOptions: options,
          });
    reportStalePullRequest(worktree.branch, inspection.pullRequest, options);
    if (!inspection.eligible) {
      if (options.verbose) {
        console.log(
          formatStatus("KEEP", `${worktree.path}: not eligible`, options.color),
        );
      }
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
    await removeWorktree(repo, worktree, inspection.pullRequest, options);
  }

  if (options.apply) {
    const prune = await command(repo, ["git", "worktree", "prune"]);
    if (prune.exitCode !== 0) {
      throw new Error(`Worktree prune failed in ${repo}`);
    }
  }
  return actions;
}

const usage = `git_cleanup [directory] [--apply] [--yes] [--no-prs]
  [--include-closed-prs] [--remove-clean-worktrees]
  [--stale-pr-days DAYS] [--summary] [--verbose] [--no-color]`;

async function confirmInteractiveApply(options: CleanupOptions): Promise<void> {
  if (!options.apply || options.yes) {
    return;
  }
  if (!process.stdin.isTTY) {
    throw new Error("Non-interactive apply requires --yes");
  }
  process.stdout.write("Type APPLY exactly to continue: ");
  const confirmation = await readConfirmationLine(Bun.stdin.stream());
  if (confirmation !== "APPLY") {
    throw new Error("Apply cancelled");
  }
}

async function runCli(): Promise<void> {
  const home = Bun.env["HOME"];
  if (home === undefined) {
    throw new Error("HOME is required");
  }
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
  await confirmInteractiveApply(options);

  const repositories = [
    ...new Bun.Glob("*/.git").scanSync({
      cwd: options.directory,
      onlyFiles: false,
    }),
  ]
    .map((entry) => `${options.directory}/${entry.replace(/\/\.git$/u, "")}`)
    .sort((a, b) => a.localeCompare(b));

  let totalActions = 0;
  const errors: string[] = [];
  for (const repo of repositories) {
    try {
      const actions = await cleanupRepository(repo, options);
      totalActions += actions;
      if (options.verbose || actions > 0) {
        console.log(`${repo}: ${actions.toString()} action(s)`);
      }
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
    for (const error of errors) {
      console.error(error);
    }
    throw new Error(
      `Cleanup failed in ${errors.length.toString()} repository/repositories`,
    );
  }
}

if (import.meta.main) {
  await runCli();
}
