#!/usr/bin/env bun
/**
 * Run release-please to create release PRs and cut GitHub releases.
 *
 * Ported from the old CI's `releasePleaseHelper` (.dagger/src/release.ts).
 * Runs the package-owned release-please CLI, authed by the GitHub App token
 * minted from env creds.
 *
 * Pipeline order (matches the old helper): release-pr → refine → github-release.
 * The refine step runs an agent (Claude primary, Codex fallback on validated
 * Claude quota exhaustion) using scripts/prompts/refine-release-please.md. It
 * rewrites the just-generated CHANGELOG entries into a consumer-focused view
 * and pushes a cleanup commit to the release PR. It exits 0 with a status
 * envelope when there is no open release PR or nothing to refine.
 *
 * Usage:
 *   bun scripts/release.ts [--dry-run]
 *
 * Env: GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY,
 *      CLAUDE_CODE_OAUTH_TOKEN, CODEX_ACCESS_TOKEN (refine step)
 */

import { requireEnv, run } from "./lib/run.ts";
import { setupGitAuth } from "./lib/github-auth.ts";
import {
  classifyAllPackageReleases,
  fetchNpmPackageTags,
  type PackageReleaseDecision,
} from "./lib/npm-release-eligibility.ts";
import { runReleaseRefiner } from "./lib/release-refiner.ts";
import { runMain } from "./lib/transient.ts";
import { runReleasePlease } from "@shepherdjerred/release-tools/runner";

const MONOREPO_REPO = "shepherdjerred/monorepo";

function printReleaseDecisions(
  decisions: readonly PackageReleaseDecision[],
): void {
  for (const decision of decisions) {
    const state = decision.eligible ? "eligible" : "excluded";
    const reason =
      decision.reasons.length === 0
        ? "no consumer-facing changes"
        : decision.reasons.join("; ");
    console.log(
      `--- npm release policy: ${decision.packageName} ${state} ` +
        `(since ${decision.latestTag}; ${reason})`,
    );
  }
}

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
      "DRYRUN: would run `release-please release-pr`, the dual-provider " +
        "CHANGELOG refinement (Claude primary, Codex quota fallback; " +
        "scripts/prompts/refine-release-please.md), then " +
        "`release-please github-release` against " +
        `${MONOREPO_REPO} (target-branch=main).`,
    );
    return;
  }

  const root = repoRoot();
  const auth = await setupGitAuth(root);
  const env = auth.env;

  try {
    // The canonical Buildkite checkout intentionally uses --no-tags. Fetch the
    // authoritative package tags before the fail-closed eligibility preflight.
    await fetchNpmPackageTags(root, env);
    const releaseDecisions = await classifyAllPackageReleases(root);
    printReleaseDecisions(releaseDecisions);
    const excludedPaths = releaseDecisions
      .filter((decision) => !decision.eligible)
      .map((decision) => decision.packagePath);

    // Validate both providers before release-please mutates the release PR.
    // Codex is an intentional quota fallback, not an optional best-effort path.
    const claudeToken = requireEnv("CLAUDE_CODE_OAUTH_TOKEN");
    const codexAccessToken = requireEnv("CODEX_ACCESS_TOKEN");
    // Codex runs tool calls through a login shell. Verify that exact boundary,
    // not only this process's mise-aware PATH, before release-please mutates a PR.
    await run(["/bin/bash", "-lc", "gh --version"], {
      cwd: root,
      capture: true,
    });

    await runReleasePlease({
      phase: "release-pr",
      token: auth.token,
      repoUrl: `https://github.com/${MONOREPO_REPO}.git`,
      targetBranch: "main",
      excludedPaths,
    });

    // Refine the just-generated CHANGELOGs. The prompt is the source of truth
    // for the agent's behavior; it exits 0 with a status envelope when there
    // is no open release PR, no bumped packages, or nothing to refine.
    // Both agents run arbitrary git/gh commands non-interactively. Their write
    // access is bounded by the fixed, code-reviewed prompt, the GitHub App
    // token's repo scope, and the externally isolated ephemeral CI pod.
    // Unknown Claude failures remain hard failures; only a parsed 429
    // usage-quota result selects Codex.
    console.log("--- refine CHANGELOGs");
    const prompt = await Bun.file(
      new URL("prompts/refine-release-please.md", import.meta.url).pathname,
    ).text();
    const provider = await runReleaseRefiner({
      root,
      prompt,
      // auth.env carries GH_TOKEN + the GIT_ASKPASS helper the agent's
      // git clone/push needs (the old helper's withAskpass: true).
      env,
      claudeToken,
      codexAccessToken,
    });
    console.log(`--- CHANGELOG refinement complete (provider=${provider})`);

    await runReleasePlease({
      phase: "github-release",
      token: auth.token,
      repoUrl: `https://github.com/${MONOREPO_REPO}.git`,
      targetBranch: "main",
      excludedPaths,
    });
    console.log("--- release-please complete");
  } finally {
    await auth.cleanup();
  }
}

await runMain(main);
