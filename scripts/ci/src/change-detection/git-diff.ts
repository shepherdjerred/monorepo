/**
 * Git-diff plumbing and the workspace dependency graph.
 *
 * Resolves the base revision to diff against (PR merge-base, last successful
 * main build, or feature-branch merge-base), lists changed files, reads the
 * workspace dependency graph, and expands a directly-changed package set to its
 * transitive dependents.
 */
import { z } from "zod";
import { ALL_PACKAGES } from "../catalog.ts";
import { getLastSuccessfulCommit } from "./buildkite-queries.ts";
import {
  errorMessage,
  REPO_ROOT,
  type ExecFn,
  type ExecResult,
} from "./shared.ts";

/** Subset of package.json we read for workspace-dependency graphing. */
const PackageJsonDepsSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

async function exec(cmd: string[]): Promise<ExecResult> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), exitCode };
}

const ORIGIN_MAIN_REFSPEC = "+refs/heads/main:refs/remotes/origin/main";

async function fetchOriginMain(
  execFn: ExecFn,
  depthArg: string,
): Promise<void> {
  const fetch = await execFn([
    "git",
    "fetch",
    "--no-tags",
    depthArg,
    "origin",
    ORIGIN_MAIN_REFSPEC,
  ]);
  if (fetch.exitCode !== 0) {
    throw new Error("Unable to fetch origin/main for merge-base computation");
  }
}

// Buildkite's checkout uses --depth=100 and only fetches the PR HEAD ref, so
// `origin/main` is often missing as a remote-tracking ref. Fetch it explicitly
// before any merge-base call.
async function ensureOriginMain(execFn: ExecFn): Promise<void> {
  const check = await execFn([
    "git",
    "rev-parse",
    "--verify",
    "--quiet",
    "refs/remotes/origin/main",
  ]);
  if (check.exitCode === 0 && check.stdout !== "") {
    return;
  }
  await fetchOriginMain(execFn, "--depth=100");
}

async function getMergeBaseWithOriginMain(execFn: ExecFn): Promise<string> {
  await ensureOriginMain(execFn);

  const initial = await execFn(["git", "merge-base", "HEAD", "origin/main"]);
  if (initial.exitCode === 0 && initial.stdout !== "") {
    return initial.stdout;
  }

  // The remote-tracking ref can exist while the shallow clone still lacks the
  // common ancestor. Deepen in bounded steps so normal PRs stay cheap while
  // long-lived branches still get a fair retry before failing.
  for (const depthArg of ["--deepen=1000", "--deepen=10000"]) {
    await fetchOriginMain(execFn, depthArg);
    const result = await execFn(["git", "merge-base", "HEAD", "origin/main"]);
    if (result.exitCode === 0 && result.stdout !== "") {
      return result.stdout;
    }
  }

  throw new Error(
    "Unable to compute merge-base with origin/main after deepening shallow history",
  );
}

export async function getBaseRevision(execFn: ExecFn = exec): Promise<string> {
  const branch = Bun.env["BUILDKITE_BRANCH"] ?? "";
  const pullRequest = Bun.env["BUILDKITE_PULL_REQUEST"] ?? "false";

  if (pullRequest && pullRequest !== "false") {
    return getMergeBaseWithOriginMain(execFn);
  }

  if (branch === "main") {
    return getLastSuccessfulCommit();
  }

  // Feature branch without PR
  return getMergeBaseWithOriginMain(execFn);
}

export async function getChangedFiles(
  execFn: ExecFn = exec,
): Promise<string[]> {
  const base = await getBaseRevision(execFn);

  const result = await execFn(["git", "diff", "--name-only", base, "HEAD"]);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to diff base revision ${base} against HEAD`);
  }

  return result.stdout
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

export async function readWorkspaceDeps(): Promise<Map<string, Set<string>>> {
  const deps = new Map<string, Set<string>>();
  for (const pkg of ALL_PACKAGES) {
    try {
      const file = Bun.file(`${REPO_ROOT}/packages/${pkg}/package.json`);
      const json = PackageJsonDepsSchema.parse(await file.json());
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
    } catch (error) {
      // Non-JS packages (Rust, Go, Java, docs, etc.) don't have package.json
      // — they have no workspace deps, which is correct.
      const isFileNotFound =
        error instanceof Error && error.message.includes("no such file");
      if (isFileNotFound) {
        deps.set(pkg, new Set());
      } else {
        throw new Error(
          `Failed to read workspace deps for ${pkg}: ${errorMessage(error)}. Fix the package.json or remove from ALL_PACKAGES.`,
          { cause: error },
        );
      }
    }
  }
  return deps;
}

export function transitiveClosure(
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
  for (
    let current = queue.pop();
    current !== undefined;
    current = queue.pop()
  ) {
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

// Aliases for the test surface (same-file re-declaration exports).
export {
  getBaseRevision as _getBaseRevision,
  getChangedFiles as _getChangedFiles,
  transitiveClosure as _transitiveClosure,
};
