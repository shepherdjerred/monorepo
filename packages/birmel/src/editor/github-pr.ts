import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getAuth } from "./github-oauth.ts";
import type { FileChange } from "./types.ts";

const logger = loggers.editor.child("github-pr");

export type CreatePROptions = {
  userId: string;
  repoPath: string; // Path to the cloned repo directory
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
  changes: FileChange[];
};

export type PRResult = {
  success: boolean;
  prUrl?: string;
  error?: string;
};

/**
 * Create a PR with the given changes
 * Uses gh CLI for authentication and PR creation
 */
export async function createPullRequest(
  opts: CreatePROptions,
): Promise<PRResult> {
  const { userId, repoPath, branchName, baseBranch, title, body, changes } =
    opts;

  const auth = await getAuth(userId);
  if (auth == null) {
    return { success: false, error: "GitHub authentication required" };
  }

  try {
    // Create branch
    await runGitCommand(repoPath, ["checkout", "-b", branchName]);

    // Apply changes
    for (const change of changes) {
      await applyChange(repoPath, change);
    }

    // Stage all changes
    await runGitCommand(repoPath, ["add", "-A"]);

    // Commit
    await runGitCommand(repoPath, [
      "commit",
      "-m",
      title,
      "-m",
      "Created via Discord bot",
    ]);

    // Push with token auth
    const remoteUrl = await getRemoteUrl(repoPath);
    const authedUrl = injectToken(remoteUrl, auth.accessToken);
    await runGitCommand(repoPath, ["push", authedUrl, branchName]);

    // Create PR using gh CLI
    const prUrl = await createPRWithGh({
      workingDir: repoPath,
      title,
      body,
      baseBranch,
      headBranch: branchName,
      token: auth.accessToken,
    });

    // Checkout back to base branch
    await runGitCommand(repoPath, ["checkout", baseBranch]);

    return { success: true, prUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create PR", error);

    // Try to clean up
    try {
      await runGitCommand(repoPath, ["checkout", baseBranch]);
      await runGitCommand(repoPath, ["branch", "-D", branchName]);
    } catch {
      // Ignore cleanup errors
    }

    return { success: false, error: message };
  }
}

async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode === 0) {
    return stdout.trim();
  }
  throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
}

async function getRemoteUrl(cwd: string): Promise<string> {
  return runGitCommand(cwd, ["remote", "get-url", "origin"]);
}

function injectToken(url: string, token: string): string {
  // Convert https://github.com/user/repo.git to https://token@github.com/user/repo.git
  if (url.startsWith("https://")) {
    return url.replace("https://", `https://${token}@`);
  }
  // For SSH URLs, we'd need a different approach
  return url;
}

async function applyChange(cwd: string, change: FileChange): Promise<void> {
  const fullPath = path.join(cwd, change.filePath);

  switch (change.changeType) {
    case "create":
    case "modify":
      if (change.newContent !== null) {
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, change.newContent, "utf8");
      }
      break;

    case "delete":
      await unlink(fullPath).catch(() => {
        // Ignore if file doesn't exist
      });
      break;
  }
}

type CreatePRWithGhOptions = {
  workingDir: string;
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  token: string;
};

async function createPRWithGh(opts: CreatePRWithGhOptions): Promise<string> {
  const { workingDir, title, body, baseBranch, headBranch, token } = opts;

  const proc = Bun.spawn(
    [
      "gh",
      "pr",
      "create",
      "--title",
      title,
      "--body",
      body,
      "--base",
      baseBranch,
      "--head",
      headBranch,
    ],
    {
      cwd: workingDir,
      env: { ...Bun.env, GH_TOKEN: token },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode === 0) {
    return stdout.trim();
  }
  throw new Error(`gh pr create failed: ${stderr}`);
}

/**
 * Generate a branch name for the changes
 */
export function generateBranchName(summary: string): string {
  const timestamp = Date.now();
  const slug = summary
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .slice(0, 30)
    .replaceAll(/^-|-$/g, "");

  return `discord-edit/${slug || "changes"}-${String(timestamp)}`;
}

/**
 * Generate PR title from summary
 */
export function generatePRTitle(summary: string): string {
  const cleaned = summary.replaceAll("\n", " ").trim();
  if (cleaned.length <= 72) {
    return cleaned;
  }
  return cleaned.slice(0, 69) + "...";
}

/**
 * Generate PR body from session context
 */
export function generatePRBody(
  summary: string,
  changes: FileChange[],
  username: string,
): string {
  const fileList = changes
    .map((c) => {
      let icon: string;
      if (c.changeType === "create") {
        icon = "+";
      } else if (c.changeType === "delete") {
        icon = "-";
      } else {
        icon = "~";
      }
      return `- ${icon} \`${c.filePath}\``;
    })
    .join("\n");

  return `## Summary

${summary}

## Changed Files

${fileList}

---
*Created via Discord by ${username}*
`;
}
