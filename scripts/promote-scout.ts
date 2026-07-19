#!/usr/bin/env bun
/**
 * Scout-for-lol prod promotion — moves BOTH prod pins in
 * packages/homelab/src/cdk8s/src/versions.ts together, keeping backend and
 * site in lockstep:
 *
 *   - "scout-for-lol-site/prod"            ← the target site version (the CI
 *     scout-prod-reconcile step then syncs the prod bucket from the archived
 *     artifact at s3://scout-site-releases/<version>/)
 *   - "shepherdjerred/scout-for-lol/prod"  ← the CURRENT beta image line,
 *     copied verbatim. Verbatim because images are pushed as :$GIT_SHA +
 *     :latest only — the `2.0.0-<n>` in a pin is a cosmetic label on a
 *     digest-pinned ref, so a tag constructed from the target version would
 *     not exist in GHCR. Content-gating also means the beta image pin's build
 *     number may lag the site version; that is correct (identical content).
 *
 * CI mode (the normal path — runs on every main build):
 *   bun scripts/promote-scout.ts --ci --site-version 2.0.0-<build> [--dry-run]
 *
 *   Maintains the standing `scout-promote-pending` branch/PR: whenever beta
 *   has something prod doesn't — prod still unpromoted, the backend image
 *   line changed, or the scout package changed since the promoted site
 *   version's commit — the PR is opened/refreshed to move both pins to what
 *   beta currently serves (the committed beta image pin + this build's
 *   archived site). When prod is already up to date, any stale open PR is
 *   closed. MERGING THE PR IS THE PROMOTION — versions.ts drives everything
 *   downstream (ArgoCD for the backend, scout-prod-reconcile for the site).
 *   Auto-merge is deliberately NOT enabled: turning it on would make prod
 *   track beta continuously; leave it off to keep promotion a review click.
 *   Auth: GitHub App creds (GITHUB_APP_ID/…_INSTALLATION_ID/…_PRIVATE_KEY),
 *   same as the version commit-back step.
 *
 * Operator mode (rollbacks / explicit targets):
 *   AWS_PROFILE=seaweedfs bun scripts/promote-scout.ts --version 2.0.0-<n>
 *       [--auto] [--force] [--allow-pending-bump]
 *
 *   Promotes an explicit archived version (defaults to what beta serves via
 *   the public beta `.release-version` marker). Targets older than the beta
 *   image pin require --force — that is the rollback path. Uses the
 *   operator's own gh auth; edits happen in a temporary git worktree so the
 *   operator's checkout is never touched.
 */

import { z } from "zod";
import { run, runAllowExit, tmpBase } from "./lib/run.ts";
import { setupGitAuth } from "./lib/github-auth.ts";
import { SEAWEEDFS_ENDPOINT, SEAWEEDFS_AWS_ENV } from "./lib/s3-static-site.ts";

/** Shape of a site archive's `<version>.json` completeness manifest. */
const ManifestSchema = z.object({ gitSha: z.string().min(1) });

const MONOREPO_REPO = "shepherdjerred/monorepo";
const MONOREPO_WRITE_URL = `https://github.com/${MONOREPO_REPO}.git`;
const VERSIONS_TS = "packages/homelab/src/cdk8s/src/versions.ts";
const RELEASES_BUCKET = "scout-site-releases";
const BETA_MARKER_URL = "https://beta.scout-for-lol.com/.release-version";
const VERSION_BUMP_BRANCH = "chore/version-bump-pending";
const PROMOTE_BRANCH = "scout-promote-pending";
const SITE_PIN_KEY = "scout-for-lol-site/prod";
const IMAGE_PROD_KEY = "shepherdjerred/scout-for-lol/prod";
const IMAGE_BETA_KEY = "shepherdjerred/scout-for-lol/beta";
const SCOUT_PACKAGE_PATH = "packages/scout-for-lol";
const VERSION_PATTERN = /^2\.0\.0-\d+$/;
const UNPROMOTED_SENTINEL = "unpromoted";

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
 * The gitSha recorded in an archived version's manifest, or null when the
 * manifest is missing/unreadable (callers treat unknown provenance as "assume
 * changed" — the safe direction for a promotion gate).
 */
async function manifestGitSha(version: string): Promise<string | null> {
  const result = await runAllowExit(
    [
      "aws",
      "s3",
      "cp",
      `s3://${RELEASES_BUCKET}/${version}.json`,
      "-",
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
    ],
    { env: SEAWEEDFS_AWS_ENV, capture: true },
  );
  if (result.exitCode !== 0) {
    return null;
  }
  const parsed = ManifestSchema.safeParse(JSON.parse(result.stdout));
  return parsed.success ? parsed.data.gitSha : null;
}

/** Body of the promotion PR (shared by both modes). */
function promotionBody(opts: {
  siteVersion: string;
  betaImage: string;
  oldSitePin: string;
  oldProdImage: string;
  ciMode: boolean;
}): string {
  const { siteVersion, betaImage, oldSitePin, oldProdImage, ciMode } = opts;
  const refreshNote = ciMode
    ? `\n\nThis PR is maintained automatically by the \`scout promotion PR\` CI step: ` +
      `it refreshes whenever beta moves ahead of prod and closes when prod is up to ` +
      `date. **Merging it IS the promotion** — auto-merge is intentionally left off ` +
      `so promotion stays a deliberate review click (enabling it would make prod ` +
      `track beta continuously).`
    : "";
  return (
    `Promotes the scout-for-lol prod stage to the beta-validated build.\n\n` +
    `| pin | before | after |\n| --- | --- | --- |\n` +
    `| \`${SITE_PIN_KEY}\` | \`${oldSitePin}\` | \`${siteVersion}\` |\n` +
    `| \`${IMAGE_PROD_KEY}\` | \`${oldProdImage}\` | \`${betaImage}\` |\n\n` +
    `Review what will ship on https://beta.scout-for-lol.com — after merge, ` +
    `ArgoCD deploys the backend and the next main build's scout-prod-reconcile ` +
    `step syncs the prod bucket from s3://${RELEASES_BUCKET}/${siteVersion}/. ` +
    `Verify with \`curl https://scout-for-lol.com/.release-version\`.${refreshNote}`
  );
}

/** Find the open PR number for a head branch, or "" when none exists. */
async function openPrNumber(
  branch: string,
  env: Record<string, string>,
): Promise<string> {
  const list = await run(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      MONOREPO_REPO,
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number",
      "-q",
      ".[0].number // empty",
    ],
    { env, capture: true },
  );
  return list.stdout.trim();
}

