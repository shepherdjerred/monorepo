/**
 * Git-diff based change detection with failed-build retry.
 *
 * Determines which packages changed and need to be built.
 */
import {
  ALL_PACKAGES,
  PACKAGES_WITH_IMAGES,
  PACKAGES_WITH_NPM,
  PACKAGE_TO_SITE,
} from "./catalog.ts";
import type { AffectedPackages } from "./lib/types.ts";
import { execSync } from "node:child_process";

/** Repo root — needed because the pipeline generator may run from scripts/ci/. */
const REPO_ROOT = execSync("git rev-parse --show-toplevel", {
  encoding: "utf-8",
}).trim();

/** Minimum number of dagger steps a build must have to qualify as "fully tested". */
const MIN_GREEN_STEPS = 40;

/** Files that, if changed, trigger a full build. */
const INFRA_FILES = new Set([
  "bun.lock",
  "package.json",
  "tsconfig.json",
  "tsconfig.base.json",
]);

/** Directory prefixes that, if any file under them changes, trigger a full build. */
const INFRA_DIRS = [".buildkite/", ".dagger/", "scripts/ci/"];

// ---------------------------------------------------------------------------
// Version commit-back fast-track
// ---------------------------------------------------------------------------

/** Check if the current build is a version commit-back merge (auto-generated). */
function isVersionCommitBack(): boolean {
  const msg = process.env["BUILDKITE_MESSAGE"] ?? "";
  return msg.startsWith("chore: bump image versions to ");
}

// ---------------------------------------------------------------------------
// Release-please merge detection
// ---------------------------------------------------------------------------

/** Check if the current build is a release-please merge commit. */
export function isReleasePleaseMerge(): boolean {
  const msg = process.env["BUILDKITE_MESSAGE"] ?? "";
  return msg === "chore: release main";
}

// ---------------------------------------------------------------------------
// Renovate fast-track
// ---------------------------------------------------------------------------

/**
 * Packages that are NOT JavaScript/TypeScript — excluded from the "all-js"
 * Renovate classification (root package.json changes).
 */
const NON_JS_PACKAGES = new Set([
  "castle-casters", // Java
  "clauderon", // Rust
  "terraform-provider-asuswrt", // Go
  "resume", // LaTeX
]);

/** All JS/TS workspace packages (ALL_PACKAGES minus non-JS). */
const JS_TS_PACKAGES = ALL_PACKAGES.filter((p) => !NON_JS_PACKAGES.has(p));

/** Check if the current build is a Renovate pull request. */
function isRenovatePr(): boolean {
  const email = process.env["BUILDKITE_BUILD_AUTHOR_EMAIL"] ?? "";
  const pr = process.env["BUILDKITE_PULL_REQUEST"] ?? "false";
  return email.includes("renovate[bot]") && pr !== "false";
}

type RenovateClassification =
  | { kind: "noop" }
  | { kind: "scoped"; packages: Set<string> }
  | { kind: "all-js" }
  | null;

/**
 * Classify changed files in a Renovate PR.
 * Returns null if any file doesn't match a known Renovate pattern
 * (falls through to normal detection).
 *
 * Priority: null > all-js > scoped > noop
 */
function classifyRenovateFiles(changedFiles: string[]): RenovateClassification {
  let level: "noop" | "scoped" | "all-js" = "noop";
  const scopedPackages = new Set<string>();

  for (const f of changedFiles) {
    // Version files — pure string value changes, nothing to test
    if (f.endsWith("/versions.ts") || f.endsWith("/lib-versions.ts")) {
      continue; // stays at current level (noop or higher)
    }

    // Per-package manifest, lockfile, or Dockerfile
    if (f.startsWith("packages/")) {
      const rest = f.slice("packages/".length);
      const pkg = rest.split("/")[0];
      if (!pkg) return null;

      const relPath = rest.slice(pkg.length + 1);
      if (
        relPath === "package.json" ||
        relPath === "bun.lock" ||
        relPath === "package-lock.json" ||
        relPath === "Dockerfile"
      ) {
        scopedPackages.add(pkg);
        if (level === "noop") level = "scoped";
        continue;
      }

      // Unknown file under packages/ — not a recognized Renovate pattern
      return null;
    }

    // Root bun.lock — derivative of manifest changes, ignore
    if (f === "bun.lock") {
      continue;
    }

    // Root package.json — affects all JS/TS packages
    if (f === "package.json") {
      level = "all-js";
      continue;
    }

    // CI tool versions — string value bumps, nothing to test
    if (f === ".buildkite/scripts/setup-tools.sh") {
      continue;
    }

    // CI base image — string value bumps, nothing to test
    if (f.startsWith(".buildkite/ci-image/")) {
      continue;
    }

    // Anything else is unrecognized — fall through to normal detection
    return null;
  }

  if (level === "all-js") return { kind: "all-js" };
  if (level === "scoped") return { kind: "scoped", packages: scopedPackages };
  return { kind: "noop" };
}

