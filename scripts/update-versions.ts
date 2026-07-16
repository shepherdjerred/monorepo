#!/usr/bin/env bun
/**
 * Update image version+digest entries in versions.ts, then open (or refresh) an
 * auto-merge PR with the bump.
 *
 * Ports two old pieces:
 *  - `.buildkite/scripts/update-versions.ts` — the in-place source rewrite that
 *    replaces `"key": "value"` with `"key": "version@sha256:digest"` (same-line
 *    and multi-line entry forms, with the /beta-suffix handling).
 *  - `versionCommitBackHelper` (.dagger/src/release.ts) — clone monorepo on a
 *    pending branch, run the rewrite, commit, push, and open a `--auto --squash`
 *    PR authed by GitHub App creds.
 *
 * Two modes:
 *   Local rewrite only (no git):
 *     bun scripts/update-versions.ts <versions-file> <version> [key=digest ...]
 *   Commit-back (clone + PR):
 *     bun scripts/update-versions.ts --commit-back <version> --digests '<json>' [--dry-run]
 *
 * Env (commit-back): GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID,
 *   GITHUB_APP_PRIVATE_KEY.
 */

import { run, tmpBase } from "./lib/run.ts";
import { setupGitAuth } from "./lib/github-auth.ts";
import { toStringRecord } from "./lib/json.ts";

const MONOREPO_REPO = "shepherdjerred/monorepo";
const MONOREPO_WRITE_URL = `https://github.com/${MONOREPO_REPO}.git`;
const VERSION_BUMP_BRANCH = "chore/version-bump-pending";
const VERSIONS_FILE_REL = "packages/homelab/src/cdk8s/src/versions.ts";

// ---------------------------------------------------------------------------
// In-place versions.ts rewrite (verbatim port of update-versions.ts)
// ---------------------------------------------------------------------------

const escapeRegex = (s: string) =>
  s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
// Matches `"value"` (possibly with trailing comma) as the only content after whitespace on a line.
const VALUE_LINE_RE = /^(\s*)"[^"]*"[ \t]*(?:,[ \t]*)?$/;

/**
 * Rewrite the version+digest string assignments for the given keys in a
 * versions.ts source file. Returns the number of entries updated. Throws when a
 * key matches but the line after it is not a string value (never clobber a
 * closing brace or unrelated code), and when zero entries matched.
 */
export async function rewriteVersionsFile(
  versionsFile: string,
  version: string,
  digests: Map<string, string>,
): Promise<number> {
  if (digests.size === 0) {
    console.log("No digests provided, nothing to update");
    return 0;
  }

  const source = await Bun.file(versionsFile).text();
  const lines = source.split("\n");
  let updated = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    for (const [key, digest] of digests) {
      // Match the key as an exact match OR as a prefix with /beta suffix.
      // versions.ts may have "/beta" suffix for deployment stages.
      const exactMatch: boolean = line.includes(`"${key}"`);
      const betaMatch: boolean = line.includes(`"${key}/beta"`);
      if (!exactMatch && !betaMatch) {
        continue;
      }
      const matchedKey: string = betaMatch ? `${key}/beta` : key;
      const newValue = `${version}@${digest}`;

      // Case 1: same-line entry — `"key": "value",`
      const sameLineRe = new RegExp(
        String.raw`("${escapeRegex(matchedKey)}"\s*:\s*)"[^"]*"(\s*,?)`,
      );
      if (sameLineRe.test(line)) {
        lines[i] = line.replace(sameLineRe, `$1"${newValue}"$2`);
        updated++;
        console.log(`Updated ${matchedKey}: ${newValue}`);
        continue;
      }

      // Case 2: multi-line entry — key on this line, value on the next.
      if (i + 1 >= lines.length) {
        continue;
      }
      const valueLine = lines[i + 1];
      const valueMatch = valueLine?.match(VALUE_LINE_RE);
      if (!valueMatch) {
        throw new Error(
          `Refusing to update ${matchedKey}: line after key is not a ` +
            `string value: ${JSON.stringify(valueLine)}`,
        );
      }
      const indent = valueMatch[1] ?? "";
      lines[i + 1] = `${indent}"${newValue}",`;
      updated++;
      console.log(`Updated ${matchedKey}: ${newValue}`);
    }
  }

  if (updated === 0) {
    throw new Error("No entries matched — check the key names");
  }

  await Bun.write(versionsFile, lines.join("\n"));
  console.log(`Updated ${updated.toString()} entries in ${versionsFile}`);
  return updated;
}

/** Parse `key=digest` argv entries into a Map (skips malformed pairs). */
function parseDigestArgs(entries: string[]): Map<string, string> {
  const digests = new Map<string, string>();
  for (const entry of entries) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }
    const key = entry.slice(0, eqIdx);
    const digest = entry.slice(eqIdx + 1);
    if (key !== "" && digest !== "") {
      digests.set(key, digest);
    }
  }
  return digests;
}

