#!/usr/bin/env bun
/**
 * Run release-please to create release PRs and cut GitHub releases.
 *
 * Ported from the old CI's `releasePleaseHelper` (.dagger/src/release.ts).
 * Runs the release-please CLI via `bunx`, authed by the GitHub App token minted
 * from env creds.
 *
 * Pipeline order (matches the old helper): release-pr → [refine] → github-release.
 * The refine step (a Claude agent that rewrote the just-generated CHANGELOGs)
 * is currently STUBBED OUT — its prompt file `.dagger/prompts/refine-release-please.md`
 * was removed with the `.dagger` dir when CI was stripped. See the TODO marker
 * below and packages/docs/todos/release-changelog-refinement.md.
 *
 * Usage:
 *   bun scripts/release.ts [--dry-run]
 *
 * Env: GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY
 */

import { run } from "./lib/run.ts";
import { setupGitAuth } from "./lib/github-auth.ts";

const MONOREPO_REPO = "shepherdjerred/monorepo";
// Pinned in the old .dagger/src/constants.ts.
const RELEASE_PLEASE_VERSION = "17.9.0";

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
      "DRYRUN: would run `release-please release-pr` then " +
        "`release-please github-release` against " +
        `${MONOREPO_REPO} (target-branch=main). The CHANGELOG-refinement step ` +
        "is stubbed out — see packages/docs/todos/release-changelog-refinement.md.",
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
          "bunx",
          `release-please@${RELEASE_PLEASE_VERSION}`,
          subcommand,
          `--token=${auth.token}`,
          `--repo-url=${MONOREPO_REPO}`,
          "--target-branch=main",
        ],
        { cwd: root, env },
      );

    await releasePlease("release-pr");

    // TODO(todo:release-changelog-refinement): the Claude CHANGELOG-refinement
    // step between release-pr and github-release is intentionally omitted. Its
    // prompt (.dagger/prompts/refine-release-please.md) was deleted when CI was
    // stripped, so there is nothing self-contained to run here yet. Re-add it
    // per the todo doc once the prompt is re-homed.
    console.log(
      "(skipping CHANGELOG refinement — stubbed; see " +
        "packages/docs/todos/release-changelog-refinement.md)",
    );

    await releasePlease("github-release");
    console.log("--- release-please complete");
  } finally {
    await auth.cleanup();
  }
}

await main();
