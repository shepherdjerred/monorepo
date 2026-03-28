/**
 * Git-diff based change detection with failed-build retry.
 *
 * Determines which packages changed and need to be built.
 */
import {
  ALL_PACKAGES,
  PACKAGES_WITH_IMAGES,
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

function checkInfraChanges(changedFiles: string[]): boolean {
  for (const f of changedFiles) {
    if (INFRA_FILES.has(f)) {
      console.error(`Infrastructure file changed: ${f}`);
      return true;
    }
    for (const d of INFRA_DIRS) {
      if (f.startsWith(d)) {
        console.error(`Infrastructure dir changed: ${f}`);
        return true;
      }
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
        e instanceof Error && e.message.includes("No such file");
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
// Main detection
// ---------------------------------------------------------------------------

export async function detectChanges(): Promise<AffectedPackages> {
  const forceFullEnv =
    (process.env["FULL_BUILD"] ?? "").toLowerCase() === "true";
  const commitMsg = process.env["BUILDKITE_MESSAGE"] ?? "";
  const forceFull = forceFullEnv || commitMsg.includes("[full-build]");

  const changedFiles = await getChangedFiles();
  const infraChanged =
    changedFiles === null || checkInfraChanges(changedFiles ?? []);

  if (forceFull || changedFiles === null || infraChanged) {
    const reason = forceFull
      ? "Full build requested"
      : changedFiles === null
        ? "No base revision available"
        : "Infrastructure files changed";
    console.error(`${reason}, building everything`);

    return {
      packages: new Set(ALL_PACKAGES),
      buildAll: true,
      homelabChanged: true,
      clauderonChanged: true,
      cooklangChanged: true,
      castleCastersChanged: true,
      resumeChanged: true,
      hasImagePackages: new Set(PACKAGES_WITH_IMAGES),
      hasSitePackages: new Set(Object.keys(PACKAGE_TO_SITE)),
    };
  }

  // Map changed files to packages
  const directlyChanged = new Set<string>();
  for (const f of changedFiles) {
    const pkg = extractPackageName(f);
    if (pkg !== null && ALL_PACKAGES.includes(pkg)) {
      directlyChanged.add(pkg);
    }
  }

  if (directlyChanged.size === 0) {
    console.error("No affected packages detected");
    return {
      packages: new Set(),
      buildAll: false,
      homelabChanged: false,
      clauderonChanged: false,
      cooklangChanged: false,
      castleCastersChanged: false,
      resumeChanged: false,
      hasImagePackages: new Set(),
      hasSitePackages: new Set(),
    };
  }

  // Compute transitive closure via workspace dependency graph
  const depGraph = await readWorkspaceDeps();
  const allAffected = transitiveClosure(directlyChanged, depGraph);

  console.error(`Affected packages (${allAffected.size}):`);
  for (const p of [...allAffected].sort()) {
    console.error(`  ${p}`);
  }

  const hasImagePackages = new Set<string>();
  const hasSitePackages = new Set<string>();
  for (const pkg of allAffected) {
    if (PACKAGES_WITH_IMAGES.has(pkg)) {
      hasImagePackages.add(pkg);
    }
    if (pkg in PACKAGE_TO_SITE) {
      hasSitePackages.add(pkg);
    }
  }

  return {
    packages: allAffected,
    buildAll: false,
    homelabChanged: allAffected.has("homelab"),
    clauderonChanged: allAffected.has("clauderon"),
    cooklangChanged: allAffected.has("cooklang-rich-preview"),
    castleCastersChanged: allAffected.has("castle-casters"),
    resumeChanged: allAffected.has("resume"),
    hasImagePackages,
    hasSitePackages,
  };
}

// Export for testing
export {
  checkInfraChanges as _checkInfraChanges,
  extractPackageName as _extractPackageName,
  transitiveClosure as _transitiveClosure,
};
