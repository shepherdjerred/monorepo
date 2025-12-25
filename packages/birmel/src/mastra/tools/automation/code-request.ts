import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getConfig } from "../../../config/index.js";
import { loggers, checkRateLimit, getRateLimitResetTime } from "../../../utils/index.js";

const logger = loggers.automation;

// Rate limit window: 1 hour in milliseconds
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Executes a shell command and returns stdout, stderr, and exit code.
 */
async function execCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number; env?: Record<string, string> } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  const { cwd, timeout = 30000, env } = options;
  let timedOut = false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);

  try {
    const proc = Bun.spawn({
      cmd: [command, ...args],
      ...(cwd ? { cwd } : {}),
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const result = await Promise.race([
      proc.exited,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          proc.kill();
          reject(new Error("Command timed out"));
        });
      }),
    ]);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    return { stdout, stderr, exitCode: result, timedOut: false };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- timedOut is set by async timeout callback
    if (timedOut) {
      return { stdout: "", stderr: "Command timed out", exitCode: -1, timedOut: true };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generates a unique branch name based on timestamp and a short hash.
 */
function generateBranchName(prefix: string): string {
  const timestamp = String(Date.now());
  const shortHash = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${shortHash}`;
}

export const codeRequestTool = createTool({
  id: "request-code-change",
  description: `Request a code change to birmel by running Claude Code CLI.

This tool allows users to request code changes to the birmel codebase. It will:
1. Create a new git branch
2. Run Claude Code in one-shot mode with the request
3. Commit any changes made
4. Push the branch and create a pull request
5. Return the PR URL

**Rate Limited**: Limited to a few requests per hour per user.
**Long Running**: This operation can take several minutes.

Examples:
- "Add a new command to check the weather"
- "Fix the bug where the bot doesn't respond to mentions in DMs"
- "Refactor the music player to support playlists"`,
  inputSchema: z.object({
    request: z.string().min(10).describe("Description of the code change to make. Be specific and detailed."),
    userId: z.string().describe("Discord user ID making the request (for rate limiting)"),
    username: z.string().describe("Discord username making the request (for commit attribution)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      prUrl: z.string().optional().describe("URL of the created pull request"),
      branchName: z.string().optional().describe("Name of the created branch"),
      commitHash: z.string().optional().describe("Hash of the commit"),
      claudeOutput: z.string().optional().describe("Output from Claude Code"),
      duration: z.number().optional().describe("Total duration in milliseconds"),
    }).optional(),
  }),
  execute: async (ctx) => {
    const config = getConfig();
    const startTime = Date.now();

    // Check if feature is enabled
    if (!config.claudeCode.enabled) {
      return {
        success: false,
        message: "Code request feature is disabled. Set CLAUDE_CODE_ENABLED=true to enable.",
      };
    }

    // Rate limit check
    const rateLimitKey = `code-request:${ctx.userId}`;
    const isAllowed = checkRateLimit(
      rateLimitKey,
      config.claudeCode.maxRequestsPerHour,
      RATE_LIMIT_WINDOW_MS,
    );

    if (!isAllowed) {
      const resetTime = getRateLimitResetTime(rateLimitKey);
      const resetIn = resetTime ? Math.ceil((resetTime - Date.now()) / 60000) : 60;
      return {
        success: false,
        message: `Rate limit exceeded. You can make ${String(config.claudeCode.maxRequestsPerHour)} code requests per hour. Try again in ${String(resetIn)} minutes.`,
      };
    }

    const repoPath = config.claudeCode.repoPath;
    const subPath = config.claudeCode.subPath;
    const branchName = generateBranchName(config.claudeCode.branchPrefix);

    logger.info("Starting code request", {
      userId: ctx.userId,
      username: ctx.username,
      request: ctx.request.substring(0, 100),
      branchName,
      repoPath,
      subPath,
    });

    try {
      // Step 1: Ensure we're on main/master and pull latest
      logger.info("Fetching latest from origin...");
      const fetchResult = await execCommand("git", ["fetch", "origin"], { cwd: repoPath, timeout: 60000 });
      if (fetchResult.exitCode !== 0) {
        logger.warn("Git fetch warning", { stderr: fetchResult.stderr });
      }

      // Get the default branch name
      const defaultBranchResult = await execCommand(
        "git",
        ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
        { cwd: repoPath, timeout: 10000 },
      );
      const defaultBranch = defaultBranchResult.stdout.trim().replace("origin/", "") || "main";

      // Checkout and pull the default branch
      await execCommand("git", ["checkout", defaultBranch], { cwd: repoPath, timeout: 30000 });
      await execCommand("git", ["pull", "origin", defaultBranch], { cwd: repoPath, timeout: 60000 });

      // Step 2: Create a new branch
      logger.info("Creating new branch", { branchName });
      const branchResult = await execCommand("git", ["checkout", "-b", branchName], { cwd: repoPath, timeout: 10000 });
      if (branchResult.exitCode !== 0) {
        throw new Error(`Failed to create branch: ${branchResult.stderr}`);
      }

      // Step 3: Run Claude Code CLI in one-shot mode
      logger.info("Running Claude Code...");
      const claudePrompt = `You are making changes to the birmel Discord bot codebase.

This is a monorepo. The birmel package is located at: ${subPath}
Focus your changes on the birmel package unless the request specifically requires changes elsewhere.

Request from Discord user ${ctx.username}:
${ctx.request}

Important guidelines:
- Make minimal, focused changes to address the request
- Follow existing code patterns and conventions in the codebase
- Add appropriate error handling
- Do not modify unrelated code
- If you need to add new dependencies, mention them in your response`;

      const claudeResult = await execCommand(
        "claude",
        [
          "--print",
          "--dangerously-skip-permissions",
          claudePrompt,
        ],
        {
          cwd: repoPath,
          timeout: config.claudeCode.defaultTimeout,
          env: {
            // Ensure Claude has necessary environment
            HOME: process.env["HOME"] ?? "/root",
            PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
          },
        },
      );

      if (claudeResult.timedOut) {
        // Clean up: go back to default branch
        await execCommand("git", ["checkout", defaultBranch], { cwd: repoPath, timeout: 10000 });
        await execCommand("git", ["branch", "-D", branchName], { cwd: repoPath, timeout: 10000 });

        return {
          success: false,
          message: `Claude Code timed out after ${String(config.claudeCode.defaultTimeout / 1000)} seconds. The request may be too complex.`,
          data: {
            branchName,
            duration: Date.now() - startTime,
          },
        };
      }

      const claudeOutput = claudeResult.stdout + (claudeResult.stderr ? `\n\nStderr: ${claudeResult.stderr}` : "");
      logger.info("Claude Code completed", { exitCode: claudeResult.exitCode });

      // Step 4: Check if there are any changes
      const statusResult = await execCommand("git", ["status", "--porcelain"], { cwd: repoPath, timeout: 10000 });
      const hasChanges = statusResult.stdout.trim().length > 0;

      if (!hasChanges) {
        // No changes made, clean up
        await execCommand("git", ["checkout", defaultBranch], { cwd: repoPath, timeout: 10000 });
        await execCommand("git", ["branch", "-D", branchName], { cwd: repoPath, timeout: 10000 });

        return {
          success: false,
          message: "Claude Code did not make any changes to the codebase. The request may already be implemented or may not be actionable.",
          data: {
            claudeOutput: claudeOutput.substring(0, 1500),
            duration: Date.now() - startTime,
          },
        };
      }

      // Step 5: Commit the changes
      logger.info("Committing changes...");
      await execCommand("git", ["add", "-A"], { cwd: repoPath, timeout: 10000 });

      const commitMessage = `feat: ${ctx.request.substring(0, 50)}${ctx.request.length > 50 ? "..." : ""}

Requested by: ${ctx.username} (Discord)

${ctx.request}

Generated by Claude Code via Discord request.`;

      const commitResult = await execCommand(
        "git",
        ["commit", "-m", commitMessage],
        { cwd: repoPath, timeout: 30000 },
      );

      if (commitResult.exitCode !== 0) {
        throw new Error(`Failed to commit: ${commitResult.stderr}`);
      }

      // Get the commit hash
      const hashResult = await execCommand("git", ["rev-parse", "HEAD"], { cwd: repoPath, timeout: 10000 });
      const commitHash = hashResult.stdout.trim().substring(0, 8);

      // Step 6: Push the branch
      logger.info("Pushing branch...");
      const pushResult = await execCommand(
        "git",
        ["push", "-u", "origin", branchName],
        { cwd: repoPath, timeout: 60000 },
      );

      if (pushResult.exitCode !== 0) {
        throw new Error(`Failed to push: ${pushResult.stderr}`);
      }

      // Step 7: Create a pull request using gh CLI
      logger.info("Creating pull request...");
      const prBody = `## Discord Code Request

**Requested by:** ${ctx.username}

### Request
${ctx.request}

### Changes
This PR was automatically generated by Claude Code based on a Discord request.

### Claude Output
\`\`\`
${claudeOutput.substring(0, 2000)}${claudeOutput.length > 2000 ? "\n...(truncated)" : ""}
\`\`\`

---
*Generated automatically via birmel Discord bot*`;

      const prTitle = `feat: ${ctx.request.substring(0, 70)}${ctx.request.length > 70 ? "..." : ""}`;

      const prResult = await execCommand(
        "gh",
        [
          "pr",
          "create",
          "--title", prTitle,
          "--body", prBody,
          "--base", defaultBranch,
          "--head", branchName,
        ],
        { cwd: repoPath, timeout: 60000 },
      );

      if (prResult.exitCode !== 0) {
        // PR creation failed, but we still have the branch and commit
        logger.error("Failed to create PR", { stderr: prResult.stderr });
        return {
          success: true,
          message: `Changes committed and pushed to branch \`${branchName}\`, but PR creation failed: ${prResult.stderr}. You can create the PR manually.`,
          data: {
            branchName,
            commitHash,
            claudeOutput: claudeOutput.substring(0, 1500),
            duration: Date.now() - startTime,
          },
        };
      }

      // Extract PR URL from output
      const prUrl = prResult.stdout.trim();

      // Go back to default branch
      await execCommand("git", ["checkout", defaultBranch], { cwd: repoPath, timeout: 10000 });

      const duration = Date.now() - startTime;
      logger.info("Code request completed successfully", {
        prUrl,
        branchName,
        commitHash,
        duration,
      });

      return {
        success: true,
        message: `Pull request created successfully! Review and merge the changes here: ${prUrl}`,
        data: {
          prUrl,
          branchName,
          commitHash,
          claudeOutput: claudeOutput.substring(0, 1500),
          duration,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Code request failed", {
        error: String(error),
        branchName,
        duration,
      });

      // Attempt cleanup
      try {
        const defaultBranchResult = await execCommand(
          "git",
          ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
          { cwd: repoPath, timeout: 10000 },
        );
        const defaultBranch = defaultBranchResult.stdout.trim().replace("origin/", "") || "main";
        await execCommand("git", ["checkout", defaultBranch], { cwd: repoPath, timeout: 10000 });
        await execCommand("git", ["branch", "-D", branchName], { cwd: repoPath, timeout: 10000 });
      } catch {
        // Ignore cleanup errors
      }

      return {
        success: false,
        message: `Code request failed: ${String(error)}`,
        data: {
          branchName,
          duration,
        },
      };
    }
  },
});