/** Parse the `--digests '<json>'` object into a Map of non-empty string values. */
function parseDigestJson(json: string): Map<string, string> {
  const digests = new Map<string, string>();
  const trimmed = json.trim();
  if (trimmed === "") {
    return digests;
  }
  const parsed: unknown = JSON.parse(trimmed);
  for (const [k, v] of Object.entries(toStringRecord(parsed))) {
    if (v !== "") {
      digests.set(k, v);
    }
  }
  return digests;
}

/** Repo root = one level up from scripts/. */
function repoRoot(): string {
  return new URL("..", import.meta.url).pathname;
}

// ---------------------------------------------------------------------------
// Commit-back (clone + PR), ported from versionCommitBackHelper
// ---------------------------------------------------------------------------

async function commitBack(
  version: string,
  digests: Map<string, string>,
  dryRun: boolean,
): Promise<void> {
  console.log(
    `--- version commit-back: ${version}${dryRun ? " (dry run)" : ""}`,
  );
  if (dryRun) {
    const pairs = [...digests.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    console.log(
      `DRYRUN: would update ${VERSION_BUMP_BRANCH} with version bump ` +
        `${version} and digests: {${pairs}}`,
    );
    return;
  }

  const root = repoRoot();
  const auth = await setupGitAuth(root);
  const env = auth.env;
  const cloneDir = `${tmpBase()}/monorepo-version-bump-${Date.now().toString()}`;

  try {
    await run(["git", "clone", MONOREPO_WRITE_URL, cloneDir], { env });
    const git = (args: string[]) =>
      run(["git", "-C", cloneDir, ...args], { env });
    await git(["config", "user.email", "ci@sjer.red"]);
    await git(["config", "user.name", "CI Bot"]);

    // Reuse the pending branch (rebased onto main) if it exists, else branch fresh.
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
          VERSION_BUMP_BRANCH,
        ],
        { env, capture: true },
      ).catch(() => null)) !== null;

    await git(["fetch", "origin", "main:refs/remotes/origin/main"]);
    if (branchExists) {
      await git([
        "fetch",
        "origin",
        `${VERSION_BUMP_BRANCH}:${VERSION_BUMP_BRANCH}`,
      ]);
      await git(["checkout", VERSION_BUMP_BRANCH]);
      await git(["rebase", "origin/main"]);
    } else {
      await git(["checkout", "-b", VERSION_BUMP_BRANCH, "origin/main"]);
    }

    await rewriteVersionsFile(
      `${cloneDir}/${VERSIONS_FILE_REL}`,
      version,
      digests,
    );
    await git(["add", VERSIONS_FILE_REL]);

    const staged = await run(
      ["git", "-C", cloneDir, "diff", "--cached", "--quiet"],
      { env },
    ).then(
      () => true, // exit 0 = no staged changes
      () => false, // non-zero = changes staged
    );
    let committed = false;
    if (staged) {
      console.log("No version changes to commit");
    } else {
      await git([
        "commit",
        "-m",
        `chore: bump image versions to ${version}`,
        "-m",
        "Auto-Generated: ci-bot",
      ]);
      committed = true;
    }

    // If nothing new committed AND the pending branch has no diff vs main, stop.
    if (!committed) {
      const noBranchDiff = await run(
        ["git", "-C", cloneDir, "diff", "--quiet", "origin/main...HEAD"],
        { env },
      ).then(
        () => true,
        () => false,
      );
      if (noBranchDiff) {
        console.log("No version changes and pending branch has no diff");
        return;
      }
    }

    await git([
      "push",
      "--force-with-lease",
      "-u",
      "origin",
      VERSION_BUMP_BRANCH,
    ]);

    // Find or create the PR, then enable auto-merge (squash).
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
    console.log(`--- opened/updated auto-merge PR #${prNumber}`);
  } finally {
    await auth.cleanup();
    if (await Bun.file(cloneDir).exists()) {
      await Bun.$`rm -rf ${cloneDir}`.quiet();
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  console.error(
    "Usage:\n" +
      "  bun scripts/update-versions.ts <versions-file> <version> [key=digest ...]\n" +
      "  bun scripts/update-versions.ts --commit-back <version> --digests '<json>' [--dry-run]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    usage();
  }

  if (argv.includes("--commit-back")) {
    const dryRun = argv.includes("--dry-run");
    const rest = argv.filter((a) => a !== "--commit-back" && a !== "--dry-run");
    const version = rest.find((a) => !a.startsWith("--"));
    const digestsIdx = rest.indexOf("--digests");
    const digestsJson = digestsIdx === -1 ? "" : (rest[digestsIdx + 1] ?? "");
    if (version === undefined) {
      console.error("commit-back requires a <version>.");
      usage();
    }
    await commitBack(version, parseDigestJson(digestsJson), dryRun);
    return;
  }

  // Local rewrite mode.
  const versionsFile = argv[0];
  const version = argv[1];
  if (versionsFile === undefined || version === undefined) {
    usage();
  }
  await rewriteVersionsFile(
    versionsFile,
    version,
    parseDigestArgs(argv.slice(2)),
  );
}

await main();
