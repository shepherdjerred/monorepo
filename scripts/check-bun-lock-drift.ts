#!/usr/bin/env bun

/**
 * Per-package `bun.lock` drift checker — prevents the class of regression
 * where a Renovate PR updates one workspace's `package.json` + `bun.lock` but
 * leaves a dependent's per-package `bun.lock` stale because the dependent
 * pulls the upstream via a `file:` link.
 *
 * Example post-mortem: PR #1213 bumped `@anthropic-ai/sdk` to `0.96.0` in
 * `llm-observability`'s `package.json` (+ regenerated its `bun.lock`), but did
 * NOT regenerate `packages/discord-plays-pokemon/bun.lock` — dpp's lockfile
 * still resolved to `0.95.2` because dpp depends on `llm-observability` via
 * `file:../llm-observability`. The drift didn't surface until the next PR
 * (#1214 protobufjs) hit dpp's `bun install --frozen-lockfile` in CI, where it
 * blocked Lint / Typecheck / Test and looked like a protobufjs problem.
 *
 * The check runs `bun install --frozen-lockfile --dry-run` (resolve-only, no
 * download/link of the dep tree) per package. Each invocation costs tens of
 * milliseconds against a warm bun cache, so the gate is effectively free on
 * most PRs and runs in seconds on Renovate PRs that fan out across the file:
 * dep graph.
 *
 * Modes:
 *   --packages a,b,c   Check only these packages. Used in CI: the pipeline
 *                      generator already computed the affected-packages
 *                      closure via change-detection.ts and passes it here.
 *   --base <ref>       Local mode. Diff `packages/<X>/package.json` and
 *                      `packages/<X>/bun.lock` vs `<ref>`, walk the reverse
 *                      `file:`-dep closure (read from each
 *                      `packages/<X>/package.json`), then dry-run-check the
 *                      closure. Default `origin/main`.
 *   --all              Sweep every `packages/<X>/bun.lock`. Debug / nightly.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { Glob } from "bun";

const PACKAGES_DIR = "packages";

interface Args {
  mode: "packages" | "base" | "all";
  packages: string[];
  base: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: "all", packages: [], base: "origin/main" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--packages") {
      const list = argv[++i] ?? "";
      args.packages = list
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      args.mode = "packages";
    } else if (a === "--base") {
      args.base = argv[++i] ?? "origin/main";
      args.mode = "base";
    } else if (a === "--all") {
      args.mode = "all";
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun scripts/check-bun-lock-drift.ts [--packages a,b,c | --base <ref> | --all]",
      );
      process.exit(0);
    }
  }
  return args;
}

async function listPackagesWithLock(): Promise<string[]> {
  const glob = new Glob(`${PACKAGES_DIR}/*/bun.lock`);
  const out: string[] = [];
  for await (const path of glob.scan({ dot: false })) {
    const pkg = path.split("/")[1];
    if (pkg !== undefined) out.push(pkg);
  }
  return out.sort();
}

interface PartialManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

function collectFileDeps(manifest: PartialManifest, into: Set<string>): void {
  const all: Record<string, string> = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  for (const [name, spec] of Object.entries(all)) {
    if (typeof spec !== "string") continue;
    if (!spec.startsWith("file:") && !spec.startsWith("workspace:")) continue;
    // `@scope/pkg` → `pkg` (the workspace-dir name); unscoped names pass through.
    const dir = name.startsWith("@") ? (name.split("/")[1] ?? name) : name;
    into.add(dir);
  }
}

function workspacePaths(manifest: PartialManifest): string[] {
  const ws = manifest.workspaces;
  if (Array.isArray(ws)) return ws;
  if (ws !== undefined && Array.isArray(ws.packages)) return ws.packages;
  return [];
}

/**
 * Read `file:`/`workspace:` deps for each top-level package, **including
 * deps declared in nested workspaces**. The drift case that motivated this
 * gate (PR #1213's discord-plays-pokemon miss) lives at
 * `packages/discord-plays-pokemon/packages/backend/package.json` — the
 * top-level manifest only declares `eslint-config`, so a naïve direct-read
 * misses the `llm-observability` edge. We aggregate across nested workspaces
 * so the reverse-dep closure sees every actual `file:` edge that the
 * top-level `bun.lock` resolves.
 */
async function readWorkspaceDeps(
  packages: string[],
): Promise<Map<string, Set<string>>> {
  const deps = new Map<string, Set<string>>();
  for (const pkg of packages) {
    const aggregated = new Set<string>();
    const topPath = `${PACKAGES_DIR}/${pkg}/package.json`;
    if (!existsSync(topPath)) {
      deps.set(pkg, aggregated);
      continue;
    }
    const top = (await Bun.file(topPath).json()) as PartialManifest;
    collectFileDeps(top, aggregated);
    for (const wsPath of workspacePaths(top)) {
      // `workspaces` entries can be glob patterns (e.g. `packages/*`). Expand
      // and read every matching `package.json` so a nested manifest's
      // `file:` deps are attributed to the top-level package.
      const glob = new Glob(`${PACKAGES_DIR}/${pkg}/${wsPath}/package.json`);
      for await (const subPath of glob.scan({ dot: false })) {
        const sub = (await Bun.file(subPath).json()) as PartialManifest;
        collectFileDeps(sub, aggregated);
      }
    }
    deps.set(pkg, aggregated);
  }
  return deps;
}

/**
 * Seeds plus every package that transitively depends on a seed via the
 * `file:`/`workspace:` graph. This is the set whose `bun.lock` could plausibly
 * have drifted because of an upstream `package.json` change.
 */
