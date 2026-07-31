import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { resolvePostalAddresses, sendPostalEmail } from "#shared/postal.ts";
import {
  buildImageOnlySkipEmailContent,
  nonSuppressibleDataDragonPrChanges,
  parseGitStatusLine,
  shouldCreateDataDragonPr,
  type GitStatusEntry,
} from "./data-dragon-diff.ts";
import {
  LANE_PRIOR_ARTIFACT_PATH,
  LANE_PRIOR_EVAL_REPORT_PATH,
  LanePriorUpdateConfigSchema,
  lanePriorPrBodyLines,
  updateLanePriors,
  type LanePriorUpdateConfig,
} from "./data-dragon-lane-priors.ts";
import {
  botCloneCacheDir,
  disarmGitHooks,
  installScoutWorkspace,
} from "./bot-clone.ts";
import { recordAutoMergeFailure, recordRun } from "./data-dragon-metrics.ts";
import { findOpenDataDragonPrUrl } from "./data-dragon-pr.ts";
import { runCommand } from "./data-dragon-shell.ts";
import {
  branchName,
  dataDragonPrTitle,
  validateVersion,
} from "./data-dragon-util.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const DATA_DRAGON_VERSION_URL =
  "https://raw.githubusercontent.com/shepherdjerred/monorepo/main/packages/scout-for-lol/packages/data/src/data-dragon/assets/version.json";
const DATA_DRAGON_VERSIONS_URL =
  "https://ddragon.leagueoflegends.com/api/versions.json";
const SCOUT_ROOT = "packages/scout-for-lol";
const DATA_PACKAGE_ROOT = `${SCOUT_ROOT}/packages/data`;

const GENERATED_PATHS = [
  `${DATA_PACKAGE_ROOT}/src/data-dragon`,
  // Structured patch changeset (assets/patch-notes.json) is under src/data-dragon
  // above; the raw-notes provenance lives outside src, so stage it explicitly.
  `${DATA_PACKAGE_ROOT}/patch-notes-archive`,
  `${SCOUT_ROOT}/packages/backend/src/league/model/__tests__/__snapshots__`,
  `${SCOUT_ROOT}/packages/report/src/dataDragon/__snapshots__`,
  `${SCOUT_ROOT}/packages/report/src/html/arena/__snapshots__`,
  // Auto-generated "What's New" entry on minor-version bumps (update-data-dragon.ts).
  // A `git add` of an unchanged path is a no-op, so it only commits when the
  // updater actually wrote an entry.
  `${SCOUT_ROOT}/packages/frontend/src/data/changelog.tsx`,
  LANE_PRIOR_ARTIFACT_PATH,
  LANE_PRIOR_EVAL_REPORT_PATH,
];

const VersionFile = z.object({
  version: z.string().min(1),
});

const VersionsResponse = z.array(z.string().min(1)).min(1);

export type DataDragonUpdateMode = "version-check" | "weekly-refresh";

export const DataDragonWorkflowInputSchema = z.strictObject({
  lanePriors: LanePriorUpdateConfigSchema,
});

export type DataDragonWorkflowInput = z.infer<
  typeof DataDragonWorkflowInputSchema
>;

export type DataDragonVersionState = {
  currentVersion: string;
  latestVersion: string;
  updateRequired: boolean;
};

export type DataDragonUpdateInput = DataDragonVersionState & {
  mode: DataDragonUpdateMode;
  lanePriors: LanePriorUpdateConfig;
};

export type DataDragonUpdateResult = DataDragonUpdateInput & {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  outcome: "success" | "skipped";
  reason: "pr-created" | "no-diff" | "image-only-diff" | "pr-already-open";
  emailSent?: boolean;
  emailMessageId?: string;
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
      component: "scout-data-dragon-update",
      ...fields,
    }),
  );
}

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
  const status = await runCommand(
    ["git", "status", "--porcelain", "--", ...GENERATED_PATHS],
    { cwd: repoDir, trimStdout: false },
  );
  return status
    .split("\n")
    .map((line) => parseGitStatusLine(line))
    .filter((entry) => entry !== undefined);
}

/**
 * Enables auto-merge on an already-open Data Dragon PR, idempotently. Shared by
 * the create path and the dedup/retry path: `gh pr merge --auto` is safe to
 * re-issue on a PR that already has auto-merge enabled, so a retry whose prior
 * attempt died between `gh pr create` and `gh pr merge --auto` can finish the
 * setup here instead of leaving the PR stuck. On failure it records the
 * dedicated auto-merge-failure signal (so `ScoutDataDragonAutoMergeFailed`
 * fires) and logs, but does NOT throw — a PR exists either way, and the failure
 * is surfaced through its own alert rather than by failing the run. `--repo`
 * plus the full PR URL resolves the PR via the API, so the working directory
 * is irrelevant (the dedup path has no clone) — hence the fixed `/tmp` cwd.
 */