// ---------------------------------------------------------------------------
// CI mode — maintain the standing promotion PR from versions.ts state
// ---------------------------------------------------------------------------

/**
 * Is beta meaningfully ahead of prod? Returns the human-readable reason, or
 * null when prod is up to date. Three triggers:
 *   1. prod was never promoted (sentinel pin);
 *   2. the backend image line changed (covers base-image/toolchain-driven
 *      rebuilds that touch nothing under packages/scout-for-lol);
 *   3. the scout package changed since the promoted site version's commit
 *      (covers frontend-only changes, which never move the content-gated
 *      image digest).
 * Without this gate the site pin would differ EVERY build (release stamping
 * makes bundles unique), and the standing PR would churn forever.
 */
async function promotionReason(opts: {
  cloneDir: string;
  env: Record<string, string>;
  betaImage: string;
  oldProdImage: string;
  oldSitePin: string;
}): Promise<string | null> {
  const { cloneDir, env, betaImage, oldProdImage, oldSitePin } = opts;
  if (oldSitePin === UNPROMOTED_SENTINEL) {
    return "prod has never been promoted";
  }
  if (betaImage !== oldProdImage) {
    return "backend image changed";
  }
  const promotedSha = await manifestGitSha(oldSitePin);
  if (promotedSha === null) {
    return `promoted version ${oldSitePin} has no readable archive manifest`;
  }
  const scoutChanges = await runAllowExit(
    [
      "git",
      "-C",
      cloneDir,
      "log",
      "--oneline",
      `${promotedSha}..HEAD`,
      "--",
      SCOUT_PACKAGE_PATH,
    ],
    { env, capture: true },
  );
  if (scoutChanges.exitCode !== 0) {
    // Unknown ancestry (e.g. sha unreachable) — assume changed.
    return `cannot diff against promoted sha ${promotedSha}`;
  }
  if (scoutChanges.stdout.trim() !== "") {
    return `scout package changed since ${oldSitePin}`;
  }
  return null;
}

