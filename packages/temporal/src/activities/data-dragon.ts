import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  DATA_DRAGON_GENERATED_PATHS,
  dataDragonDisallowedChangePaths,
  nonSuppressibleDataDragonPrChanges,
  parseGitStatusLine,
  shouldCreateDataDragonPr,
  type GitStatusEntry,
} from "./data-dragon-diff.ts";
import { jsonLog, noDiffResult } from "./data-dragon-results.ts";
import {
  botCloneCacheDir,
  disarmGitHooks,
  installScoutWorkspace,
} from "./bot-clone.ts";
import {
  discardFormattingOnlyChanges,
  runScoutGeneratedPreflight,
} from "./scout-generated-preflight.ts";
import { recordAutoMergeFailure, recordRun } from "./data-dragon-metrics.ts";
import type {
  DataDragonUpdateInput,
  DataDragonUpdateMode,
  DataDragonUpdateResult,
  DataDragonVersionState,
} from "#shared/data-dragon-types.ts";
import {
  createDataDragonPr,
  ensureGeneratedPrAutoMerge,
  getOpenDataDragonPrState,
} from "./data-dragon-pr.ts";
import { assertRemoteBranchIsOurs } from "./scout-season-refresh-git.ts";
import { runCommand } from "./data-dragon-shell.ts";
import {
  branchName,
  dataDragonPrTitle,
  validateVersion,
} from "#shared/data-dragon-util.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const DATA_DRAGON_VERSION_URL =
  "https://raw.githubusercontent.com/shepherdjerred/monorepo/main/packages/scout-for-lol/packages/data/src/data-dragon/assets/version.json";
const DATA_DRAGON_VERSIONS_URL =
  "https://ddragon.leagueoflegends.com/api/versions.json";
const SCOUT_ROOT = "packages/scout-for-lol";
const DATA_PACKAGE_ROOT = `${SCOUT_ROOT}/packages/data`;

const VersionFile = z.object({
  version: z.string().min(1),
});

