#!/usr/bin/env bun
/**
 * Validate .dagger/src/deps.ts against workspace package.json files.
 *
 * Reads each package's package.json, finds workspace dependencies
 * (file: or workspace: protocol), and checks that deps.ts includes them.
 *
 * Note: deps.ts may include MORE deps than package.json shows (e.g. eslint-config
 * is sometimes an implicit dep from a parent workspace). This script only warns
 * about deps in package.json that are MISSING from deps.ts.
 *
 * Usage:
 *   bun run scripts/generate-deps.ts          # report drift
 *   bun run scripts/generate-deps.ts --check  # exit 1 if missing deps found
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = import.meta.dir + "/..";
const DEPS_FILE = join(ROOT, ".dagger/src/deps.ts");
const PACKAGES_DIR = join(ROOT, "packages");

interface PkgInfo {
  name: string;
  path: string;
  workspaceDeps: string[];
}

/** Recursively find package.json files under packages/ */
async function findPackageJsons(dir: string, depth = 0): Promise<string[]> {
  const results: string[] = [];
  const pkgJson = join(dir, "package.json");
  try {
    await readFile(pkgJson, "utf8");
    results.push(pkgJson);
  } catch {
    // no package.json here
  }

  if (depth < 3) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !["node_modules", "dist", "build", ".git", "target", "archive"].includes(entry.name)
      ) {
        results.push(...(await findPackageJsons(join(dir, entry.name), depth + 1)));
      }
    }
  }
  return results;
}

/** Extract workspace deps from a package.json */
function extractWorkspaceDeps(
  pkg: Record<string, unknown>,
  allPackageNames: Map<string, string>,
): string[] {
  const deps: string[] = [];
  for (const section of ["dependencies", "devDependencies"]) {
    const depsObj = pkg[section];
    if (typeof depsObj !== "object" || depsObj === null) continue;
    for (const [name, version] of Object.entries(depsObj as Record<string, string>)) {
      if (
        typeof version === "string" &&
        (version.startsWith("workspace:") || version.startsWith("file:"))
      ) {
        // Map scoped package name to directory name
        const shortName = name.startsWith("@") ? name.split("/").pop() : name;
        if (shortName && allPackageNames.has(shortName)) {
          deps.push(allPackageNames.get(shortName)!);
        } else if (shortName && allPackageNames.has(name)) {
          deps.push(allPackageNames.get(name)!);
        }
      }
    }
  }
  return [...new Set(deps)].sort();
}

async function main() {
  const checkMode = process.argv.includes("--check");

  // Find all package.json files
  const pkgJsonPaths = await findPackageJsons(PACKAGES_DIR);

  // Build name → relative path map
  const nameToPath = new Map<string, string>();
  const packages: PkgInfo[] = [];

  for (const pkgJsonPath of pkgJsonPaths) {
    const content = JSON.parse(await readFile(pkgJsonPath, "utf8"));
    const relPath = relative(join(ROOT, "packages"), join(pkgJsonPath, ".."));

    // Use the package name (without scope) as the key
    const name: string = content.name ?? relPath;
    const shortName = name.startsWith("@") ? name.split("/").pop()! : name;

    nameToPath.set(shortName, relPath);
    nameToPath.set(name, relPath);
    packages.push({ name: shortName, path: relPath, workspaceDeps: [] });
  }

  // Resolve workspace deps for each package
  for (const pkg of packages) {
    const pkgJsonPath = join(PACKAGES_DIR, pkg.path, "package.json");
    const content = JSON.parse(await readFile(pkgJsonPath, "utf8"));
    pkg.workspaceDeps = extractWorkspaceDeps(content, nameToPath);
  }

  // Read current deps.ts and extract the manually maintained WORKSPACE_DEPS
  const currentContent = await readFile(DEPS_FILE, "utf8");
  // Match both quoted keys ("foo": [...) and unquoted keys (foo: [...)
  const currentKeys = [
    ...currentContent.matchAll(/^\s+(?:"([^"]+)"|(\w[\w/.-]*))\s*:\s*\[/gm),
  ].map((m) => m[1] ?? m[2]);

  // For each key in deps.ts, parse its listed deps
  const currentDeps = new Map<string, string[]>();
  for (const key of currentKeys) {
    const re = new RegExp(
      `(?:"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"|${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*:\\s*\\[([^\\]]*)\\]`,
    );
    const match = currentContent.match(re);
    const deps = match
      ? [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
      : [];
    currentDeps.set(key, deps);
  }

  // Check: for each package found in the repo, verify its file:/workspace: deps
  // are listed in deps.ts
  let issues = 0;

  for (const pkg of packages) {
    if (pkg.workspaceDeps.length === 0) continue;

    // Skip sub-packages whose parent is already tracked (e.g. scout-for-lol/packages/backend
    // is managed by the scout-for-lol parent workspace entry)
    const isSubPackageOfTracked = currentKeys.some(
      (k) => pkg.path.startsWith(k + "/") && k !== pkg.path,
    );
    if (isSubPackageOfTracked) continue;

    // Find this package in deps.ts (by path or name)
    const depsKey = currentKeys.find((k) => k === pkg.path || k === pkg.name);
    if (!depsKey) {
      console.error(
        `MISSING: package "${pkg.path}" has workspace deps [${pkg.workspaceDeps.join(", ")}] but is not in WORKSPACE_DEPS`,
      );
      issues++;
      continue;
    }

    const listed = currentDeps.get(depsKey) ?? [];
    for (const dep of pkg.workspaceDeps) {
      if (!listed.includes(dep)) {
        console.error(
          `MISSING DEP: "${depsKey}" has workspace dep "${dep}" in package.json but not in WORKSPACE_DEPS`,
        );
        issues++;
      }
    }
  }

  if (issues > 0) {
    console.error(`\n${issues} issue(s) found. Update .dagger/src/deps.ts manually.`);
    if (checkMode) process.exit(1);
  } else {
    console.log("deps.ts is consistent with package.json workspace deps");
  }
}

await main();