async function ciPromote(siteVersion: string, dryRun: boolean): Promise<void> {
  console.log(`--- scout promotion PR (target site ${siteVersion})`);
  if (dryRun) {
    console.log(
      `DRYRUN: would compare prod pins against beta and open/refresh/close the ` +
        `${PROMOTE_BRANCH} PR accordingly (no clone, no GitHub App token minted).`,
    );
    return;
  }

  const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const auth = await setupGitAuth(root);
  const env = auth.env;
  const cloneDir = `${tmpBase()}/monorepo-scout-promote-${process.pid.toString()}`;

  try {
    await run(["git", "clone", MONOREPO_WRITE_URL, cloneDir], { env });
    const git = (args: string[]) =>
      run(["git", "-C", cloneDir, ...args], { env });
    await git(["config", "user.email", "ci@sjer.red"]);
    await git(["config", "user.name", "CI Bot"]);
    await git(["fetch", "origin", "main:refs/remotes/origin/main"]);

    const content = await Bun.file(`${cloneDir}/${VERSIONS_TS}`).text();
    const betaImage = extractPin(content, IMAGE_BETA_KEY);
    const oldProdImage = extractPin(content, IMAGE_PROD_KEY);
    const oldSitePin = extractPin(content, SITE_PIN_KEY);

    const reason = await promotionReason({
      cloneDir,
      env,
      betaImage,
      oldProdImage,
      oldSitePin,
    });

    if (reason === null) {
      console.log("prod is up to date with beta — no promotion needed");
      const stale = await openPrNumber(PROMOTE_BRANCH, env);
      if (stale !== "") {
        await run(
          [
            "gh",
            "pr",
            "close",
            "--repo",
            MONOREPO_REPO,
            stale,
            "--comment",
            "Prod caught up with beta — nothing left to promote. CI will reopen this when beta moves ahead again.",
            "--delete-branch",
          ],
          { env },
        );
        console.log(`closed stale promotion PR #${stale}`);
      }
      return;
    }

    console.log(`promotion warranted: ${reason}`);
    await assertArchived(siteVersion);

    // Regenerate the standing branch from scratch — the promotion diff is a
    // pure function of current state, so there is nothing to preserve.
    await git(["checkout", "-B", PROMOTE_BRANCH, "origin/main"]);
    let next = replacePin(content, SITE_PIN_KEY, siteVersion);
    next = replacePin(next, IMAGE_PROD_KEY, betaImage);
    await Bun.write(`${cloneDir}/${VERSIONS_TS}`, next);

    const title = `feat(homelab): promote scout-for-lol ${siteVersion} to prod`;
    await git(["add", VERSIONS_TS]);
    await git(["commit", "-m", title, "-m", "Auto-Generated: ci-bot"]);
    // Fetch the remote branch (if any) so --force-with-lease has a lease ref.
    const remoteBranch = await runAllowExit(
      [
        "git",
        "-C",
        cloneDir,
        "fetch",
        "origin",
        `${PROMOTE_BRANCH}:refs/remotes/origin/${PROMOTE_BRANCH}`,
      ],
      { env },
    );
    if (remoteBranch.exitCode !== 0) {
      console.log(`no existing ${PROMOTE_BRANCH} branch — pushing fresh`);
    }
    await git(["push", "--force-with-lease", "-u", "origin", PROMOTE_BRANCH]);

    const body = promotionBody({
      siteVersion,
      betaImage,
      oldSitePin,
      oldProdImage,
      ciMode: true,
    });
    let prNumber = await openPrNumber(PROMOTE_BRANCH, env);
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
          PROMOTE_BRANCH,
          "--title",
          title,
          "--body",
          body,
        ],
        { env },
      );
      prNumber = await openPrNumber(PROMOTE_BRANCH, env);
    } else {
      // Keep the PR's title/body in sync with the refreshed target version.
      await run(
        [
          "gh",
          "pr",
          "edit",
          "--repo",
          MONOREPO_REPO,
          prNumber,
          "--title",
          title,
          "--body",
          body,
        ],
        { env },
      );
    }
    if (prNumber === "") {
      fail("promotion PR number is empty after create");
    }
    console.log(
      `--- promotion PR #${prNumber} ready (${siteVersion}) — merging it promotes prod`,
    );
  } finally {
    await auth.cleanup();
    if (await Bun.file(cloneDir).exists()) {
      await Bun.$`rm -rf ${cloneDir}`.quiet();
    }
  }
}

// ---------------------------------------------------------------------------
// Operator mode — explicit target / rollback
// ---------------------------------------------------------------------------

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

/**
 * Refuse to promote while an open version-bump PR touches the scout beta
 * image line: the just-pushed image it carries is not yet in versions.ts, so
 * copying the current beta line would pair an OLD backend with the new site.
 * (CI mode needs no such guard — it pairs the committed pin with the same
 * build's archive, which is exactly what beta runs.)
 */
async function assertNoPendingScoutBump(): Promise<void> {
  const prNumber = await openPrNumber(VERSION_BUMP_BRANCH, {});
  if (prNumber === "") {
    return;
  }
  const diff = await run(["gh", "pr", "diff", prNumber], { capture: true });
  if (diff.stdout.includes(IMAGE_BETA_KEY)) {
    fail(
      `version-bump PR #${prNumber} has an unmerged scout-for-lol/beta image bump — ` +
        `merge it first (or pass --allow-pending-bump to promote the older image anyway).`,
    );
  }
}

async function operatorPromote(args: string[]): Promise<void> {
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

    const betaImage = extractPin(content, IMAGE_BETA_KEY);
    const oldProdImage = extractPin(content, IMAGE_PROD_KEY);
    const oldSitePin = extractPin(content, SITE_PIN_KEY);

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

    let next = replacePin(content, SITE_PIN_KEY, version);
    next = replacePin(next, IMAGE_PROD_KEY, betaImage);
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

    const body = promotionBody({
      siteVersion: version,
      betaImage,
      oldSitePin,
      oldProdImage,
      ciMode: false,
    });
    let prNumber = await openPrNumber(branch, {});
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
      prNumber = await openPrNumber(branch, {});
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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.includes("--ci")) {
    const flag = args.indexOf("--site-version");
    const siteVersion = flag === -1 ? undefined : args[flag + 1];
    if (siteVersion === undefined || !VERSION_PATTERN.test(siteVersion)) {
      fail("--ci requires --site-version 2.0.0-<build>");
    }
    await ciPromote(siteVersion, args.includes("--dry-run"));
    return;
  }
  await operatorPromote(args);
}

await main();
