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

import { rm } from "node:fs/promises";

import { setupGitAuth } from "../../../scripts/lib/github-auth.ts";
import { asRecord } from "../../../scripts/lib/json.ts";
import { run, runAllowExit, tmpBase } from "../../../scripts/lib/run.ts";

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

const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

type ManifestMetadata = {
  data: Record<string, unknown>;
  minAppVersion: string;
  version: string;
};

export async function readManifestMetadata(
  path: string,
): Promise<ManifestMetadata> {
  const data = asRecord(await Bun.file(path).json());
  if (data === null) {
    throw new Error(`${path} is not a JSON object`);
  }
  const version = data["version"];
  const minAppVersion = data["minAppVersion"];
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(`${path} has an invalid "version"`);
  }
  if (
    typeof minAppVersion !== "string" ||
    !SEMVER_PATTERN.test(minAppVersion)
  ) {
    throw new Error(`${path} has an invalid "minAppVersion"`);
  }
  return { data, minAppVersion, version };
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
  const latest = list.stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => SEMVER_PATTERN.test(l));
  const base = latest ?? manifestVersion;
  const parts = base.split(".");
  const major = Number.parseInt(parts[0] ?? "", 10);
  const minor = Number.parseInt(parts[1] ?? "", 10);
  const patch = Number.parseInt(parts[2] ?? "", 10);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    throw new Error(`invalid release version ${base}`);
  }
  return `${major.toString()}.${minor.toString()}.${(patch + 1).toString()}`;
}

function usage(): never {
  console.error(
    "Usage: bun scripts/publish.ts [--plugin-repo <owner/repo>] [--dry-run]",
  );
  process.exit(1);
}

/**
 * The latest release's tag when the freshly-built plugin artifacts are
 * byte-identical to its assets (manifest.json excluded — it embeds the
 * version), else null. A repo with no releases yet returns null so the first
 * release still cuts. Returning the tag (not just a bool) lets the caller
 * resume an interrupted commit-back for exactly the published version.
 */
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function structuralJson(value: unknown, omitVersion: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => structuralJson(entry, false));
  }
  const record = asRecord(value);
  if (record === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !(omitVersion && key === "version"))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, structuralJson(entry, false)]),
  );
}

export function manifestsMatchIgnoringVersion(
  built: unknown,
  released: unknown,
): boolean {
  return (
    JSON.stringify(structuralJson(built, true)) ===
    JSON.stringify(structuralJson(released, true))
  );
}

