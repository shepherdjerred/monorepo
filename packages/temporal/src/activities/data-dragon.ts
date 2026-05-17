import { Context, metricMeter } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import { resolvePostalAddresses, sendPostalEmail } from "#shared/postal.ts";
import {
  buildImageOnlySkipEmailContent,
  parseGitStatusLine,
  shouldCreateDataDragonPr,
  type GitStatusEntry,
} from "./data-dragon-diff.ts";
import { runCommand } from "./data-dragon-shell.ts";
import {
  branchName,
  failureReason,
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
  `${SCOUT_ROOT}/packages/backend/src/league/model/__tests__/__snapshots__`,
  `${SCOUT_ROOT}/packages/report/src/dataDragon/__snapshots__`,
  `${SCOUT_ROOT}/packages/report/src/html/arena/__snapshots__`,
];

const VersionFile = z.object({
  version: z.string().min(1),
});

const VersionsResponse = z.array(z.string().min(1)).min(1);

export type DataDragonUpdateMode = "version-check" | "weekly-refresh";

export type DataDragonVersionState = {
  currentVersion: string;
  latestVersion: string;
  updateRequired: boolean;
};

export type DataDragonRunMetrics = {
  mode: DataDragonUpdateMode;
  outcome: "success" | "skipped" | "failed";
  reason: string;
  currentVersion: string;
  latestVersion: string;
  changedFiles?: number;
  durationSeconds?: number;
  prCreated?: boolean;
};

export type DataDragonUpdateInput = DataDragonVersionState & {
  mode: DataDragonUpdateMode;
};

export type DataDragonUpdateResult = DataDragonUpdateInput & {
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
  outcome: "success" | "skipped";
  reason: "pr-created" | "no-diff" | "image-only-diff";
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

function metrics(): {
  runs: ReturnType<typeof metricMeter.createCounter>;
  prs: ReturnType<typeof metricMeter.createCounter>;
  duration: ReturnType<typeof metricMeter.createHistogram>;
  changedFiles: ReturnType<typeof metricMeter.createGauge>;
  versionInfo: ReturnType<typeof metricMeter.createGauge>;
} {
  return {
    runs: metricMeter.createCounter(
      "scout_data_dragon_runs",
      "1",
      "Scout Data Dragon updater runs",
    ),
    prs: metricMeter.createCounter(
      "scout_data_dragon_prs",
      "1",
      "Scout Data Dragon updater PRs opened",
    ),
    duration: metricMeter.createHistogram(
      "scout_data_dragon_duration",
      "float",
      "s",
      "Scout Data Dragon updater duration",
    ),
    changedFiles: metricMeter.createGauge(
      "scout_data_dragon_changed_files",
      "int",
      "1",
      "Scout Data Dragon updater changed files",
    ),
    versionInfo: metricMeter.createGauge(
      "scout_data_dragon_version_info",
      "int",
      "1",
      "Scout Data Dragon latest version info",
    ),
  };
}

function recordRun(input: DataDragonRunMetrics): void {
  const meter = metrics();
  const baseTags = {
    mode: input.mode,
    outcome: input.outcome,
    reason: input.reason,
  };
  meter.runs.add(1, baseTags);
  meter.changedFiles.set(input.changedFiles ?? 0, {
    mode: input.mode,
    outcome: input.outcome,
  });
  meter.versionInfo.set(1, {
    current_version: input.currentVersion,
    latest_version: input.latestVersion,
  });
  if (input.durationSeconds !== undefined) {
    meter.duration.record(input.durationSeconds, {
      mode: input.mode,
      outcome: input.outcome,
    });
  }
  if (input.prCreated === true) {
    meter.prs.add(1, { mode: input.mode });
  }
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
    { cwd: repoDir },
  );
  return status
    .split("\n")
    .map((line) => parseGitStatusLine(line))
    .filter((entry) => entry !== undefined);
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
    input: DataDragonVersionState & { mode: DataDragonUpdateMode },
  ): Promise<void> {
    await Promise.resolve();
    recordRun({
      mode: input.mode,
      outcome: "skipped",
      reason: "version-current",
      currentVersion: input.currentVersion,
      latestVersion: input.latestVersion,
    });
    jsonLog("info", "Skipped Data Dragon update; version is current", input);
  },

  async updateDataDragon(
    input: DataDragonUpdateInput,
  ): Promise<DataDragonUpdateResult> {
    validateVersion(input.latestVersion);
    const start = Date.now();
    const id = crypto.randomUUID();
    const tempDir = `/tmp/scout-data-dragon-${id}`;
    const repoDir = `${tempDir}/monorepo`;
    const ghToken = Bun.env["GH_TOKEN"] ?? "";

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
      if (ghToken === "") {
        throw new Error("GH_TOKEN is required to publish Data Dragon updates");
      }

      jsonLog("info", "Starting Data Dragon update", input);
      await runCommand(["mkdir", "-p", tempDir], { cwd: "/tmp" });
      const askpass = await writeGitAskpass(tempDir);
      const gitEnv = {
        GH_TOKEN: ghToken,
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

      await runCommand(["bun", "install", "--frozen-lockfile"], {
        cwd: `${repoDir}/${SCOUT_ROOT}`,
      });
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
          env: { ENVIRONMENT: undefined },
        },
      );

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

      const branch = branchName(input.latestVersion, id);
      const title = `chore: update Scout Data Dragon to ${input.latestVersion}`;
      const body = [
        "Automated Scout Data Dragon refresh from Temporal.",
        "",
        `Current version: ${input.currentVersion}`,
        `Latest version: ${input.latestVersion}`,
        `Mode: ${input.mode}`,
        `Changed files: ${String(files.length)}`,
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
        { cwd: repoDir, env: { GH_TOKEN: ghToken }, redactOutput: true },
      );
      await runCommand(
        ["gh", "pr", "merge", "--repo", REPO_SLUG, "--auto", "--merge", prUrl],
        { cwd: repoDir, env: { GH_TOKEN: ghToken }, redactOutput: true },
      );

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
      recordRun({
        mode: input.mode,
        outcome: "failed",
        reason: failureReason(error),
        currentVersion: input.currentVersion,
        latestVersion: input.latestVersion,
        durationSeconds,
      });
      jsonLog("error", "Data Dragon update failed", {
        ...input,
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
