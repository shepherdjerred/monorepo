import { simpleGit } from "simple-git";
import {
  createGeneratedPr,
  ensureGeneratedPrAutoMerge,
  findOpenGeneratedPrUrl,
  type OpenPrListItem,
} from "#activities/data-dragon/data-dragon-pr.ts";
import {
  parseGitStatusLine,
  type GitStatusEntry,
} from "#activities/data-dragon/data-dragon-diff.ts";
import { runCommand } from "#activities/data-dragon/data-dragon-shell.ts";
import { disarmGitHooks } from "#activities/bot-clone.ts";
import {
  fetchGeneratedRemoteBranch,
  pushOwnedGeneratedCommit,
  writeGitAskpass,
} from "./scout-season-refresh-git.ts";

/**
 * The shared mechanics of a generated-file refresh that opens a PR: a scratch
 * clone with a credentialed git environment, a check that only the expected
 * files changed, and a content-addressed branch that is committed, pushed and
 * opened as a PR with auto-merge. Lane priors, the champion-meta snapshot and
 * the Data Dragon refresh all run through it.
 */

export const GENERATED_REPO_URL =
  "https://github.com/shepherdjerred/monorepo.git";
export const GENERATED_REPO_SLUG = "shepherdjerred/monorepo";
export const GENERATED_MAIN_BRANCH = "main";

export type GeneratedGitEnv = {
  GH_TOKEN: string;
  GIT_ASKPASS: string;
  GIT_TERMINAL_PROMPT: "0";
};

/** Shallow-clone main into `repoDir`; returns the env git needs to push. */
export async function cloneMainForGeneratedRefresh(input: {
  tempDir: string;
  repoDir: string;
  githubToken: string;
}): Promise<GeneratedGitEnv> {
  await runCommand(["mkdir", "-p", input.tempDir], { cwd: "/tmp" });
  const askpass = await writeGitAskpass(input.tempDir);
  await simpleGit().clone(GENERATED_REPO_URL, input.repoDir, [
    "--branch",
    GENERATED_MAIN_BRANCH,
    "--single-branch",
    "--depth",
    "1",
  ]);
  return {
    GH_TOKEN: input.githubToken,
    GIT_ASKPASS: askpass,
    GIT_TERMINAL_PROMPT: "0",
  };
}

/**
 * The paths git reports as changed; throws when any is outside `allowed` or
 * below one of `allowedDirectories`. With directories git lists every untracked
 * file (`-uall`), not a collapsed `dir/` entry, so each file is checked.
 */
export async function changedAllowedFiles(
  repoDir: string,
  allowed: readonly string[],
  label: string,
  allowedDirectories: readonly string[] = [],
): Promise<string[]> {
  const status = await runCommand(
    [
      "git",
      "status",
      "--porcelain",
      ...(allowedDirectories.length > 0 ? ["--untracked-files=all"] : []),
    ],
    { cwd: repoDir, trimStdout: false },
  );
  const changes = status
    .split("\n")
    .map((line) => parseGitStatusLine(line))
    .filter((entry) => entry !== undefined);
  const disallowed = generatedDisallowedPaths(
    changes,
    allowed,
    allowedDirectories,
  );
  if (disallowed.length > 0) {
    throw new Error(
      `${label} changed disallowed paths: ${disallowed.slice(0, 20).join(", ")}${disallowed.length > 20 ? `, and ${(disallowed.length - 20).toString()} more` : ""}`,
    );
  }
  return changes.map((change) => change.path).toSorted();
}

/** Whether `path` is a file below `directory` (a path relative to the repository root). */
export function isInGeneratedDirectory(
  path: string,
  directory: string,
): boolean {
  return path.startsWith(`${directory.replace(/\/+$/u, "")}/`);
}

/**
 * Paths (including rename sources) in `changes` that are neither in `allowed`
 * nor below an allowed directory. A directory allows its files and nothing
 * beside it: `a/b` does not allow `a/bc/x`.
 */
export function generatedDisallowedPaths(
  changes: readonly GitStatusEntry[],
  allowed: readonly string[],
  allowedDirectories: readonly string[] = [],
): string[] {
  const permitted = new Set(allowed);
  const disallowed = new Set<string>();
  for (const change of changes) {
    for (const path of [change.path, change.previousPath]) {
      if (
        path !== undefined &&
        !permitted.has(path) &&
        !allowedDirectories.some((directory) =>
          isInGeneratedDirectory(path, directory),
        )
      ) {
        disallowed.add(path);
      }
    }
  }
  return [...disallowed].toSorted();
}

