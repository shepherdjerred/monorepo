#!/usr/bin/env bun

import { rm } from "node:fs/promises";

import { setupGitAuth } from "./lib/github-auth.ts";
import {
  mergePinCandidates,
  mergePinStates,
  parsePinCandidates,
  parsePinCandidatesState,
  parseVersionsSource,
  rewriteVersionsSource,
  serializePinCandidatesState,
  validateCandidateKeys,
  validateStateAgainstVersions,
  type PinCandidates,
} from "./lib/pin-candidates.ts";
import { run, runAllowExit, tmpBase } from "./lib/run.ts";
import { runMain } from "./lib/transient.ts";

const MONOREPO_REPO = "shepherdjerred/monorepo";
const MONOREPO_WRITE_URL = `https://github.com/${MONOREPO_REPO}.git`;
const VERSION_BUMP_BRANCH = "chore/version-bump-pending";
const VERSIONS_FILE_REL = "packages/homelab/src/cdk8s/src/versions.ts";
const PIN_STATE_FILE_REL = "scripts/pin-candidates-state.json";
const MAX_LEASE_ATTEMPTS = 3;

type GitRunner = (
  args: string[],
  options?: { allowExit?: boolean; capture?: boolean },
) => Promise<{ exitCode: number; stderr: string; stdout: string }>;

type ResetGitRunner = (args: string[]) => Promise<unknown>;

/**
 * Reconstruct the generated bump branch from current main.
 *
 * Main image builds are scoped from the last green main build, and a failed
 * commit-back prevents that baseline from advancing. The current candidate
 * state therefore contains every still-pending image change. Starting from
 * main is both cumulative and immune to conflicts from a closed or superseded
 * generated PR.
 */
export async function resetVersionBumpBranch(
  git: ResetGitRunner,
): Promise<void> {
  await git(["checkout", "-B", VERSION_BUMP_BRANCH, "origin/main"]);
}

async function readBranchFile(
  git: GitRunner,
  ref: string,
  path: string,
): Promise<string> {
  const result = await git(["show", `${ref}:${path}`], {
    allowExit: true,
    capture: true,
  });
  if (result.exitCode !== 0) {
    throw new Error(`failed to read ${path} from ${ref}: ${result.stderr}`);
  }
  return result.stdout;
}

async function remoteBranchSha(git: GitRunner): Promise<string | null> {
  const result = await git(
    ["ls-remote", "--heads", "origin", VERSION_BUMP_BRANCH],
    { capture: true },
  );
  const line = result.stdout.trim();
  if (line === "") {
    return null;
  }
  const [sha, ref, ...extra] = line.split(/\s+/);
  if (
    sha === undefined ||
    ref !== `refs/heads/${VERSION_BUMP_BRANCH}` ||
    extra.length > 0 ||
    !/^[0-9a-f]{40}$/.test(sha)
  ) {
    throw new Error(`unexpected ls-remote output: ${line}`);
  }
  return sha;
}

async function prepareAttempt(
  cloneDir: string,
  git: GitRunner,
  batch: PinCandidates,
  remoteSha: string | null,
): Promise<boolean> {
  await git(["fetch", "origin", "main:refs/remotes/origin/main"]);
  if (remoteSha !== null) {
    await git([
      "fetch",
      "origin",
      `+${VERSION_BUMP_BRANCH}:refs/remotes/origin/${VERSION_BUMP_BRANCH}`,
    ]);
  }

  const mainSource = await readBranchFile(
    git,
    "origin/main",
    VERSIONS_FILE_REL,
  );
  const mainState = parsePinCandidatesState(
    await readBranchFile(git, "origin/main", PIN_STATE_FILE_REL),
  );
  const mainVersions = parseVersionsSource(mainSource);
  validateStateAgainstVersions(mainState, mainVersions);
  validateCandidateKeys(batch, mainVersions);

  let aggregate = mainState;
  if (remoteSha !== null) {
    const pendingSource = await readBranchFile(
      git,
      `origin/${VERSION_BUMP_BRANCH}`,
      VERSIONS_FILE_REL,
    );
    const pendingState = parsePinCandidatesState(
      await readBranchFile(
        git,
        `origin/${VERSION_BUMP_BRANCH}`,
        PIN_STATE_FILE_REL,
      ),
    );
    validateStateAgainstVersions(
      pendingState,
      parseVersionsSource(pendingSource),
    );
    aggregate = mergePinStates(aggregate, pendingState);
  }
  aggregate = mergePinCandidates(aggregate, batch);

  await resetVersionBumpBranch(git);
  await Bun.write(
    `${cloneDir}/${VERSIONS_FILE_REL}`,
    rewriteVersionsSource(mainSource, aggregate),
  );
  await Bun.write(
    `${cloneDir}/${PIN_STATE_FILE_REL}`,
    serializePinCandidatesState(aggregate),
  );
  await git(["add", VERSIONS_FILE_REL, PIN_STATE_FILE_REL]);
  const staged = await git(["diff", "--cached", "--quiet"], {
    allowExit: true,
  });
  if (staged.exitCode === 0) {
    return false;
  }
  if (staged.exitCode !== 1) {
    throw new Error(`git diff failed: ${staged.stderr}`);
  }
  await git([
    "commit",
    "-m",
    `chore: update image pins from build ${batch.buildNumber.toString()}`,
    "-m",
    "Auto-Generated: ci-bot",
  ]);
  return true;
}