// ---------------------------------------------------------------------------
// Buildkite API: find last green build
// ---------------------------------------------------------------------------

async function getLastGreenCommit(): Promise<string | null> {
  const token =
    process.env["BUILDKITE_API_TOKEN"] ??
    process.env["BUILDKITE_AGENT_ACCESS_TOKEN"];
  if (!token) {
    console.error(
      "⚠️  No Buildkite API token — will fall back to full build on main",
    );
    return null;
  }

  const org = process.env["BUILDKITE_ORGANIZATION_SLUG"] ?? "";
  const pipeline = process.env["BUILDKITE_PIPELINE_SLUG"] ?? "";
  const currentBuild = process.env["BUILDKITE_BUILD_NUMBER"] ?? "";

  if (!org || !pipeline) {
    console.error(
      "⚠️  Missing org/pipeline slug — will fall back to full build on main",
    );
    return null;
  }

  const url =
    `https://api.buildkite.com/v2/organizations/${org}` +
    `/pipelines/${pipeline}/builds` +
    `?branch=main&state=passed&per_page=10`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (resp.status === 401) {
      console.error(
        "⚠️  Buildkite API 401: token lacks REST API permissions — will fall back to full build on main",
      );
      return null;
    }

    if (!resp.ok) {
      console.error(
        `⚠️  Buildkite API failed (HTTP ${resp.status}) — will fall back to full build on main`,
      );
      return null;
    }

    const builds = (await resp.json()) as Array<{
      number?: number;
      commit?: string;
      jobs?: Array<{ name?: string }>;
    }>;

    for (const build of builds) {
      if (String(build.number) === currentBuild) continue;

      const jobs = build.jobs ?? [];
      const daggerJobs = jobs.filter((j) =>
        (j.name ?? "").includes(":dagger_knife:"),
      );

      if (daggerJobs.length >= MIN_GREEN_STEPS) {
        const commit = build.commit ?? "";
        console.error(
          `Last green build: #${build.number} (${daggerJobs.length} dagger jobs, commit ${commit.slice(0, 10)})`,
        );
        return commit;
      }

      console.error(
        `Build #${build.number} skipped: only ${daggerJobs.length} dagger jobs (need ${MIN_GREEN_STEPS})`,
      );
    }
  } catch (e) {
    console.error(
      `⚠️  Buildkite API request failed: ${e} — will fall back to full build on main`,
    );
    return null;
  }

  console.error(
    "⚠️  No qualifying green build found in last 10 builds — will fall back to full build on main",
  );
  return null;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function exec(
  cmd: string[],
): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), exitCode };
}

async function getBaseRevision(): Promise<string | null> {
  const branch = process.env["BUILDKITE_BRANCH"] ?? "";
  const pullRequest = process.env["BUILDKITE_PULL_REQUEST"] ?? "false";

  if (pullRequest && pullRequest !== "false") {
    const result = await exec(["git", "merge-base", "HEAD", "origin/main"]);
    return result.exitCode === 0 ? result.stdout : null;
  }

  if (branch === "main") {
    return getLastGreenCommit();
  }

  // Feature branch without PR
  const result = await exec(["git", "merge-base", "HEAD", "origin/main"]);
  return result.exitCode === 0 ? result.stdout : null;
}

