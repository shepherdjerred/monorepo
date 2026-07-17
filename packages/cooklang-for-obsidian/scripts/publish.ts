#!/usr/bin/env bun
/**
 * Build the cooklang-for-obsidian plugin, publish it to the external plugin
 * repository, and bump the monorepo manifest to track the release.
 *
 * Ports three old CI helpers (.dagger/src/release.ts):
 *  - `cooklangBuildHelper`          — `bun run build` to produce main.js / manifest.json / styles.css
 *  - `cooklangPublishHelper`        — compute next patch version, commit the three
 *                                     plugin files to the plugin repo main, update
 *                                     versions.json on a compatibility-boundary change,
 *                                     and cut a bare-version GitHub release
 *  - `cooklangVersionCommitBackHelper` — open/refresh an auto-merge PR bumping
 *                                     packages/cooklang-for-obsidian/manifest.json
 *
 * Usage:
 *   bun scripts/publish.ts [--plugin-repo <owner/repo>] [--dry-run]
 *
 * Env: GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY
 */

import { run, tmpBase } from "../../../scripts/lib/run.ts";
import { setupGitAuth } from "../../../scripts/lib/github-auth.ts";
import { asRecord, toStringRecord } from "../../../scripts/lib/json.ts";

const MONOREPO_REPO = "shepherdjerred/monorepo";
const MONOREPO_WRITE_URL = `https://github.com/${MONOREPO_REPO}.git`;
const COOKLANG_VERSION_BUMP_BRANCH = "chore/cooklang-version-bump-pending";
const DEFAULT_PLUGIN_REPO = "shepherdjerred/cooklang-for-obsidian";
const GITHUB_REPO_SLUG_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/** cooklang package root = one level up from this script. */
function packageRoot(): string {
  return new URL("..", import.meta.url).pathname.replace(/\/$/, "");
}
/** Repo root = three levels up from this script. */
function repoRoot(): string {
  return new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
}

function validateRepoSlug(repo: string): string {
  if (!GITHUB_REPO_SLUG_PATTERN.test(repo)) {
    throw new Error(`Plugin repo must be a GitHub owner/repo slug: ${repo}`);
  }
  return repo;
}

/** Read a string field from a JSON file, throwing if it is missing/non-string. */
async function readJsonString(path: string, field: string): Promise<string> {
  const data = asRecord(await Bun.file(path).json());
  if (data === null || typeof data[field] !== "string") {
    throw new Error(`${path} has no string "${field}"`);
  }
  return data[field];
}

/**
 * Compute the next version: the latest semver release tag on the plugin repo
 * +1 patch, falling back to the built manifest's version when the repo has no
 * releases. Mirrors the old shell (`gh release list ... | grep semver | head`).
 */
async function computeNextVersion(
  pluginRepo: string,
  manifestVersion: string,
  env: Record<string, string>,
): Promise<string> {
  const list = await run(
    [
      "gh",
      "release",
      "list",
      "--repo",
      pluginRepo,
      "--limit",
      "50",
      "--json",
      "tagName",
      "--jq",
      ".[].tagName",
    ],
    { env, capture: true },
  );
  const semver = /^[0-9]+\.[0-9]+\.[0-9]+$/;
  const latest = list.stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => semver.test(l));
  const base = latest ?? manifestVersion;
  const parts = base.split(".");
  const major = Number.parseInt(parts[0] ?? "0", 10);
  const minor = Number.parseInt(parts[1] ?? "0", 10);
  const patch = Number.parseInt(parts[2] ?? "0", 10);
  return `${major.toString()}.${minor.toString()}.${(patch + 1).toString()}`;
}