async function ensurePrAutoMerge(
  prUrl: string,
  githubToken: string,
  mode: DataDragonUpdateMode,
  logContext: Record<string, unknown>,
): Promise<void> {
  try {
    await runCommand(
      ["gh", "pr", "merge", "--repo", REPO_SLUG, "--auto", "--merge", prUrl],
      { cwd: "/tmp", env: { GH_TOKEN: githubToken }, redactOutput: true },
    );
  } catch (error: unknown) {
    recordAutoMergeFailure(mode);
    jsonLog("warning", "Data Dragon PR auto-merge setup failed", {
      ...logContext,
      prUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
    const id = crypto.randomUUID();
    const tempDir = `/tmp/scout-data-dragon-${id}`;
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
      const existingPrUrl = await findOpenDataDragonPrUrl(
        REPO_SLUG,
        input.latestVersion,
        githubToken,
      );
      if (existingPrUrl !== undefined) {
        // The prior attempt may have died between `gh pr create` and `gh pr
        // merge --auto`, leaving this PR open with auto-merge never enabled.
        // Finish the setup idempotently so the retry doesn't leave the PR
        // stuck (and so an auto-merge failure surfaces via its own alert)
        // before treating the dedup skip as complete.
        await ensurePrAutoMerge(existingPrUrl, githubToken, input.mode, {
          ...input,
          reason: "pr-already-open",
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
        };
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

      // Installs the root workspace once without hooks, then builds the shared
      // producers Scout imports. Without the llm-models build, the updater's
      // snapshot-refresh `bun test` dies with `Cannot find module
      // '@shepherdjerred/llm-models'`.
      await installScoutWorkspace(repoDir);
      await runCommand(
        ["bun", "run", "update-data-dragon", input.latestVersion],
        {
          cwd: `${repoDir}/${DATA_PACKAGE_ROOT}`,
          // The updater's snapshot-regeneration step runs `bun test`, which
          // loads scout's `configuration.ts` whose `env-var` validator only
          // accepts ENVIRONMENT ∈ {dev, beta, prod}. The Temporal worker pod
          // runs with ENVIRONMENT=production and the subprocess inherits it,
          // failing validation. Clear it at the subprocess boundary so Scout
          // falls back to its own default instead of inheriting pod config.
          //
          // BUN_INSTALL_CACHE_DIR is set here (not just by
          // installScoutWorkspace above) because update-data-dragon.ts's own
          // snapshot-refresh step shells out to a SECOND root `bun install
          // --force` internally via Bun's `$` — which inherits this
          // process's env — so this one override reaches that nested call
          // too, keeping it isolated from the pod-wide shared cache.
          env: {
            ENVIRONMENT: undefined,
            BUN_INSTALL_CACHE_DIR: botCloneCacheDir(repoDir),
          },
        },
      );
      await updateLanePriors({
        repoDir,
        rawConfig: input.lanePriors,
        runCommand,
      });

      const changes = await changedFiles(repoDir);
      const files = changes.map((change) => change.path);
      const durationSeconds = (Date.now() - start) / 1000;

      if (files.length === 0) {
        recordRun({
          mode: input.mode,
          outcome: "success",
          reason: "no-diff",
          currentVersion: input.currentVersion,
          latestVersion: input.latestVersion,
          changedFiles: 0,
          durationSeconds,
        });
        jsonLog("info", "Data Dragon update produced no diff", {
          ...input,
          durationSeconds,
        });
        return {
          ...input,
          changedFiles: [],
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
          outcome: "skipped",
          reason: "no-diff",
        };
      }

      if (!shouldCreateDataDragonPr(changes)) {
        const { recipient, sender } = resolvePostalAddresses();
        const emailContent = buildImageOnlySkipEmailContent(
          input,
          files.length,
        );
        const emailResult = await sendPostalEmail({
          to: recipient,
          from: sender,
          ...emailContent,
        });

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
          emailMessageId: emailResult.messageId,
        });
        return {
          ...input,
          changedFiles: files,
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
          outcome: "skipped",
          reason: "image-only-diff",
          emailSent: true,
          emailMessageId: emailResult.messageId,
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

      const branch = branchName(input.latestVersion, id);
      const title = dataDragonPrTitle(input.latestVersion);
      const body = [
        "Automated Scout Data Dragon refresh from Temporal.",
        "",
        `Current version: ${input.currentVersion}`,
        `Latest version: ${input.latestVersion}`,
        `Mode: ${input.mode}`,
        `Changed files: ${String(files.length)}`,
        "",
        ...lanePriorPrBodyLines(input.lanePriors),
      ].join("\n");

      await runCommand(["git", "config", "user.email", "ci@sjer.red"], {
        cwd: repoDir,
      });
      await runCommand(["git", "config", "user.name", "CI Bot"], {
        cwd: repoDir,
      });
      await runCommand(["git", "checkout", "-B", branch], { cwd: repoDir });
      await runCommand(["git", "add", "--", ...GENERATED_PATHS], {
        cwd: repoDir,
      });
      // Defense-in-depth, consistent with openSeasonRefreshPr: no agentic
      // step runs before this commit today, but disarm anyway so this
      // activity stays safe if one is ever added.
      await disarmGitHooks(repoDir);
      await runCommand(["git", "commit", "-m", title], { cwd: repoDir });
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
      const prUrl = await runCommand(
        [
          "gh",
          "pr",
          "create",
          "--repo",
          REPO_SLUG,
          "--base",
          MAIN_BRANCH,
          "--head",
          branch,
          "--title",
          title,
          "--body",
          body,
        ],
        { cwd: repoDir, env: { GH_TOKEN: githubToken }, redactOutput: true },
      );
      await ensurePrAutoMerge(prUrl, githubToken, input.mode, {
        ...input,
        branch,
      });

      recordRun({
        mode: input.mode,
        outcome: "success",
        reason: "pr-created",
        currentVersion: input.currentVersion,
        latestVersion: input.latestVersion,
        changedFiles: files.length,
        durationSeconds,
        prCreated: true,
      });
      jsonLog("info", "Data Dragon update PR created", {
        ...input,
        branch,
        prUrl,
        commitHash,
        changedFiles: files.length,
        durationSeconds,
      });

      return {
        ...input,
        changedFiles: files,
        branchName: branch,
        commitHash,
        prUrl,
        outcome: "success",
        reason: "pr-created",
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
      // terminal failure (PagerDuty #6948: a transient attempt-1 blip must not
      // page when attempt 2 self-heals). This block only logs the attempt.
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
