#!/usr/bin/env bun
/**
 * Promote a beta-validated scout-for-lol version to prod — ONE reviewable PR
 * that moves BOTH prod pins in packages/homelab/src/cdk8s/src/versions.ts
 * together, keeping backend and site in lockstep:
 *
 *   - "scout-for-lol-site/prod"            ← the target version (the CI
 *     scout-prod-reconcile step then syncs the prod bucket from the archived
 *     artifact at s3://scout-site-releases/<version>/)
 *   - "shepherdjerred/scout-for-lol/prod"  ← the CURRENT beta image line,
 *     copied verbatim. Verbatim because images are pushed as :$GIT_SHA +
 *     :latest only — the `2.0.0-<n>` in a pin is a cosmetic label on a
 *     digest-pinned ref, so a tag constructed from the target version would
 *     not exist in GHCR. Content-gating also means the beta image pin's build
 *     number may lag the site version; that is correct (identical content).
 *
 * Usage (operator, local):
 *   AWS_PROFILE=seaweedfs bun scripts/promote-scout.ts [--version 2.0.0-<n>]
 *       [--auto] [--force] [--allow-pending-bump]
 *
 * Defaults to promoting what beta serves right now (the public
 * https://beta.scout-for-lol.com/.release-version marker). Rollback = re-run
 * with an older archived --version (requires --force) or git-revert a
 * promotion commit.
 *
 * The edit happens in a temporary git worktree off origin/main — the
 * operator's checkout is never touched. Re-running refreshes the same
 * branch/PR. --auto enables squash auto-merge; default leaves the PR for
 * review.
 */

import { run, runAllowExit, tmpBase } from "./lib/run.ts";
import { SEAWEEDFS_ENDPOINT, SEAWEEDFS_AWS_ENV } from "./lib/s3-static-site.ts";

const VERSIONS_TS = "packages/homelab/src/cdk8s/src/versions.ts";
const RELEASES_BUCKET = "scout-site-releases";
const BETA_MARKER_URL = "https://beta.scout-for-lol.com/.release-version";
const VERSION_BUMP_BRANCH = "chore/version-bump-pending";
const VERSION_PATTERN = /^2\.0\.0-\d+$/;

function fail(message: string): never {
  throw new Error(message);
}

function buildNumber(version: string): number {
  const match = /^2\.0\.0-(\d+)/.exec(version);
  const digits = match?.[1];
  if (digits === undefined || digits === "") {
    fail(`cannot parse build number from version: ${version}`);
  }
  return Number.parseInt(digits, 10);
}

/** Default target: the version beta is serving right now (public marker). */
async function betaMarkerVersion(): Promise<string> {
  const response = await fetch(BETA_MARKER_URL);
  if (!response.ok) {
    fail(
      `GET ${BETA_MARKER_URL} -> ${response.status.toString()} — pass --version explicitly`,
    );
  }
  const markerText = await response.text();
  const version = markerText.trim();
  if (!VERSION_PATTERN.test(version)) {
    fail(
      `beta marker at ${BETA_MARKER_URL} is not a version (${version}) — pass --version explicitly`,
    );
  }
  return version;
}

/** The archived artifact must exist (manifest is the completeness certificate). */
async function assertArchived(version: string): Promise<void> {
  const head = await runAllowExit(
    [
      "aws",
      "s3api",
      "head-object",
      "--bucket",
      RELEASES_BUCKET,
      "--key",
      `${version}.json`,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
    ],
    { env: SEAWEEDFS_AWS_ENV, capture: true },
  );
  if (head.exitCode !== 0) {
    fail(
      `no archive manifest for ${version} in s3://${RELEASES_BUCKET}/ — the version ` +
        `was never (completely) archived or has expired. Only versions with a ` +
        `<version>.json manifest are promotable.`,
    );
  }
}

/**
 * Refuse to promote while an open version-bump PR touches the scout beta
 * image line: the just-pushed image it carries is not yet in versions.ts, so
 * copying the current beta line would pair an OLD backend with the new site.
 */
async function assertNoPendingScoutBump(): Promise<void> {
  const list = await run(
    [
      "gh",
      "pr",
      "list",
      "--head",
      VERSION_BUMP_BRANCH,
      "--state",
      "open",
      "--json",
      "number",
      "-q",
      ".[0].number // empty",
    ],
    { capture: true },
  );
  const prNumber = list.stdout.trim();
  if (prNumber === "") {
    return;
  }
  const diff = await run(["gh", "pr", "diff", prNumber], { capture: true });
  if (diff.stdout.includes("shepherdjerred/scout-for-lol/beta")) {
    fail(
      `version-bump PR #${prNumber} has an unmerged scout-for-lol/beta image bump — ` +
        `merge it first (or pass --allow-pending-bump to promote the older image anyway).`,
    );
  }
}

/** Replace a pin's value string in versions.ts content; throw if not found. */
function replacePin(content: string, key: string, newValue: string): string {
  // Pin keys contain only [a-z0-9./-] — no regex metacharacters to escape.
  const pattern = new RegExp(String.raw`("${key}":\s*\n?\s*)"([^"]*)"`);
  if (!pattern.test(content)) {
    fail(`could not find pin "${key}" in ${VERSIONS_TS}`);
  }
  return content.replace(pattern, `$1"${newValue}"`);
}

