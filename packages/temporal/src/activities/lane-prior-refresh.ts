import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  assertRemoteBranchIsOurs,
  writeGitAskpass,
} from "./scout/scout-season-refresh-git.ts";
import {
  LANE_PRIOR_ARTIFACT_PATH,
  LANE_PRIOR_EVAL_REPORT_PATH,
  LanePriorUpdateConfigSchema,
  lanePriorBranchName,
  lanePriorContentHash,
  lanePriorPrBodyLines,
  lanePriorPrTitle,
  revertGeneratedAtOnlyLanePriorChanges,
  updateLanePriors,
} from "./data-dragon/data-dragon-lane-priors.ts";
import {
  createGeneratedPr,
  ensureGeneratedPrAutoMerge,
  findOpenGeneratedPrUrl,
  type OpenPrListItem,
} from "./data-dragon/data-dragon-pr.ts";
import {
  parseGitStatusLine,
  type GitStatusEntry,
} from "./data-dragon/data-dragon-diff.ts";
import { runCommand } from "./data-dragon/data-dragon-shell.ts";
import { disarmGitHooks, installScoutWorkspace } from "./bot-clone.ts";
import {
  discardFormattingOnlyChanges,
  runScoutGeneratedPreflight,
} from "./scout/scout-generated-preflight.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";

export const LanePriorWorkflowInputSchema = z.strictObject({
  lanePriors: LanePriorUpdateConfigSchema,
});

export type LanePriorWorkflowInput = z.infer<
  typeof LanePriorWorkflowInputSchema
>;

export type LanePriorRefreshResult = {
  changedFiles: string[];
  contentHash: string | undefined;
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  outcome: "success" | "skipped";
  reason: "pr-created" | "no-diff" | "pr-already-open";
  autoMergeConfigured?: boolean;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: "scout-lane-prior-refresh",
      ...fields,
    }),
  );
}

function parseChanges(status: string): GitStatusEntry[] {
  return status
    .split("\n")
    .map((line) => parseGitStatusLine(line))
    .filter((entry) => entry !== undefined);
}

function lanePriorDisallowedPaths(
  changes: readonly GitStatusEntry[],
): string[] {
  const allowed = new Set([
    LANE_PRIOR_ARTIFACT_PATH,
    LANE_PRIOR_EVAL_REPORT_PATH,
  ]);
  const disallowed = new Set<string>();
  for (const change of changes) {
    if (!allowed.has(change.path)) disallowed.add(change.path);
    if (
      change.previousPath !== undefined &&
      !allowed.has(change.previousPath)
    ) {
      disallowed.add(change.previousPath);
    }
  }
  return [...disallowed].toSorted();
}

async function changedLanePriorFiles(repoDir: string): Promise<string[]> {
  const status = await runCommand(["git", "status", "--porcelain"], {
    cwd: repoDir,
    trimStdout: false,
  });
  const changes = parseChanges(status);
  const disallowed = lanePriorDisallowedPaths(changes);
  if (disallowed.length > 0) {
    throw new Error(
      `Lane-prior refresh changed disallowed paths: ${disallowed.join(", ")}`,
    );
  }
  return changes.map((change) => change.path).toSorted();
}