const VersionsResponse = z.array(z.string().min(1)).min(1);

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "shepherdjerred-temporal-data-dragon-updater",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Fetch failed for ${url}: ${String(response.status)} ${response.statusText}`,
    );
  }
  return await response.json();
}

async function writeGitAskpass(tempDir: string): Promise<string> {
  const path = `${tempDir}/git-askpass.sh`;
  await Bun.write(
    path,
    [
      "#!/bin/sh",
      'case "$1" in',
      '  *Username*) echo "x-access-token" ;;',
      '  *) echo "$GH_TOKEN" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  await runCommand(["chmod", "+x", path], { cwd: tempDir });
  return path;
}

async function changedFiles(repoDir: string): Promise<GitStatusEntry[]> {
  const status = await runCommand(["git", "status", "--porcelain"], {
    cwd: repoDir,
    trimStdout: false,
  });
  const changes = status
    .split("\n")
    .map((line) => parseGitStatusLine(line))
    .filter((entry) => entry !== undefined);
  const disallowedPaths = dataDragonDisallowedChangePaths(changes);
  if (disallowedPaths.length > 0) {
    throw new Error(
      `Data Dragon update changed disallowed paths: ${disallowedPaths.join(", ")}`,
    );
  }
  return changes;
}

export type DataDragonActivities = typeof dataDragonActivities;

export const dataDragonActivities = {
  async getDataDragonVersionState(): Promise<DataDragonVersionState> {
    const [versionsJson, currentJson] = await Promise.all([
      fetchJson(DATA_DRAGON_VERSIONS_URL),
      fetchJson(DATA_DRAGON_VERSION_URL),
    ]);
    const latestVersion = VersionsResponse.parse(versionsJson)[0] ?? "";
    const currentVersion = VersionFile.parse(currentJson).version;

    jsonLog("info", "Checked Data Dragon versions", {
      latestVersion,
      currentVersion,
      updateRequired: latestVersion !== currentVersion,
    });

    return {
      latestVersion,
      currentVersion,
      updateRequired: latestVersion !== currentVersion,
    };
  },

  async recordDataDragonSkipped(
    input: DataDragonVersionState & {
      mode: DataDragonUpdateMode;
      reason: string;
    },
  ): Promise<void> {
    await Promise.resolve();
    recordRun({
      mode: input.mode,
      outcome: "skipped",
      reason: input.reason,
      currentVersion: input.currentVersion,
      latestVersion: input.latestVersion,
    });
    jsonLog("info", "Skipped Data Dragon update", input);
  },

  // Records the terminal outcome="failed" metric (and therefore the paging
  // alert) for an update that exhausted its retries. This is invoked from the
  // WORKFLOW's catch, not updateDataDragon's own catch: an attempt killed by
  // OOM / heartbeat timeout / worker death never runs activity code, so
  // recording the failed metric inside updateDataDragon would silently miss
  // exactly the outages the alert exists to catch. Temporal surfaces the
  // retries-exhausted failure to the workflow regardless of how the final
  // attempt died, so the workflow is the reliable recording point. The caller
  // extracts `reason` from the failure's cause chain
  // (resolveTerminalFailureReason) so the ScoutDataDragonPrAutomationFailed
  // reason filter keeps working.
  async recordDataDragonFailure(
    input: DataDragonVersionState & {
      mode: DataDragonUpdateMode;
      reason: string;
    },
  ): Promise<void> {
    await Promise.resolve();
    recordRun({
      mode: input.mode,
      outcome: "failed",
      reason: input.reason,
      currentVersion: input.currentVersion,
      latestVersion: input.latestVersion,
    });
    jsonLog("error", "Data Dragon update failed (terminal)", input);
  },

  async updateDataDragon(
    input: DataDragonUpdateInput,
  ): Promise<DataDragonUpdateResult> {
    validateVersion(input.latestVersion);
    const start = Date.now();
    // Per-attempt unique clone dir (concurrent retry attempts must not share a
    // working tree); the PR branch itself is deterministic per version, see
    // branchName.
    const tempDir = `/tmp/scout-data-dragon-${crypto.randomUUID()}`;
    const repoDir = `${tempDir}/monorepo`;

    // Heartbeat every 10s while the long subprocesses (bun install, bun run
    // update-data-dragon, gh pr create, ...) run. Pairs with the activity's
    // heartbeatTimeout: "60 seconds" in workflows/data-dragon.ts.
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "updateDataDragon",
        elapsedMs: Date.now() - start,
      });
    }, 10_000);

    try {
      const tokenResult = await createGitHubAppInstallationToken();
      const githubToken = tokenResult.token;

      // Retry-safe dedup guard (#1827/#1856). Temporal retries the *activity*,
      // not the workflow, so this must live here — not in the workflow — to
      // cover the case where a prior attempt ran `gh pr create` then the worker
      // died before the activity returned: the retry re-enters here, sees the
      // open PR, and skips instead of opening a duplicate under a fresh
      // UUID-suffixed branch. It also short-circuits a prior scheduled run's
      // still-open PR, and does so before the expensive clone/install/refresh.
      const { prUrl: existingPrUrl, state: existingPrState } =
        await getOpenDataDragonPrState({
          repoSlug: REPO_SLUG,
          latestVersion: input.latestVersion,
          token: githubToken,
        });
      const existingPrNeedsRefresh =
        existingPrState !== undefined &&
        existingPrState.baseRefOid !== existingPrState.mainRefOid;
      if (existingPrUrl !== undefined && !existingPrNeedsRefresh) {
        // The prior attempt may have died between `gh pr create` and `gh pr
        // merge --auto`, leaving this PR open with auto-merge never enabled.
        // Finish the setup idempotently so the retry doesn't leave the PR
        // stuck (and so an auto-merge failure surfaces via its own alert)
        // before treating the dedup skip as complete.
        const autoMergeConfigured = await ensureGeneratedPrAutoMerge({
          repoSlug: REPO_SLUG,
          prUrl: existingPrUrl,
          token: githubToken,
          onFailure: (error: unknown) => {
            recordAutoMergeFailure(input.mode);
            jsonLog("warning", "Data Dragon PR auto-merge setup failed", {
              ...input,
              prUrl: existingPrUrl,
              reason: "pr-already-open",
              error: error instanceof Error ? error.message : String(error),
            });
          },
        });
        const durationSeconds = (Date.now() - start) / 1000;
        recordRun({
          mode: input.mode,
          outcome: "skipped",
          reason: "pr-already-open",
          currentVersion: input.currentVersion,
          latestVersion: input.latestVersion,
          durationSeconds,
        });
        jsonLog("info", "Data Dragon update skipped; PR already open", {
          ...input,
          prUrl: existingPrUrl,
          durationSeconds,
        });
        return {
          ...input,
          changedFiles: [],
          branchName: undefined,
          commitHash: undefined,
          prUrl: existingPrUrl,
          outcome: "skipped",
          reason: "pr-already-open",
          autoMergeConfigured,
        };
      }
      if (existingPrNeedsRefresh) {
        jsonLog(
          "warning",
          "Refreshing stale Data Dragon PR from current main",
          {
            ...input,
            prUrl: existingPrUrl,
          },
        );
      }

      jsonLog("info", "Starting Data Dragon update", input);
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

      const branch =
        existingPrState?.headRefName ?? branchName(input.latestVersion);
      if (existingPrNeedsRefresh) {
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

      // Installs the root workspace once without hooks, then builds the shared
      // producers Scout imports. Without the llm-models build, the updater's
      // snapshot-refresh `bun run test` dies with `Cannot find module
      // '@shepherdjerred/llm-models'`.
      await installScoutWorkspace(repoDir);
      await runCommand(
        ["bun", "run", "update-data-dragon", input.latestVersion],
        {
          cwd: `${repoDir}/${DATA_PACKAGE_ROOT}`,
          // The updater's snapshot-regeneration step runs `bun run test`, which
          // loads scout's `configuration.ts` whose `env-var` validator only
          // accepts ENVIRONMENT ∈ {dev, beta, prod}. The Temporal worker pod
          // runs with ENVIRONMENT=production and the subprocess inherits it,
          // failing validation. Clear it at the subprocess boundary so Scout
          // falls back to its own default instead of inheriting pod config.
          //
          // BUN_INSTALL_CACHE_DIR pins ANY bun subprocess this updater spawns
          // to the per-clone cache rather than the pod-wide shared one. Its
          // original target (a second root `bun install --force` inside
          // update-data-dragon.ts) is gone, but the isolation should not depend
          // on the updater never installing again.
          env: {
            ENVIRONMENT: undefined,
            BUN_INSTALL_CACHE_DIR: botCloneCacheDir(repoDir),
          },
        },
      );
      let changes = await changedFiles(repoDir);
      const files = changes.map((change) => change.path);
      const durationSeconds = (Date.now() - start) / 1000;

      if (files.length === 0) {
        return noDiffResult(
          input,
          durationSeconds,
          "Data Dragon update produced no diff",
        );
      }

      const formattingOnlyFiles = await discardFormattingOnlyChanges({
        repoDir,
        changedFiles: files,
        component: "scout-data-dragon-update",
      });
      changes = await changedFiles(repoDir);
      if (changes.length === 0) {
        return noDiffResult(
          input,
          durationSeconds,
          "Data Dragon update skipped formatting-only diff",
          {
            reason: "formatting-only-diff",
            formattingOnlyFiles,
          },
        );
      }

      if (!shouldCreateDataDragonPr(changes)) {
        recordRun({
          mode: input.mode,
          outcome: "success",
          reason: "image-only-diff",
          currentVersion: input.currentVersion,
          latestVersion: input.latestVersion,
          changedFiles: files.length,
          durationSeconds,
        });
        jsonLog("info", "Data Dragon update skipped image-only diff", {
          ...input,
          changedFiles: files.length,
          durationSeconds,
        });
        return {
          ...input,
          changedFiles: files,
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
          outcome: "skipped",
          reason: "image-only-diff",
        };
      }

      const nonSuppressibleChanges =
        nonSuppressibleDataDragonPrChanges(changes);
      jsonLog("info", "Data Dragon update includes non-image changes", {
        ...input,
        changedFiles: files.length,
        nonSuppressibleFiles: nonSuppressibleChanges.length,
        nonSuppressibleExamples: nonSuppressibleChanges.slice(0, 20),
      });

      await runScoutGeneratedPreflight({
        repoDir,
        changedFiles: files,
        runCommand,
      });
      changes = await changedFiles(repoDir);
      const formattedFiles = changes.map((change) => change.path);

      const title = dataDragonPrTitle(input.latestVersion);
      const body = [
        "Automated Scout Data Dragon refresh from Temporal.",
        "",
        `Current version: ${input.currentVersion}`,
        `Latest version: ${input.latestVersion}`,
        `Mode: ${input.mode}`,
        `Changed files: ${String(formattedFiles.length)}`,
      ].join("\n");

      await runCommand(["git", "config", "user.email", "ci@sjer.red"], {
        cwd: repoDir,
      });
      await runCommand(["git", "config", "user.name", "CI Bot"], {
        cwd: repoDir,
      });
      await runCommand(["git", "checkout", "-B", branch], { cwd: repoDir });
      await runCommand(["git", "add", "--", ...DATA_DRAGON_GENERATED_PATHS], {
        cwd: repoDir,
      });
      // Defense-in-depth, consistent with openSeasonRefreshPr: no agentic
      // step runs before this commit today, but disarm anyway so this
      // activity stays safe if one is ever added.
      await disarmGitHooks(repoDir);
      await runCommand(["git", "commit", "-m", title], { cwd: repoDir });
      if (existingPrNeedsRefresh) {
        await assertRemoteBranchIsOurs({ repoDir, branch });
      }
      const commitHash = await runCommand(["git", "rev-parse", "HEAD"], {
        cwd: repoDir,
      });
      await runCommand(
        ["git", "push", "--force-with-lease", "origin", branch],
        {
          cwd: repoDir,
          env: gitEnv,
          redactOutput: true,
        },
      );
      // `recovered` means a concurrent retry attempt already opened this
      // version's PR on the same deterministic branch — GitHub refused our
      // duplicate create for that head, so we finish auto-merge on the existing
      // PR rather than double-creating. See createDataDragonPr.
      const { url: prUrl, recovered } = await createDataDragonPr({
        repoSlug: REPO_SLUG,
        repoDir,
        branch,
        base: MAIN_BRANCH,
        title,
        body,
        version: input.latestVersion,
        token: githubToken,
      });
      const autoMergeConfigured = await ensureGeneratedPrAutoMerge({
        repoSlug: REPO_SLUG,
        prUrl,
        token: githubToken,
        onFailure: (error: unknown) => {
          recordAutoMergeFailure(input.mode);
          jsonLog("warning", "Data Dragon PR auto-merge setup failed", {
            ...input,
            branch,
            prUrl,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      });

      recordRun({
        mode: input.mode,
        outcome: recovered ? "skipped" : "success",
        reason: recovered ? "pr-already-open" : "pr-created",
        currentVersion: input.currentVersion,
        latestVersion: input.latestVersion,
        changedFiles: formattedFiles.length,
        durationSeconds,
        prCreated: !recovered,
      });
      jsonLog(
        "info",
        recovered
          ? "Data Dragon PR already open; recovered at create"
          : "Data Dragon update PR created",
        {
          ...input,
          branch,
          prUrl,
          commitHash,
          changedFiles: formattedFiles.length,
          durationSeconds,
        },
      );

      return {
        ...input,
        changedFiles: formattedFiles,
        branchName: branch,
        commitHash,
        prUrl,
        outcome: recovered ? "skipped" : "success",
        reason: recovered ? "pr-already-open" : "pr-created",
        autoMergeConfigured,
      };
    } catch (error) {
      const durationSeconds = (Date.now() - start) / 1000;
      const attempt = Context.current().info.attempt;
      // The terminal outcome="failed" metric (and the paging alert) is recorded
      // by the WORKFLOW's catch via recordDataDragonFailure, not here: an
      // attempt killed by OOM / heartbeat timeout / worker death never reaches
      // this catch, so recording the failed metric here would silently miss
      // exactly those outages — while a per-attempt record would also
      // double-count across the retries the workflow already collapses into one
      // terminal failure. A transient attempt-1 blip must not create a false
      // failure signal when attempt 2 self-heals. This block only logs the attempt.
      jsonLog("error", "Data Dragon update attempt failed", {
        ...input,
        attempt,
        durationSeconds,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
      await Bun.$`rm -rf ${tempDir}`.quiet();
    }
  },
};
