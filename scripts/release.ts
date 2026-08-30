#!/usr/bin/env bun
/**
 * Run release-please to create release PRs and cut GitHub releases.
 *
 * Ported from the old CI's `releasePleaseHelper` (.dagger/src/release.ts).
 * Runs the package-owned release-please CLI, authed by the GitHub App token
 * minted from env creds.
 *
 * Pipeline order (matches the old helper): release-pr → refine → github-release.
 * The refine step runs Codex SDK with GPT-5.6 Luna through OpenRouter using
 * scripts/prompts/refine-release-please.md. It
 * rewrites the just-generated CHANGELOG entries into a consumer-focused view
 * and pushes a cleanup commit to the release PR. It exits 0 with a status
 * envelope when there is no open release PR or nothing to refine.
 *
 * Usage:
 *   bun scripts/release.ts [--dry-run]
 *
 * Env: GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY,
 *      OPENROUTER_API_KEY (refine step)
 */

import { requireEnv, run } from "./lib/run.ts";
import { setupGitAuth } from "./lib/github-auth.ts";
import {
  classifyAllPackageReleases,
  fetchNpmPackageTags,
  fetchReleaseTarget,
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

type ReleaseTarget = {
  readonly targetBranchSha: string;
  readonly excludedPaths: readonly string[];
};

/**
 * Resolve the exact main revision this release-please phase will read, and
 * classify npm eligibility at that same revision.
 *
 * Both belong to the phase, not to the lane. `runReleasePlease` clones and
 * pins per invocation and `assertTargetBranchSha` fails closed if main moves
 * around the operation, so a phase is already atomic on its own. Resolving
 * once for the whole lane instead made the pin span the CHANGELOG refinement —
 * a multi-minute agent run — so any unrelated merge in that window aborted the
 * `github-release` phase with "Release target main moved ...; retry the release
 * lane". That is what reddened builds 10946, 10958, 10993, 11001 and 11072,
 * each time with both phases otherwise healthy.
 *
 * Resolving per phase narrows the guarded window to the phase itself, which is
 * what the guard was for; it does not relax any check.
 */
async function resolveReleaseTarget(
  root: string,
  env: Record<string, string>,
): Promise<ReleaseTarget> {
  const targetBranchSha = await fetchReleaseTarget(root, env);
  const releaseDecisions = await classifyAllPackageReleases(
    root,
    "refs/remotes/origin/main",
  );
  printReleaseDecisions(releaseDecisions);
  return {
    targetBranchSha,
    excludedPaths: releaseDecisions
      .filter((decision) => !decision.eligible)
      .map((decision) => decision.packagePath),
  };
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
      "DRYRUN: would run `release-please release-pr`, the Codex SDK Luna " +
        "CHANGELOG refinement through OpenRouter (" +
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
    const releasePrTarget = await resolveReleaseTarget(root, env);

    // Validate the inference credential before release-please mutates the PR.
    const openRouterApiKey = requireEnv("OPENROUTER_API_KEY");
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
      targetBranchSha: releasePrTarget.targetBranchSha,
      excludedPaths: releasePrTarget.excludedPaths,
    });

    // Refine the just-generated CHANGELOGs. The prompt is the source of truth
    // for the agent's behavior; it exits 0 with a status envelope when there
    // is no open release PR, no bumped packages, or nothing to refine.
    // The agent runs arbitrary git/gh commands non-interactively. Its write
    // access is bounded by the fixed, code-reviewed prompt, the GitHub App
    // token's repo scope, and the externally isolated ephemeral CI pod.
    // There is no provider or model fallback.
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
      openRouterApiKey,
    });
    console.log(`--- CHANGELOG refinement complete (provider=${provider})`);

    // Re-resolve after refinement: the pin above is now minutes old, and this
    // phase clones and reads main again anyway.
    const githubReleaseTarget = await resolveReleaseTarget(root, env);
    await runReleasePlease({
      phase: "github-release",
      token: auth.token,
      repoUrl: `https://github.com/${MONOREPO_REPO}.git`,
      targetBranch: "main",
      targetBranchSha: githubReleaseTarget.targetBranchSha,
      excludedPaths: githubReleaseTarget.excludedPaths,
    });
    console.log("--- release-please complete");
  } finally {
    await auth.cleanup();
  }
}

await runMain(main);