function isGeneratedPr(
  pr: OpenPrListItem,
  appSlug: string,
  match: { title: string; branch: string },
): boolean {
  return (
    pr.title === match.title &&
    pr.baseRefName === GENERATED_MAIN_BRANCH &&
    pr.headRefName === match.branch &&
    !pr.isCrossRepository &&
    pr.author.is_bot &&
    pr.author.login.replace(/^app\//, "").replace(/\[bot\]$/, "") === appSlug
  );
}

async function findOpenPrUrl(
  match: { title: string; branch: string },
  token: string,
): Promise<string | undefined> {
  return await findOpenGeneratedPrUrl({
    repoSlug: GENERATED_REPO_SLUG,
    filterArgs: ["--head", match.branch],
    token,
    matches: (pr, appSlug) => isGeneratedPr(pr, appSlug, match),
  });
}

export type GeneratedPublication = {
  changedFiles: string[];
  branchName: string;
  commitHash: string | undefined;
  prUrl: string;
  outcome: "success" | "skipped";
  reason: "pr-created" | "pr-already-open";
  autoMergeConfigured: boolean;
};

/**
 * Publish `files` on `branch` as a PR titled `title`, unless an open PR from
 * this bot already carries that branch. Auto-merge is enabled either way;
 * `onAutoMergeFailure` logs when it cannot be.
 */
export async function publishGeneratedRefresh(input: {
  repoDir: string;
  githubToken: string;
  gitEnv: GeneratedGitEnv;
  branch: string;
  title: string;
  body: string;
  files: readonly string[];
  changedFiles: string[];
  onAutoMergeFailure: (prUrl: string) => (error: unknown) => void;
}): Promise<GeneratedPublication> {
  const { repoDir, githubToken, gitEnv, branch, title } = input;
  const match = { title, branch };
  const base = { changedFiles: input.changedFiles, branchName: branch };

  const existingPrUrl = await findOpenPrUrl(match, githubToken);
  if (existingPrUrl !== undefined) {
    return {
      ...base,
      commitHash: undefined,
      prUrl: existingPrUrl,
      outcome: "skipped",
      reason: "pr-already-open",
      autoMergeConfigured: await ensureGeneratedPrAutoMerge({
        repoSlug: GENERATED_REPO_SLUG,
        prUrl: existingPrUrl,
        token: githubToken,
        onFailure: input.onAutoMergeFailure(existingPrUrl),
      }),
    };
  }

  await runCommand(["git", "config", "user.email", "ci@sjer.red"], {
    cwd: repoDir,
  });
  await runCommand(["git", "config", "user.name", "CI Bot"], { cwd: repoDir });
  const expectedRemoteSha = await fetchGeneratedRemoteBranch({
    repoDir,
    branch,
    gitEnv,
  });
  await runCommand(["git", "checkout", "-B", branch], { cwd: repoDir });
  await runCommand(["git", "add", "--", ...input.files], { cwd: repoDir });
  await disarmGitHooks(repoDir);
  await runCommand(["git", "commit", "-m", title], { cwd: repoDir });
  const commitHash = await pushOwnedGeneratedCommit({
    repoDir,
    branch,
    gitEnv,
    expectedRemoteSha,
  });
  const { url: prUrl, recovered } = await createGeneratedPr(
    {
      repoSlug: GENERATED_REPO_SLUG,
      repoDir,
      branch,
      base: GENERATED_MAIN_BRANCH,
      title,
      body: input.body,
      token: githubToken,
    },
    { findOnHead: async () => await findOpenPrUrl(match, githubToken) },
  );
  return {
    ...base,
    commitHash,
    prUrl,
    outcome: recovered ? "skipped" : "success",
    reason: recovered ? "pr-already-open" : "pr-created",
    autoMergeConfigured: await ensureGeneratedPrAutoMerge({
      repoSlug: GENERATED_REPO_SLUG,
      prUrl,
      token: githubToken,
      onFailure: input.onAutoMergeFailure(prUrl),
    }),
  };
}