function extractPin(content: string, key: string): string {
  const pattern = new RegExp(String.raw`"${key}":\s*\n?\s*"([^"]*)"`);
  const value = pattern.exec(content)?.[1];
  if (value === undefined || value === "") {
    fail(`could not find pin "${key}" in ${VERSIONS_TS}`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const auto = args.includes("--auto");
  const force = args.includes("--force");
  const allowPendingBump = args.includes("--allow-pending-bump");
  const versionFlag = args.indexOf("--version");
  const explicitVersion = versionFlag === -1 ? null : args[versionFlag + 1];
  if (versionFlag !== -1 && explicitVersion === undefined) {
    fail("--version requires a value (2.0.0-<build>)");
  }

  // gh auth early: every guard and the PR itself need it.
  await run(["gh", "auth", "status"]);

  const version = explicitVersion ?? (await betaMarkerVersion());
  if (!VERSION_PATTERN.test(version)) {
    fail(`--version must match ${VERSION_PATTERN.toString()}, got: ${version}`);
  }
  console.log(`--- promoting scout-for-lol ${version} to prod`);

  await assertArchived(version);
  if (!allowPendingBump) {
    await assertNoPendingScoutBump();
  }

  await run(["git", "fetch", "origin", "main"]);
  const branch = `scout-promote-${version}`;
  const worktreeDir = `${tmpBase()}/${branch}`;
  // -B: create or reset the branch — re-running the same promotion refreshes
  // the same branch/PR instead of failing on "branch exists".
  await runAllowExit(["git", "worktree", "remove", "--force", worktreeDir]);
  await run([
    "git",
    "worktree",
    "add",
    "-B",
    branch,
    worktreeDir,
    "origin/main",
  ]);

  try {
    const versionsPath = `${worktreeDir}/${VERSIONS_TS}`;
    const content = await Bun.file(versionsPath).text();

    const betaImage = extractPin(content, "shepherdjerred/scout-for-lol/beta");
    const oldProdImage = extractPin(
      content,
      "shepherdjerred/scout-for-lol/prod",
    );
    const oldSitePin = extractPin(content, "scout-for-lol-site/prod");

    const betaImageBuild = buildNumber(betaImage);
    const targetBuild = buildNumber(version);
    if (targetBuild < betaImageBuild && !force) {
      fail(
        `target ${version} is older than the beta image pin (2.0.0-${betaImageBuild.toString()}). ` +
          `This is the rollback path — re-run with --force if intentional.`,
      );
    }

    if (oldSitePin === version && oldProdImage === betaImage) {
      console.log(
        `prod pins already at ${version} / ${betaImage} — nothing to promote`,
      );
      return;
    }

    let next = replacePin(content, "scout-for-lol-site/prod", version);
    next = replacePin(next, "shepherdjerred/scout-for-lol/prod", betaImage);
    await Bun.write(versionsPath, next);

    const title = `feat(homelab): promote scout-for-lol ${version} to prod`;
    await run(["git", "-C", worktreeDir, "add", VERSIONS_TS]);
    await run(["git", "-C", worktreeDir, "commit", "-m", title]);
    await run([
      "git",
      "-C",
      worktreeDir,
      "push",
      "--force-with-lease",
      "-u",
      "origin",
      branch,
    ]);

    const body =
      `Promotes the scout-for-lol prod stage to the beta-validated build.\n\n` +
      `| pin | before | after |\n| --- | --- | --- |\n` +
      `| \`scout-for-lol-site/prod\` | \`${oldSitePin}\` | \`${version}\` |\n` +
      `| \`shepherdjerred/scout-for-lol/prod\` | \`${oldProdImage}\` | \`${betaImage}\` |\n\n` +
      `Review what will ship on https://beta.scout-for-lol.com — after merge, ` +
      `ArgoCD deploys the backend and the next main build's scout-prod-reconcile ` +
      `step syncs the prod bucket from s3://scout-site-releases/${version}/. ` +
      `Verify with \`curl https://scout-for-lol.com/.release-version\`.`;

    const existing = await run(
      [
        "gh",
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "number",
        "-q",
        ".[0].number // empty",
      ],
      { capture: true },
    );
    let prNumber = existing.stdout.trim();
    if (prNumber === "") {
      await run([
        "gh",
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        branch,
        "--title",
        title,
        "--body",
        body,
      ]);
      const created = await run(
        ["gh", "pr", "view", branch, "--json", "number", "-q", ".number"],
        { capture: true },
      );
      prNumber = created.stdout.trim();
    }
    if (prNumber === "") {
      fail("promotion PR number is empty after create");
    }
    if (auto) {
      await run(["gh", "pr", "merge", prNumber, "--auto", "--squash"]);
      console.log(`--- promotion PR #${prNumber} set to auto-merge`);
    } else {
      console.log(`--- promotion PR #${prNumber} opened — review and merge`);
    }
  } finally {
    await runAllowExit(["git", "worktree", "remove", "--force", worktreeDir]);
  }
}

await main();