export async function matchingLatestReleaseTag(
  pkgRoot: string,
  pluginRepo: string,
  env: Record<string, string>,
): Promise<string | null> {
  const latest = await run(
    [
      "gh",
      "release",
      "list",
      "--repo",
      pluginRepo,
      "--limit",
      "1",
      "--json",
      "tagName",
      "--jq",
      '.[0].tagName // ""',
    ],
    { env, capture: true },
  );
  const tag = latest.stdout.trim();
  if (tag === "") {
    return null;
  }

  const downloadDir = `${tmpBase()}/cooklang-latest-release-${Date.now().toString()}`;
  try {
    await run(
      [
        "gh",
        "release",
        "download",
        "--repo",
        pluginRepo,
        tag,
        "--pattern",
        "main.js",
        "--pattern",
        "styles.css",
        "--pattern",
        "manifest.json",
        "--dir",
        downloadDir,
      ],
      { env },
    );
    for (const name of ["main.js", "styles.css"]) {
      const built = Bun.file(`${pkgRoot}/${name}`);
      const released = Bun.file(`${downloadDir}/${name}`);
      if (!(await built.exists()) || !(await released.exists())) {
        return null;
      }
      const [builtBytes, releasedBytes] = await Promise.all([
        built.bytes(),
        released.bytes(),
      ]);
      if (!bytesEqual(builtBytes, releasedBytes)) {
        return null;
      }
    }
    const builtManifestPath = `${pkgRoot}/manifest.json`;
    const releasedManifestPath = `${downloadDir}/manifest.json`;
    await readManifestMetadata(builtManifestPath);
    await readManifestMetadata(releasedManifestPath);
    const [builtManifest, releasedManifest] = await Promise.all([
      Bun.file(builtManifestPath).json(),
      Bun.file(releasedManifestPath).json(),
    ]);
    if (!manifestsMatchIgnoringVersion(builtManifest, releasedManifest)) {
      return null;
    }
    console.log(`latest release ${tag} matches the built artifacts`);
    return tag;
  } finally {
    // rm -rf is a no-op on a nonexistent dir (Bun.file().exists() is
    // file-only and would never fire for a directory).
    await Bun.$`rm -rf ${downloadDir}`.quiet();
  }
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
  const builtMetadata = await readManifestMetadata(manifestPath);
  const manifestVersion = builtMetadata.version;

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
    // Idempotence gate: the static pipeline runs this step on EVERY main
    // build (the old CI's change detection is gone), so without this check
    // each build cuts a new patch release whose commit-back PR triggers the
    // next build — an infinite release loop (1.0.45→46→47 on 2026-07-16,
    // all byte-identical). The build is deterministic (verified: consecutive
    // releases' assets are byte-identical), so skip when the built artifacts
    // match the latest release's.
    const matchedTag = await matchingLatestReleaseTag(pkgRoot, pluginRepo, env);
    if (matchedTag !== null) {
      // The publish lane runs under the pipeline's shared retry anchor. A
      // retryable interruption AFTER the release is cut but BEFORE the
      // monorepo manifest commit-back lands would, on retry, hit this gate and
      // return — leaving the manifest permanently stale. So resume the
      // commit-back for the published tag before returning. Only act when the
      // manifest is actually behind (the common case is in sync, and this
      // avoids cloning the monorepo on every no-op build); cooklangCommitBack
      // is itself idempotent (no push / no PR when nothing differs).
      if (manifestVersion === matchedTag) {
        console.log(
          `--- built plugin is byte-identical to the latest release ${matchedTag} and the manifest already tracks it; nothing to publish`,
        );
        return;
      }
      console.log(
        `--- built plugin matches release ${matchedTag} but the monorepo manifest is at ${manifestVersion}; resuming the commit-back`,
      );
      await cooklangCommitBack(matchedTag, builtMetadata.minAppVersion, env);
      console.log(
        `--- resumed cooklang commit-back to v${matchedTag}; nothing new to publish`,
      );
      return;
    }

    const newVersion = await computeNextVersion(
      pluginRepo,
      manifestVersion,
      env,
    );
    console.log(`cooklang plugin: ${manifestVersion} -> ${newVersion}`);

    // 2. Rewrite the built manifest with the new version, then publish to the
    //    plugin repo. Clone the plugin repo, copy artifacts, commit + push,
    //    update versions.json on a compatibility-boundary change, cut a release.
    const manifest = builtMetadata.data;
    manifest["version"] = newVersion;
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const minAppVersion = builtMetadata.minAppVersion;

    const cloneDir = `${tmpBase()}/cooklang-plugin-${Date.now().toString()}`;
    try {
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
        "versions.json",
        newVersion,
        minAppVersion,
        env,
        cloneDir,
      );

      await pluginGit(["add", "main.js", "manifest.json", "styles.css"]);
      const artifactDiff = await runAllowExit(
        ["git", "-C", cloneDir, "diff", "--cached", "--quiet"],
        { env },
      );
      if (artifactDiff.exitCode === 1) {
        await pluginGit([
          "commit",
          "-m",
          `release: v${newVersion}`,
          "-m",
          "Auto-Generated: ci-bot",
        ]);
        await pluginGit(["push", "origin", "HEAD:main"]);
      } else if (artifactDiff.exitCode !== 0) {
        throw new Error(`git diff failed: ${artifactDiff.stderr}`);
      }

      // Cut the GitHub release. Querying the latest tag keeps "no release"
      // distinct from an authentication/network failure: `run` propagates the
      // latter instead of treating every nonzero `gh release view` as absent.
      const latestRelease = await run(
        [
          "gh",
          "release",
          "list",
          "--repo",
          pluginRepo,
          "--limit",
          "1",
          "--json",
          "tagName",
          "--jq",
          '.[0].tagName // ""',
        ],
        { env, capture: true },
      );
      if (latestRelease.stdout.trim() !== newVersion) {
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
    } finally {
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
export async function updateVersionsJson(
  versionsPath: string,
  versionsRel: string,
  newVersion: string,
  minAppVersion: string,
  env: Record<string, string>,
  gitDir: string,
): Promise<void> {
  const file = Bun.file(versionsPath);
  if (!(await file.exists())) {
    throw new Error(`${versionsPath} does not exist`);
  }
  const raw = asRecord(await file.json());
  if (raw === null) {
    throw new Error(`${versionsPath} is not a JSON object`);
  }
  const versions: Record<string, string> = {};
  for (const [version, minimumAppVersion] of Object.entries(raw)) {
    if (
      !SEMVER_PATTERN.test(version) ||
      typeof minimumAppVersion !== "string" ||
      !SEMVER_PATTERN.test(minimumAppVersion)
    ) {
      throw new Error(
        `${versionsPath} must map semantic versions to semantic versions`,
      );
    }
    versions[version] = minimumAppVersion;
  }
  const sortedKeys = Object.keys(versions).sort((a, b) => compareSemver(a, b));
  const latestKey = sortedKeys[sortedKeys.length - 1];
  const latestMin = latestKey === undefined ? "" : versions[latestKey];

  if (latestMin === "" || latestMin !== minAppVersion) {
    versions[newVersion] = minAppVersion;
    await Bun.write(versionsPath, JSON.stringify(versions, null, 2) + "\n");
    await run(["git", "-C", gitDir, "add", versionsRel], { env });
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

    const branchLookup = await runAllowExit(
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
    );
    if (branchLookup.exitCode !== 0 && branchLookup.exitCode !== 2) {
      throw new Error(
        `could not inspect cooklang bump branch: ${branchLookup.stderr}`,
      );
    }
    const branchExists = branchLookup.exitCode === 0;

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
      versionsRel,
      version,
      minAppVersion,
      env,
      cloneDir,
    );
    await git(["add", manifestRel]);

    const stagedDiff = await runAllowExit(
      ["git", "-C", cloneDir, "diff", "--cached", "--quiet"],
      { env },
    );
    if (stagedDiff.exitCode !== 0 && stagedDiff.exitCode !== 1) {
      throw new Error(`could not inspect cooklang staged diff`);
    }
    const noChange = stagedDiff.exitCode === 0;
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
      const branchDiff = await runAllowExit(
        ["git", "-C", cloneDir, "diff", "--quiet", "origin/main...HEAD"],
        { env },
      );
      if (branchDiff.exitCode !== 0 && branchDiff.exitCode !== 1) {
        throw new Error("could not inspect cooklang pending branch diff");
      }
      const noBranchDiff = branchDiff.exitCode === 0;
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
    // GitHub refuses to enable auto-merge on a draft PR, and this may reuse
    // a pre-existing open PR for the branch that someone left as a draft
    // (build 5636). Mark it ready first.
    const draftState = await run(
      [
        "gh",
        "pr",
        "view",
        "--repo",
        MONOREPO_REPO,
        prNumber,
        "--json",
        "isDraft",
        "-q",
        ".isDraft",
      ],
      { env, capture: true },
    );
    if (draftState.stdout.trim() === "true") {
      await run(["gh", "pr", "ready", "--repo", MONOREPO_REPO, prNumber], {
        env,
      });
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
    await rm(cloneDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await main();
}
