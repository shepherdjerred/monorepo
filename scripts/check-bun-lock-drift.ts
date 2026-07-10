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
 *   --seeds a,b,c      Used in CI. Take these directly-changed packages, walk
 *                      the reverse `file:`-dep closure across **nested
 *                      workspaces** (so a `file:` edge declared in e.g.
 *                      `packages/discord-plays-pokemon/packages/backend/package.json`
 *                      is correctly attributed back to `discord-plays-pokemon`),
 *                      then dry-run-check the full closure. This is the
 *                      load-bearing behavior for the gate: the CI change
 *                      detector's transitive closure only reads top-level
 *                      manifests, so it would silently miss the dpp case the
 *                      gate was built to catch. We re-expand here from the
 *                      raw seeds with the nested-aware graph.
 *   --packages a,b,c   Check **exactly** these packages, no closure expansion.
 *                      Debug / advanced use only. CI must not use this mode.
 *   --base <ref>       Local mode. Diff `packages/<X>/package.json` and
 *                      `packages/<X>/bun.lock` vs `<ref>`, walk the same
 *                      nested-aware reverse `file:`-dep closure, then
 *                      dry-run-check it. Default `origin/main`.
 *   --all              Sweep every `packages/<X>/bun.lock`. Debug / nightly.
 */

import { access } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { Glob } from "bun";
import { z } from "zod";

const PACKAGES_DIR = "packages";

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

type Args = {
  mode: "seeds" | "packages" | "base" | "all";
  packages: string[];
  base: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: "all", packages: [], base: "origin/main" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    switch (a) {
      case "--seeds": {
        const list = argv[++i] ?? "";
        args.packages = list
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        args.mode = "seeds";

        break;
      }
      case "--packages": {
        const list = argv[++i] ?? "";
        args.packages = list
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        args.mode = "packages";

        break;
      }
      case "--base": {
        args.base = argv[++i] ?? "origin/main";
        args.mode = "base";

        break;
      }
      case "--all": {
        args.mode = "all";

        break;
      }
      case "--help":
      case "-h": {
        console.log(
          "Usage: bun scripts/check-bun-lock-drift.ts [--seeds a,b,c | --packages a,b,c | --base <ref> | --all]",
        );
        process.exit(0);
      }
      // No default
    }
  }
  return args;
}

async function listPackagesWithLock(): Promise<string[]> {
  const glob = new Glob(`${PACKAGES_DIR}/*/bun.lock`);
  const out: string[] = [];
  for await (const lockPath of glob.scan({ dot: false })) {
    const pkg = lockPath.split("/")[1];
    if (pkg !== undefined) out.push(pkg);
  }
  return out.sort();
}

const PartialManifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  workspaces: z
    .union([
      z.array(z.string()),
      z.object({ packages: z.array(z.string()).optional() }),
    ])
    .optional(),
});
type PartialManifest = z.infer<typeof PartialManifestSchema>;

function collectFileDeps(manifest: PartialManifest, into: Set<string>): void {
  const all: Record<string, string> = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  for (const [name, spec] of Object.entries(all)) {
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
    if (!(await pathExists(topPath))) {
      deps.set(pkg, aggregated);
      continue;
    }
    const top = PartialManifestSchema.parse(await Bun.file(topPath).json());
    collectFileDeps(top, aggregated);
    for (const wsPath of workspacePaths(top)) {
      // `workspaces` entries can be glob patterns (e.g. `packages/*`). Expand
      // and read every matching `package.json` so a nested manifest's
      // `file:` deps are attributed to the top-level package.
      const glob = new Glob(`${PACKAGES_DIR}/${pkg}/${wsPath}/package.json`);
      for await (const subPath of glob.scan({ dot: false })) {
        const sub = PartialManifestSchema.parse(await Bun.file(subPath).json());
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
    encoding: "utf8",
  });
  const touched = new Set<string>();
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    const match = /^packages\/([^/]+)\/(?:package\.json|bun\.lock)$/.exec(line);
    if (match?.[1] !== undefined) touched.add(match[1]);
  }
  return touched;
}

type Violation = {
  pkg: string;
  output: string;
};

async function dryRunPackage(pkg: string): Promise<Violation | null> {
  const cwd = path.resolve(`${PACKAGES_DIR}/${pkg}`);
  if (!(await pathExists(`${cwd}/bun.lock`))) return null;
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
  switch (args.mode) {
    case "all": {
      toCheck = await listPackagesWithLock();

      break;
    }
    case "packages": {
      toCheck = args.packages;

      break;
    }
    case "seeds": {
      if (args.packages.length === 0) {
        console.log("No seed packages provided; nothing to check.");
        return;
      }
      const all = await listPackagesWithLock();
      const deps = await readWorkspaceDeps(all);
      const closure = reverseClosure(new Set(args.packages), deps);
      toCheck = [...closure].sort();
      console.error(
        `Seeds: ${[...args.packages].sort().join(", ")} → closure (${String(toCheck.length)}): ${toCheck.join(", ")}`,
      );

      break;
    }
    case "base": {
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
  }

  if (toCheck.length === 0) {
    console.log("No packages to check.");
    return;
  }

  const results = await Promise.all(toCheck.map((pkg) => dryRunPackage(pkg)));
  const violations = results.filter((v) => v !== null);

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