async function getChangedFiles(): Promise<string[] | null> {
  const base = await getBaseRevision();
  if (base === null) return null;

  const result = await exec(["git", "diff", "--name-only", base, "HEAD"]);
  if (result.exitCode !== 0) return null;

  return result.stdout
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

/** Paths under INFRA_DIRS that should NOT trigger a full build. */
const INFRA_DIR_EXCLUSIONS = [".buildkite/ci-image/"];

function checkInfraChanges(changedFiles: string[]): boolean {
  for (const f of changedFiles) {
    if (INFRA_FILES.has(f)) {
      console.error(`Infrastructure file changed: ${f}`);
      return true;
    }
    for (const d of INFRA_DIRS) {
      if (f.startsWith(d)) {
        if (INFRA_DIR_EXCLUSIONS.some((ex) => f.startsWith(ex))) continue;
        console.error(`Infrastructure dir changed: ${f}`);
        return true;
      }
    }
  }
  return false;
}

function checkCiImageChanges(changedFiles: string[]): boolean {
  for (const f of changedFiles) {
    if (f.startsWith(".buildkite/ci-image/")) {
      console.error(`CI image changed: ${f}`);
      return true;
    }
  }
  return false;
}

function extractPackageName(filePath: string): string | null {
  if (!filePath.startsWith("packages/")) return null;
  const rest = filePath.slice("packages/".length);
  const parts = rest.split("/");
  return parts[0] ?? null;
}

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

async function readWorkspaceDeps(): Promise<Map<string, Set<string>>> {
  const deps = new Map<string, Set<string>>();
  for (const pkg of ALL_PACKAGES) {
    try {
      const file = Bun.file(`${REPO_ROOT}/packages/${pkg}/package.json`);
      const json = (await file.json()) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = {
        ...json.dependencies,
        ...json.devDependencies,
      };
      const workspaceDeps = new Set<string>();
      for (const [name, version] of Object.entries(allDeps)) {
        if (
          typeof version === "string" &&
          (version.startsWith("workspace:") || version.startsWith("file:"))
        ) {
          // Extract the package directory name from the scoped name
          const dirName = name.startsWith("@")
            ? (name.split("/")[1] ?? name)
            : name;
          workspaceDeps.add(dirName);
        }
      }
      deps.set(pkg, workspaceDeps);
    } catch (e) {
      // Non-JS packages (Rust, Go, Java, docs, etc.) don't have package.json
      // — they have no workspace deps, which is correct.
      const isFileNotFound =
        e instanceof Error && e.message.includes("no such file");
      if (isFileNotFound) {
        deps.set(pkg, new Set());
      } else {
        throw new Error(
          `Failed to read workspace deps for ${pkg}: ${e}. Fix the package.json or remove from ALL_PACKAGES.`,
        );
      }
    }
  }
  return deps;
}

function transitiveClosure(
  changed: Set<string>,
  deps: Map<string, Set<string>>,
): Set<string> {
  // Build reverse dep map: if A depends on B, then B -> A
  const reverseDeps = new Map<string, Set<string>>();
  for (const [pkg, pkgDeps] of deps) {
    for (const dep of pkgDeps) {
      let set = reverseDeps.get(dep);
      if (!set) {
        set = new Set();
        reverseDeps.set(dep, set);
      }
      set.add(pkg);
    }
  }

  const result = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const dependents = reverseDeps.get(current);
    if (dependents) {
      for (const dep of dependents) {
        if (!result.has(dep)) {
          result.add(dep);
          queue.push(dep);
        }
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

function fullBuildResult(): AffectedPackages {
  return {
    packages: new Set(ALL_PACKAGES),
    buildAll: true,
    homelabChanged: true,
    clauderonChanged: true,
    cooklangChanged: true,
    castleCastersChanged: true,
    resumeChanged: true,
    ciImageChanged: true,
    hasImagePackages: new Set(PACKAGES_WITH_IMAGES),
    hasSitePackages: new Set(Object.keys(PACKAGE_TO_SITE)),
    hasNpmPackages: new Set(PACKAGES_WITH_NPM),
    versionBumpOnly: false,
    releasePleaseMerge: isReleasePleaseMerge(),
  };
}

function emptyResult(): AffectedPackages {
  return {
    packages: new Set(),
    buildAll: false,
    homelabChanged: false,
    clauderonChanged: false,
    cooklangChanged: false,
    castleCastersChanged: false,
    resumeChanged: false,
    ciImageChanged: false,
    hasImagePackages: new Set(),
    hasSitePackages: new Set(),
    hasNpmPackages: new Set(),
    versionBumpOnly: false,
    releasePleaseMerge: isReleasePleaseMerge(),
  };
}

function buildScopedResult(
  allAffected: Set<string>,
  ciImageChanged: boolean,
): AffectedPackages {
  const hasImagePackages = new Set<string>();
  const hasSitePackages = new Set<string>();
  const hasNpmPackages = new Set<string>();
  for (const pkg of allAffected) {
    if (PACKAGES_WITH_IMAGES.has(pkg)) {
      hasImagePackages.add(pkg);
    }
    if (pkg in PACKAGE_TO_SITE) {
      hasSitePackages.add(pkg);
    }
    if (PACKAGES_WITH_NPM.has(pkg)) {
      hasNpmPackages.add(pkg);
    }
  }

  return {
    packages: allAffected,
    buildAll: false,
    homelabChanged: allAffected.has("homelab"),
    clauderonChanged: allAffected.has("clauderon"),
    cooklangChanged:
      allAffected.has("cooklang-rich-preview") ||
      allAffected.has("cooklang-for-obsidian"),
    castleCastersChanged: allAffected.has("castle-casters"),
    resumeChanged: allAffected.has("resume"),
    ciImageChanged,
    hasImagePackages,
    hasSitePackages,
    hasNpmPackages,
    versionBumpOnly: false,
    releasePleaseMerge: isReleasePleaseMerge(),
  };
}

// ---------------------------------------------------------------------------
// Main detection
// ---------------------------------------------------------------------------

export async function detectChanges(): Promise<AffectedPackages> {
  const forceFullEnv =
    (process.env["FULL_BUILD"] ?? "").toLowerCase() === "true";
  const commitMsg = process.env["BUILDKITE_MESSAGE"] ?? "";
  const forceFull = forceFullEnv || commitMsg.includes("[full-build]");

  const changedFiles = await getChangedFiles();

  if (forceFull || changedFiles === null) {
    const reason = forceFull
      ? "Full build requested"
      : "No base revision available";
    console.error(`${reason}, building everything`);
    return fullBuildResult();
  }

  // Renovate fast-track: runs BEFORE infra check so that bun.lock/package.json
  // in INFRA_FILES don't short-circuit the fast path.
  if (isRenovatePr()) {
    const classification = classifyRenovateFiles(changedFiles);
    if (classification !== null) {
      console.error(`Renovate fast-track: ${classification.kind}`);

      if (classification.kind === "noop") {
        console.error("Renovate: no builds needed");
        return emptyResult();
      }

      // Seed directly-changed packages from classification, then fall through
      // to transitive closure + flag derivation below.
      const directlyChanged = new Set<string>();
      if (classification.kind === "scoped") {
        for (const pkg of classification.packages) {
          if (ALL_PACKAGES.includes(pkg)) {
            directlyChanged.add(pkg);
          }
        }
      } else {
        // all-js
        for (const pkg of JS_TS_PACKAGES) {
          directlyChanged.add(pkg);
        }
      }

      const depGraph = await readWorkspaceDeps();
      const allAffected = transitiveClosure(directlyChanged, depGraph);

      console.error(`Renovate affected packages (${allAffected.size}):`);
      for (const p of [...allAffected].sort()) {
        console.error(`  ${p}`);
      }

      return buildScopedResult(allAffected, false);
    }

    // classification === null: unrecognized files, fall through to normal detection
    console.error(
      "Renovate PR with unrecognized files, using normal detection",
    );
  }

  // Version commit-back fast-track: prevents infinite loop where
  // version-commit-back → merge → build → images → version-commit-back.
  // The new digests still need to flow through cdk8s synth → Helm push → ArgoCD,
  // but image builds and another version-commit-back must be skipped.
  if (isVersionCommitBack()) {
    const classification = classifyRenovateFiles(changedFiles);
    if (classification !== null && classification.kind === "noop") {
      console.error(
        "Version commit-back: skipping image builds, running deploy pipeline",
      );
      const result = buildScopedResult(new Set(["homelab"]), false);
      result.versionBumpOnly = true;
      return result;
    }
    console.error(
      "Version commit-back with non-trivial changes, using normal detection",
    );
  }

  // Normal detection: check infrastructure files
  const infraChanged = checkInfraChanges(changedFiles);
  if (infraChanged) {
    console.error("Infrastructure files changed, building everything");
    return fullBuildResult();
  }

  // Map changed files to packages
  const directlyChanged = new Set<string>();
  for (const f of changedFiles) {
    const pkg = extractPackageName(f);
    if (pkg !== null && ALL_PACKAGES.includes(pkg)) {
      directlyChanged.add(pkg);
    }
  }

  const ciImageChanged = checkCiImageChanges(changedFiles);

  if (directlyChanged.size === 0 && !ciImageChanged) {
    console.error("No affected packages detected");
    return emptyResult();
  }

  // Compute transitive closure via workspace dependency graph
  const depGraph = await readWorkspaceDeps();
  const allAffected = transitiveClosure(directlyChanged, depGraph);

  console.error(`Affected packages (${allAffected.size}):`);
  for (const p of [...allAffected].sort()) {
    console.error(`  ${p}`);
  }

  return buildScopedResult(allAffected, ciImageChanged);
}

// Export for testing
export {
  checkInfraChanges as _checkInfraChanges,
  extractPackageName as _extractPackageName,
  transitiveClosure as _transitiveClosure,
  isRenovatePr as _isRenovatePr,
  isVersionCommitBack as _isVersionCommitBack,
  isReleasePleaseMerge as _isReleasePleaseMerge,
  classifyRenovateFiles as _classifyRenovateFiles,
  NON_JS_PACKAGES as _NON_JS_PACKAGES,
  JS_TS_PACKAGES as _JS_TS_PACKAGES,
};