function isLanePriorPr(
  pr: OpenPrListItem,
  appSlug: string,
  branch: string,
): boolean {
  return (
    pr.title === lanePriorPrTitle() &&
    pr.baseRefName === MAIN_BRANCH &&
    pr.headRefName === branch &&
    !pr.isCrossRepository &&
    pr.author.is_bot &&
    pr.author.login.replace(/^app\//, "").replace(/\[bot\]$/, "") === appSlug
  );
}

async function findOpenLanePriorPrUrl(
  branch: string,
  token: string,
): Promise<string | undefined> {
  return await findOpenGeneratedPrUrl({
    repoSlug: REPO_SLUG,
    filterArgs: ["--head", branch],
    token,
    matches: (pr, appSlug) => isLanePriorPr(pr, appSlug, branch),
  });
}

export type LanePriorActivities = typeof lanePriorActivities;

export const lanePriorActivities = {
  async updateLanePriors(
    input: LanePriorWorkflowInput,
  ): Promise<LanePriorRefreshResult> {
    const config = LanePriorWorkflowInputSchema.parse(input);
    const start = Date.now();
    const tempDir = `/tmp/scout-lane-priors-${crypto.randomUUID()}`;
    const repoDir = `${tempDir}/monorepo`;
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "updateLanePriors",
        elapsedMs: Date.now() - start,
      });
    }, 10_000);

    try {
      const tokenResult = await createGitHubAppInstallationToken();
      const githubToken = tokenResult.token;
      await runCommand(["mkdir", "-p", tempDir], { cwd: "/tmp" });
      const askpass = await writeGitAskpass(tempDir);
      const gitEnv = {
        GH_TOKEN: githubToken,
        GIT_ASKPASS: askpass,
        GIT_TERMINAL_PROMPT: "0",
      };

      await simpleGit().clone(REPO_URL, repoDir, [
        "--branch",
        MAIN_BRANCH,
        "--single-branch",
        "--depth",
        "1",
      ]);
      await installScoutWorkspace(repoDir);
      await updateLanePriors({
        repoDir,
        rawConfig: config.lanePriors,
        runCommand,
      });
      const reverted = await revertGeneratedAtOnlyLanePriorChanges(repoDir);
      if (reverted.length > 0) {
        jsonLog("info", "Reverted lane-prior timestamp churn", { reverted });
      }

      let files = await changedLanePriorFiles(repoDir);
      await discardFormattingOnlyChanges({
        repoDir,
        changedFiles: files,
        component: "scout-lane-prior-refresh",
      });
      files = await changedLanePriorFiles(repoDir);
      if (files.length === 0) {
        return {
          changedFiles: [],
          contentHash: undefined,
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
          outcome: "skipped",
          reason: "no-diff",
        };
      }

      await runScoutGeneratedPreflight({
        repoDir,
        changedFiles: files,
        runCommand,
      });
      files = await changedLanePriorFiles(repoDir);
      if (files.length === 0) {
        return {
          changedFiles: [],
          contentHash: undefined,
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
          outcome: "skipped",
          reason: "no-diff",
        };
      }
      const contentHash = await lanePriorContentHash(repoDir);
      const branch = lanePriorBranchName(contentHash);
      const title = lanePriorPrTitle();
      const existingPrUrl = await findOpenLanePriorPrUrl(branch, githubToken);
      if (existingPrUrl !== undefined) {
        const autoMergeConfigured = await ensureGeneratedPrAutoMerge({
          repoSlug: REPO_SLUG,
          prUrl: existingPrUrl,
          token: githubToken,
          onFailure: (error: unknown) => {
            jsonLog("warning", "Lane-prior PR auto-merge setup failed", {
              prUrl: existingPrUrl,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        });
        return {
          changedFiles: files,
          contentHash,
          branchName: branch,
          commitHash: undefined,
          prUrl: existingPrUrl,
          outcome: "skipped",
          reason: "pr-already-open",
          autoMergeConfigured,
        };
      }

      await runCommand(["git", "config", "user.email", "ci@sjer.red"], {
        cwd: repoDir,
      });
      await runCommand(["git", "config", "user.name", "CI Bot"], {
        cwd: repoDir,
      });
      const remoteBranch = await runCommand(
        ["git", "ls-remote", "--heads", "origin", `refs/heads/${branch}`],
        { cwd: repoDir, env: gitEnv, redactOutput: true },
      );
      if (remoteBranch.length > 0) {
        await runCommand(
          [
            "git",
            "fetch",
            "origin",
            `refs/heads/${branch}:refs/remotes/origin/${branch}`,
          ],
          { cwd: repoDir, env: gitEnv, redactOutput: true },
        );
      }
      await runCommand(["git", "checkout", "-B", branch], { cwd: repoDir });
      await runCommand(
        [
          "git",
          "add",
          "--",
          LANE_PRIOR_ARTIFACT_PATH,
          LANE_PRIOR_EVAL_REPORT_PATH,
        ],
        { cwd: repoDir },
      );
      await disarmGitHooks(repoDir);
      await runCommand(["git", "commit", "-m", title], { cwd: repoDir });
      if (remoteBranch.length > 0) {
        await assertRemoteBranchIsOurs({ repoDir, branch });
      }
      const commitHash = await runCommand(["git", "rev-parse", "HEAD"], {
        cwd: repoDir,
      });
      await runCommand(
        ["git", "push", "--force-with-lease", "origin", branch],
        { cwd: repoDir, env: gitEnv, redactOutput: true },
      );
      const body = [
        "Automated Scout lane-prior refresh from Temporal.",
        "",
        `Content hash: ${contentHash}`,
        `Changed files: ${String(files.length)}`,
        "",
        ...lanePriorPrBodyLines(config.lanePriors),
      ].join("\n");
      const { url: prUrl, recovered } = await createGeneratedPr(
        {
          repoSlug: REPO_SLUG,
          repoDir,
          branch,
          base: MAIN_BRANCH,
          title,
          body,
          token: githubToken,
        },
        {
          findOnHead: async () =>
            await findOpenLanePriorPrUrl(branch, githubToken),
        },
      );
      const autoMergeConfigured = await ensureGeneratedPrAutoMerge({
        repoSlug: REPO_SLUG,
        prUrl,
        token: githubToken,
        onFailure: (error: unknown) => {
          jsonLog("warning", "Lane-prior PR auto-merge setup failed", {
            prUrl,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      });
      return {
        changedFiles: files,
        contentHash,
        branchName: branch,
        commitHash,
        prUrl,
        outcome: recovered ? "skipped" : "success",
        reason: recovered ? "pr-already-open" : "pr-created",
        autoMergeConfigured,
      };
    } finally {
      clearInterval(heartbeat);
      await Bun.$`rm -rf ${tempDir}`.quiet();
    }
  },
};