function reverseClosure(
  seeds: Set<string>,
  deps: Map<string, Set<string>>,
): Set<string> {
  const reverse = new Map<string, Set<string>>();
  for (const [pkg, pkgDeps] of deps) {
    for (const d of pkgDeps) {
      let set = reverse.get(d);
      if (set === undefined) {
        set = new Set();
        reverse.set(d, set);
      }
      set.add(pkg);
    }
  }
  const result = new Set(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const cur = queue.pop();
    if (cur === undefined) break;
    const dependents = reverse.get(cur);
    if (dependents === undefined) continue;
    for (const dep of dependents) {
      if (!result.has(dep)) {
        result.add(dep);
        queue.push(dep);
      }
    }
  }
  return result;
}

function diffTouchedPackages(base: string): Set<string> {
  const out = execSync(`git diff --name-only ${base}...HEAD`, {
    encoding: "utf-8",
  });
  const touched = new Set<string>();
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    const match = /^packages\/([^/]+)\/(package\.json|bun\.lock)$/.exec(line);
    if (match && match[1] !== undefined) touched.add(match[1]);
  }
  return touched;
}

interface Violation {
  pkg: string;
  output: string;
}

async function dryRunPackage(pkg: string): Promise<Violation | null> {
  const cwd = resolve(`${PACKAGES_DIR}/${pkg}`);
  if (!existsSync(`${cwd}/bun.lock`)) return null;
  const proc = Bun.spawn(["bun", "install", "--frozen-lockfile", "--dry-run"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code === 0) return null;
  const output = (stderr.trim().length > 0 ? stderr : stdout).trim();
  return { pkg, output };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let toCheck: string[];
  if (args.mode === "all") {
    toCheck = await listPackagesWithLock();
  } else if (args.mode === "packages") {
    toCheck = args.packages;
  } else {
    const all = await listPackagesWithLock();
    const seeds = diffTouchedPackages(args.base);
    if (seeds.size === 0) {
      console.log(
        `No packages/*/{package.json,bun.lock} changes against ${args.base}.`,
      );
      return;
    }
    const deps = await readWorkspaceDeps(all);
    const closure = reverseClosure(seeds, deps);
    toCheck = [...closure].sort();
    console.error(
      `Touched: ${[...seeds].sort().join(", ")} → closure (${String(toCheck.length)}): ${toCheck.join(", ")}`,
    );
  }

  if (toCheck.length === 0) {
    console.log("No packages to check.");
    return;
  }

  const results = await Promise.all(toCheck.map(dryRunPackage));
  const violations = results.filter((v): v is Violation => v !== null);

  if (violations.length > 0) {
    console.error(
      `\nbun.lock drift detected in ${String(violations.length)} of ${String(toCheck.length)} package(s):\n`,
    );
    for (const v of violations) {
      console.error(`  packages/${v.pkg}/bun.lock`);
      for (const line of v.output.split("\n")) {
        if (line.trim().length > 0) console.error(`    ${line}`);
      }
      console.error(
        `    fix: (cd packages/${v.pkg} && bun install) && git add packages/${v.pkg}/bun.lock\n`,
      );
    }
    process.exit(1);
  }

  console.log(
    `No bun.lock drift (${String(toCheck.length)} package(s) checked).`,
  );
}

await main();
