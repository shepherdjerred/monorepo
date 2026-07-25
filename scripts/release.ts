#!/usr/bin/env bun
/**
 * Run release-please to create release PRs and cut GitHub releases.
 *
 * Ported from the old CI's `releasePleaseHelper` (.dagger/src/release.ts).
 * Runs the package-owned release-please CLI, authed by the GitHub App token
 * minted from env creds.
 *
 * Pipeline order (matches the old helper): release-pr → refine → github-release.
 * The refine step runs a Claude agent (prompt: scripts/prompts/refine-release-please.md,
 * recovered verbatim from the old .dagger/prompts/) that rewrites the
 * just-generated CHANGELOG entries into a consumer-focused view and pushes a
 * cleanup commit to the release PR. It exits 0 with a status envelope when
 * there is no open release PR or nothing to refine.
 *
 * Usage:
 *   bun scripts/release.ts [--dry-run]
 *
 * Env: GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY,
 *      CLAUDE_CODE_OAUTH_TOKEN (refine step)
 */

import { run } from "./lib/run.ts";
import { setupGitAuth } from "./lib/github-auth.ts";
import { runMain } from "./lib/transient.ts";

const MONOREPO_REPO = "shepherdjerred/monorepo";

/** Repo root = one level up from scripts/. */
function repoRoot(): string {
  return new URL("..", import.meta.url).pathname;
}

function usage(): never {
  console.error("Usage: bun scripts/release.ts [--dry-run]");
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = new Set(Bun.argv.slice(2));
  if (argv.has("--help") || argv.has("-h")) {
    usage();
  }
  const dryRun = argv.has("--dry-run");

  console.log(`--- release-please${dryRun ? " (dry run)" : ""}`);
  if (dryRun) {
    console.log(
      "DRYRUN: would run `release-please release-pr`, the Claude CHANGELOG " +
        "refinement (scripts/prompts/refine-release-please.md), then " +
        "`release-please github-release` against " +
        `${MONOREPO_REPO} (target-branch=main).`,
    );
    return;
  }

  const root = repoRoot();
  const auth = await setupGitAuth(root);
  const env = auth.env;

  try {
    // release-please takes the token via --token; it does not need git askpass.
    const releasePlease = (subcommand: string) =>
      run(
        [
          "bun",
          "--no-install",
          "run",
          "--cwd",
          "packages/release-tools",
          "release-please",
          "--",
          subcommand,
          `--token=${auth.token}`,
          `--repo-url=${MONOREPO_REPO}`,
          "--target-branch=main",
        ],
        { cwd: root, env },
      );

    await releasePlease("release-pr");

    // Refine the just-generated CHANGELOGs. The prompt is the source of truth
    // for the agent's behavior; it exits 0 with a status envelope when there
    // is no open release PR, no bumped packages, or nothing to refine.
    // The agent runs arbitrary git/gh Bash commands non-interactively, so it
    // needs --dangerously-skip-permissions; its write access is bounded by
    // the fixed, code-reviewed prompt and the GitHub App token's repo scope —
    // re-evaluate if the prompt ever becomes dynamic. IS_SANDBOX=1 is Claude
    // Code's documented escape hatch for trusted ephemeral automation
    // containers (the flag refuses to run as root without it).
    console.log("--- refine CHANGELOGs");
    const claudeToken = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
    if (claudeToken === undefined || claudeToken === "") {
      throw new Error(
        "CLAUDE_CODE_OAUTH_TOKEN is required for the CHANGELOG refinement step",
      );
    }
    const prompt = await Bun.file(
      new URL("prompts/refine-release-please.md", import.meta.url).pathname,
    ).text();
    await run(
      [
        "claude",
        "-p",
        prompt,
        "--output-format",
        "json",
        "--allowed-tools",
        "Bash,Read,Edit,Write,Grep,Glob",
        "--dangerously-skip-permissions",
        "--max-turns",
        "80",
        "--model",
        "claude-opus-4-8",
      ],
      {
        cwd: root,
        // auth.env carries GH_TOKEN + the GIT_ASKPASS helper the agent's
        // git clone/push needs (the old helper's withAskpass: true).
        env: { ...env, IS_SANDBOX: "1" },
      },
    );

    await releasePlease("github-release");
    console.log("--- release-please complete");
  } finally {
    await auth.cleanup();
  }
}

await runMain(main);