function usage(): never {
  console.error(
    "Usage: bun scripts/publish.ts [--plugin-repo <owner/repo>] [--dry-run]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    usage();
  }
  const dryRun = argv.includes("--dry-run");
  const repoIdx = argv.indexOf("--plugin-repo");
  const pluginRepo = validateRepoSlug(
    repoIdx === -1 ? DEFAULT_PLUGIN_REPO : (argv[repoIdx + 1] ?? ""),
  );

  const pkgRoot = packageRoot();

  // 1. Build plugin artifacts (main.js / manifest.json / styles.css).
  console.log(`--- build cooklang-for-obsidian${dryRun ? " (dry run)" : ""}`);
  if (dryRun) {
    console.log(
      "DRYRUN: would run `bun run build` in packages/cooklang-for-obsidian",
    );
  } else {
    await run(["bun", "run", "build"], { cwd: pkgRoot });
  }

  // The build writes an updated manifest.json in the package root.
  const manifestPath = `${pkgRoot}/manifest.json`;
  const manifestVersion = await readJsonString(manifestPath, "version").catch(
    () => "0.0.0",
  );

  if (dryRun) {
    // Without creds we cannot query the plugin repo's releases; report the plan.
    console.log(
      `DRYRUN: would compute next patch version from ${pluginRepo} releases ` +
        `(fallback ${manifestVersion}), commit main.js/manifest.json/styles.css ` +
        `to ${pluginRepo}@main, cut a GitHub release, and open an auto-merge PR ` +
        `bumping packages/cooklang-for-obsidian/manifest.json on ${MONOREPO_REPO}.`,
    );
    return;
  }

  const auth = await setupGitAuth(repoRoot());
  const env = auth.env;

  try {
    const newVersion = await computeNextVersion(
      pluginRepo,
      manifestVersion,
      env,
    );
    console.log(`cooklang plugin: ${manifestVersion} -> ${newVersion}`);

    // 2. Rewrite the built manifest with the new version, then publish to the
    //    plugin repo. Clone the plugin repo, copy artifacts, commit + push,
    //    update versions.json on a compatibility-boundary change, cut a release.
    const manifest = asRecord(await Bun.file(manifestPath).json());
    if (manifest === null) {
      throw new Error(`${manifestPath} is not an object`);
    }
    manifest["version"] = newVersion;
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const minAppVersion =
      typeof manifest["minAppVersion"] === "string"
        ? manifest["minAppVersion"]
        : "0.0.0";

    const cloneDir = `${tmpBase()}/cooklang-plugin-${Date.now().toString()}`;
    await run(
      ["git", "clone", `https://github.com/${pluginRepo}.git`, cloneDir],
      { env },
    );
    const pluginGit = (args: string[]) =>
      run(["git", "-C", cloneDir, ...args], { env });
    await pluginGit(["config", "user.email", "ci@sjer.red"]);
    await pluginGit(["config", "user.name", "CI Bot"]);

    for (const f of ["main.js", "manifest.json", "styles.css"]) {
      await run(["cp", `${pkgRoot}/${f}`, `${cloneDir}/${f}`]);
    }

    // versions.json: only add an entry when the compatibility boundary changes.
    const versionsPath = `${cloneDir}/versions.json`;
    await updateVersionsJson(
      versionsPath,
      newVersion,
      minAppVersion,
      env,
      cloneDir,
    );

    await pluginGit(["add", "main.js", "manifest.json", "styles.css"]);
    const noChange = await pluginGit(["diff", "--cached", "--quiet"]).then(
      () => true,
      () => false,
    );
    if (noChange) {
      console.log("No artifact changes to commit");
    } else {
      await pluginGit([
        "commit",
        "-m",
        `release: v${newVersion}`,
        "-m",
        "Auto-Generated: ci-bot",
      ]);
      await pluginGit(["push", "origin", "HEAD:main"]);
    }

    // Cut the GitHub release (idempotent: skip if the tag already exists).
    const releaseExists = await run(
      ["gh", "release", "view", newVersion, "--repo", pluginRepo],
      { env },
    ).then(
      () => true,
      () => false,
    );
    if (releaseExists) {
      console.log(
        `Release ${newVersion} already exists on ${pluginRepo}, skipping`,
      );
    } else {
      await run(
        [
          "gh",
          "release",
          "create",
          newVersion,
          `${pkgRoot}/main.js`,
          `${pkgRoot}/manifest.json`,
          `${pkgRoot}/styles.css`,
          "--repo",
          pluginRepo,
          "--title",
          `v${newVersion}`,
          "--generate-notes",
        ],
        { env },
      );
    }

    if (await Bun.file(cloneDir).exists()) {
      await Bun.$`rm -rf ${cloneDir}`.quiet();
    }

    // 3. Commit-back: bump packages/cooklang-for-obsidian/manifest.json in the
    //    monorepo via an auto-merge PR.
    await cooklangCommitBack(newVersion, minAppVersion, env);
    console.log(`--- published cooklang plugin v${newVersion}`);
  } finally {
    await auth.cleanup();
  }
}

/**
 * Update versions.json only when the release changes the Obsidian compatibility
 * boundary (minAppVersion). Mirrors the old jq logic: compare the latest
 * semver-keyed value; add `newVersion -> minAppVersion` only if it differs.
 */
