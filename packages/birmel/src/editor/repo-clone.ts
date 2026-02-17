import { spawn } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loggers } from "../utils/index.js";

const logger = loggers.editor.child("repo-clone");

export type CloneRepoOptions = {
  repo: string; // "owner/repo"
  branch: string;
  token: string; // GitHub token for auth
  sessionId: string; // Used to create unique temp directory
};

/**
 * Clone a repository to a temporary directory
 * Returns the path to the cloned repository
 */
export async function cloneRepo(opts: CloneRepoOptions): Promise<string> {
  const { repo, branch, token, sessionId } = opts;

  // Create temp directory path
  const tempDir = join("/tmp", `birmel-edit-${sessionId}`);

  // Ensure temp directory exists
  await mkdir(tempDir, { recursive: true });

  // Build authenticated HTTPS URL
  const repoUrl = `https://${token}@github.com/${repo}.git`;

  logger.info("Cloning repository", {
    repo,
    branch,
    tempDir,
    sessionId,
  });

  // Shallow clone for speed
  await runGitCommand(tempDir, [
    "clone",
    "--depth",
    "1",
    "--branch",
    branch,
    repoUrl,
    ".",
  ]);

  logger.info("Repository cloned successfully", {
    repo,
    tempDir,
  });

  return tempDir;
}

/**
 * Clean up a cloned repository by removing its temp directory
 */
export async function cleanupClone(path: string): Promise<void> {
  if (!path.startsWith("/tmp/birmel-edit-")) {
    logger.warn("Refusing to cleanup non-temp path", { path });
    return;
  }

  try {
    await rm(path, { recursive: true, force: true });
    logger.info("Cleaned up cloned repository", { path });
  } catch (error) {
    logger.error("Failed to cleanup cloned repository", error, { path });
  }
}

/**
 * Run a git command in a directory
 */
async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git ${args.join(" ")} failed: ${stderr}`));
      }
    });

    proc.on("error", reject);
  });
}
