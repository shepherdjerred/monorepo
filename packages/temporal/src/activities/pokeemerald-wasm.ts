import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { runCommand } from "./data-dragon-shell.ts";

// Monthly refresh of the vendored pokeemerald.wasm emulator blob. Mirrors the
// Scout Data Dragon updater (data-dragon.ts): clone the monorepo, re-fetch the
// blob, and open a PR when it changed. Deterministic — no AI agent.

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const PR_BRANCH = "auto/update-pokeemerald-wasm";
const WASM_PATH =
  "packages/discord-plays-pokemon/packages/backend/assets/pokeemerald.wasm";
const SHA_PATH = `${WASM_PATH}.sha256`;
const FETCH_SCRIPT = "packages/discord-plays-pokemon/scripts/fetch-wasm.ts";

export type PokeemeraldWasmUpdateResult = {
  outcome: "success" | "skipped";
  reason: "pr-created" | "pr-exists" | "no-diff";
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
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
      component: "pokeemerald-wasm-update",
      ...fields,
    }),
  );
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

export type PokeemeraldWasmActivities = typeof pokeemeraldWasmActivities;

export const pokeemeraldWasmActivities = {
  async updatePokeemeraldWasm(): Promise<PokeemeraldWasmUpdateResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const tempDir = `/tmp/pokeemerald-wasm-${id}`;
    const repoDir = `${tempDir}/monorepo`;

    // Heartbeat every 10s while the clone / fetch (~12 MB) / git push run.
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "updatePokeemeraldWasm",
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

      // Re-fetch the blob (FORCE overwrites the committed copy). ALLOW_WASM_UPDATE
      // lets fetch-wasm accept a new upstream hash and rewrite the sidecar; the
      // change still has to be reviewed in the PR this activity opens.
      await runCommand(["bun", FETCH_SCRIPT], {
        cwd: repoDir,
        env: { FORCE: "1", ALLOW_WASM_UPDATE: "1" },
      });

      const status = await runCommand(
        ["git", "status", "--porcelain", "--", WASM_PATH, SHA_PATH],
        { cwd: repoDir, trimStdout: false },
      );
      if (status.trim().length === 0) {
        jsonLog("info", "pokeemerald.wasm is unchanged");
        return {
          outcome: "skipped",
          reason: "no-diff",
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
        };
      }

      const title = "chore(discord-plays-pokemon): update pokeemerald.wasm";
      const body = [
        "Automated monthly refresh of the vendored pokeemerald.wasm emulator",
        "blob from pokeemerald.com, run from Temporal.",
      ].join(" ");

      await runCommand(["git", "config", "user.email", "ci@sjer.red"], {
        cwd: repoDir,
      });
      await runCommand(["git", "config", "user.name", "CI Bot"], {
        cwd: repoDir,
      });
      await runCommand(["git", "checkout", "-B", PR_BRANCH], { cwd: repoDir });
      await runCommand(["git", "add", "--", WASM_PATH, SHA_PATH], {
        cwd: repoDir,
      });
      await runCommand(["git", "commit", "-m", title], { cwd: repoDir });
      const commitHash = await runCommand(["git", "rev-parse", "HEAD"], {
        cwd: repoDir,
      });
      await runCommand(
        ["git", "push", "--force-with-lease", "origin", PR_BRANCH],
        { cwd: repoDir, env: gitEnv, redactOutput: true },
      );

      const openPrCount = await runCommand(
        [
          "gh",
          "pr",
          "list",
          "--repo",
          REPO_SLUG,
          "--state",
          "open",
          "--head",
          PR_BRANCH,
          "--json",
          "number",
          "--jq",
          "length",
        ],
        { cwd: repoDir, env: { GH_TOKEN: githubToken } },
      );
      if (openPrCount !== "0") {
        jsonLog("info", "pokeemerald.wasm PR already open; pushed update", {
          branch: PR_BRANCH,
          commitHash,
        });
        return {
          outcome: "success",
          reason: "pr-exists",
          branchName: PR_BRANCH,
          commitHash,
          prUrl: undefined,
        };
      }

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
          PR_BRANCH,
          "--title",
          title,
          "--body",
          body,
        ],
        { cwd: repoDir, env: { GH_TOKEN: githubToken }, redactOutput: true },
      );

      jsonLog("info", "pokeemerald.wasm update PR created", {
        branch: PR_BRANCH,
        prUrl,
        commitHash,
        durationSeconds: (Date.now() - start) / 1000,
      });
      return {
        outcome: "success",
        reason: "pr-created",
        branchName: PR_BRANCH,
        commitHash,
        prUrl,
      };
    } catch (error) {
      jsonLog("error", "pokeemerald.wasm update failed", {
        durationSeconds: (Date.now() - start) / 1000,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
      await Bun.$`rm -rf ${tempDir}`.quiet();
    }
  },
};