async function updateVersionsJson(
  versionsPath: string,
  newVersion: string,
  minAppVersion: string,
  env: Record<string, string>,
  gitDir: string,
): Promise<void> {
  const file = Bun.file(versionsPath);
  const raw: unknown = (await file.exists()) ? await file.json() : {};
  const versions = toStringRecord(raw);
  const semver = /^[0-9]+\.[0-9]+\.[0-9]+$/;
  const sortedKeys = Object.keys(versions)
    .filter((k) => semver.test(k))
    .sort((a, b) => compareSemver(a, b));
  const latestKey = sortedKeys[sortedKeys.length - 1];
  const latestMin = latestKey === undefined ? "" : versions[latestKey];

  if (latestMin === "" || latestMin !== minAppVersion) {
    versions[newVersion] = minAppVersion;
    await Bun.write(versionsPath, JSON.stringify(versions, null, 2) + "\n");
    await run(["git", "-C", gitDir, "add", "versions.json"], { env });
  } else {
    console.log(
      `versions.json compatibility boundary unchanged (${minAppVersion})`,
    );
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10));
  const pb = b.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Open/refresh an auto-merge PR bumping the monorepo cooklang manifest. */
async function cooklangCommitBack(
  version: string,
  minAppVersion: string,
  env: Record<string, string>,
): Promise<void> {
  const cloneDir = `${tmpBase()}/monorepo-cooklang-bump-${Date.now().toString()}`;
  await run(["git", "clone", MONOREPO_WRITE_URL, cloneDir], { env });
  const git = (args: string[]) =>
    run(["git", "-C", cloneDir, ...args], { env });
  try {
    await git(["config", "user.email", "ci@sjer.red"]);
    await git(["config", "user.name", "CI Bot"]);

    const branchExists =
      (await run(
        [
          "git",
          "-C",
          cloneDir,
          "ls-remote",
          "--exit-code",
          "--heads",
          "origin",
          COOKLANG_VERSION_BUMP_BRANCH,
        ],
        { env, capture: true },
      ).catch(() => null)) !== null;

    await git(["fetch", "origin", "main:refs/remotes/origin/main"]);
    if (branchExists) {
      await git([
        "fetch",
        "origin",
        `${COOKLANG_VERSION_BUMP_BRANCH}:${COOKLANG_VERSION_BUMP_BRANCH}`,
      ]);
      await git(["checkout", COOKLANG_VERSION_BUMP_BRANCH]);
      await git(["rebase", "origin/main"]);
    } else {
      await git([
        "checkout",
        "-b",
        COOKLANG_VERSION_BUMP_BRANCH,
        "origin/main",
      ]);
    }

    const manifestRel = "packages/cooklang-for-obsidian/manifest.json";
    const versionsRel = "packages/cooklang-for-obsidian/versions.json";
    const manifestAbs = `${cloneDir}/${manifestRel}`;
    const manifest = asRecord(await Bun.file(manifestAbs).json());
    if (manifest === null) {
      throw new Error(`${manifestAbs} is not an object`);
    }
    manifest["version"] = version;
    await Bun.write(manifestAbs, JSON.stringify(manifest, null, 2) + "\n");

    await updateVersionsJson(
      `${cloneDir}/${versionsRel}`,
      version,
      minAppVersion,
      env,
      cloneDir,
    );
    await git(["add", manifestRel]);

    const noChange = await git(["diff", "--cached", "--quiet"]).then(
      () => true,
      () => false,
    );
    let committed = false;
    if (noChange) {
      console.log("No cooklang version changes to commit");
    } else {
      await git([
        "commit",
        "-m",
        `chore(cooklang): bump to v${version}`,
        "-m",
        "Auto-Generated: ci-bot",
      ]);
      committed = true;
    }
    if (!committed) {
      const noBranchDiff = await git([
        "diff",
        "--quiet",
        "origin/main...HEAD",
      ]).then(
        () => true,
        () => false,
      );
      if (noBranchDiff) {
        console.log("No cooklang changes and pending branch has no diff");
        return;
      }
    }

    await git([
      "push",
      "--force-with-lease",
      "-u",
      "origin",
      COOKLANG_VERSION_BUMP_BRANCH,
    ]);

    const prList = await run(
      [
        "gh",
        "pr",
        "list",
        "--repo",
        MONOREPO_REPO,
        "--head",
        COOKLANG_VERSION_BUMP_BRANCH,
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
          COOKLANG_VERSION_BUMP_BRANCH,
          "--title",
          "chore(cooklang): bump plugin manifest version",
          "--body",
          "Auto-generated cooklang manifest version bump",
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
          COOKLANG_VERSION_BUMP_BRANCH,
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
      throw new Error("cooklang version commit-back PR number is empty");
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
    console.log(`opened/updated cooklang bump PR #${prNumber}`);
  } finally {
    if (await Bun.file(cloneDir).exists()) {
      await Bun.$`rm -rf ${cloneDir}`.quiet();
    }
  }
}

await main();
