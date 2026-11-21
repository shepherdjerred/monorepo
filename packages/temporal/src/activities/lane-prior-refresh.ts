import { Context } from "@temporalio/activity";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  changedAllowedFiles,
  cloneMainForGeneratedRefresh,
  publishGeneratedRefresh,
} from "./scout/generated-refresh.ts";
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
import { runCommand } from "./data-dragon/data-dragon-shell.ts";
import { installScoutWorkspace } from "./bot-clone.ts";
import {
  discardFormattingOnlyChanges,
  runScoutGeneratedPreflight,
} from "./scout/scout-generated-preflight.ts";

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

async function changedLanePriorFiles(repoDir: string): Promise<string[]> {
  return await changedAllowedFiles(
    repoDir,
    [LANE_PRIOR_ARTIFACT_PATH, LANE_PRIOR_EVAL_REPORT_PATH],
    "Lane-prior refresh",
  );
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
      const gitEnv = await cloneMainForGeneratedRefresh({
        tempDir,
        repoDir,
        githubToken,
      });
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
      const body = [
        "## Why",
        "Keep Scout lane priors aligned with current match observations.",
        "",
        "## What",
        "",
        `Content hash: ${contentHash}`,
        `Changed files: ${String(files.length)}`,
        "",
        ...lanePriorPrBodyLines(config.lanePriors),
        "",
        "## Verification",
        "Ran the lane-prior generator and generated-file preflight. Full CI and automated review must pass before merge. Live report acceptance has not run.",
      ].join("\n");
      const published = await publishGeneratedRefresh({
        repoDir,
        githubToken,
        gitEnv,
        branch: lanePriorBranchName(contentHash),
        title: lanePriorPrTitle(),
        body,
        files: [LANE_PRIOR_ARTIFACT_PATH, LANE_PRIOR_EVAL_REPORT_PATH],
        changedFiles: files,
        onAutoMergeFailure: (prUrl) => (error: unknown) => {
          jsonLog("warning", "Lane-prior PR auto-merge setup failed", {
            prUrl,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      });
      return { ...published, contentHash };
    } finally {
      clearInterval(heartbeat);
      await Bun.$`rm -rf ${tempDir}`.quiet();
    }
  },
};