function isLeaseRejection(stderr: string): boolean {
  return stderr.includes("stale info");
}

export async function pushWithExactLease(
  git: GitRunner,
  expectedSha: string | null = null,
): Promise<"pushed" | "retry"> {
  const expected = expectedSha ?? "";
  const result = await git(
    [
      "push",
      `--force-with-lease=refs/heads/${VERSION_BUMP_BRANCH}:${expected}`,
      "-u",
      "origin",
      VERSION_BUMP_BRANCH,
    ],
    { allowExit: true },
  );
  if (result.exitCode === 0) {
    return "pushed";
  }
  if (isLeaseRejection(result.stderr)) {
    return "retry";
  }
  throw new Error(`version pin push failed: ${result.stderr}`);
}

async function openOrUpdatePullRequest(
  env: Record<string, string>,
): Promise<void> {
  const prList = await run(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      MONOREPO_REPO,
      "--head",
      VERSION_BUMP_BRANCH,
      "--state",
      "open",
      "--json",
      "number",
      "-q",
      ".[0].number // empty",
    ],
    { env, capture: true },
  );
  let prNumber = prList.stdout.trim();
  if (prNumber === "") {
    await run(
      [
        "gh",
        "pr",
        "create",
        "--repo",
        MONOREPO_REPO,
        "--base",
        "main",
        "--head",
        VERSION_BUMP_BRANCH,
        "--title",
        "chore: bump pending image versions",
        "--body",
        "Auto-generated version bump",
      ],
      { env },
    );
    const created = await run(
      [
        "gh",
        "pr",
        "view",
        "--repo",
        MONOREPO_REPO,
        VERSION_BUMP_BRANCH,
        "--json",
        "number",
        "-q",
        ".number",
      ],
      { env, capture: true },
    );
    prNumber = created.stdout.trim();
  }
  if (prNumber === "") {
    throw new Error("version commit-back PR number is empty");
  }
  await run(
    [
      "gh",
      "pr",
      "merge",
      "--repo",
      MONOREPO_REPO,
      prNumber,
      "--auto",
      "--squash",
    ],
    { env },
  );
}

async function commitBack(
  batch: PinCandidates,
  dryRun: boolean,
): Promise<void> {
  const candidateCount = Object.keys(batch.candidates).length;
  if (candidateCount === 0) {
    console.log("No pin candidates; exiting before authentication");
    return;
  }
  if (dryRun) {
    console.log(
      serializePinCandidatesState(
        mergePinCandidates(
          { schema: "pin-candidates-state/v1", pins: {} },
          batch,
        ),
      ),
    );
    return;
  }

  const root = new URL("..", import.meta.url).pathname;
  const auth = await setupGitAuth(root);
  const env = auth.env;
  const cloneDir = `${tmpBase()}/monorepo-version-bump-${crypto.randomUUID()}`;
  try {
    await run(["git", "clone", MONOREPO_WRITE_URL, cloneDir], { env });
    const git: GitRunner = async (args, options = {}) => {
      const command = ["git", "-C", cloneDir, ...args];
      const runOptions = { env, capture: options.capture === true };
      return options.allowExit === true
        ? await runAllowExit(command, runOptions)
        : await run(command, runOptions);
    };
    await git(["config", "user.email", "ci@sjer.red"]);
    await git(["config", "user.name", "CI Bot"]);

    let pushed = false;
    for (let attempt = 1; attempt <= MAX_LEASE_ATTEMPTS; attempt++) {
      const expectedSha = await remoteBranchSha(git);
      const changed = await prepareAttempt(cloneDir, git, batch, expectedSha);
      if (!changed) {
        console.log("Image pins already include every candidate");
        return;
      }
      const outcome = await pushWithExactLease(git, expectedSha);
      if (outcome === "pushed") {
        pushed = true;
        break;
      }
      console.log(
        `version pin branch changed during attempt ${attempt.toString()}; retrying`,
      );
    }
    if (!pushed) {
      throw new Error(
        `version pin push lost ${MAX_LEASE_ATTEMPTS.toString()} consecutive leases`,
      );
    }
    await openOrUpdatePullRequest(env);
  } finally {
    await auth.cleanup();
    await rm(cloneDir, { recursive: true, force: true });
  }
}

function usage(): never {
  console.error(
    "Usage: bun scripts/update-versions.ts --commit-back --candidates '<pin-candidates/v1 JSON>' [--dry-run]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    usage();
  }
  if (!argv.includes("--commit-back")) {
    usage();
  }
  const candidatesIndex = argv.indexOf("--candidates");
  const candidatesJson =
    candidatesIndex === -1 ? undefined : argv[candidatesIndex + 1];
  if (candidatesJson === undefined) {
    throw new Error("--candidates requires a pin-candidates/v1 JSON document");
  }
  await commitBack(
    parsePinCandidates(candidatesJson),
    argv.includes("--dry-run"),
  );
}

if (import.meta.main) {
  await runMain(main);
}
