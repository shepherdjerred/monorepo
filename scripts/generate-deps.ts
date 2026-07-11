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
import path from "node:path";
import { z } from "zod";

const ROOT = import.meta.dir + "/..";
const DEPS_FILE = path.join(ROOT, ".dagger/src/deps.ts");
const PACKAGES_DIR = path.join(ROOT, "packages");

const PackageJsonSchema = z.object({
  name: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});
type PackageJson = z.infer<typeof PackageJsonSchema>;

type PkgInfo = {
  name: string;
  path: string;
  workspaceDeps: string[];
};

/** Recursively find package.json files under packages/ */
async function findPackageJsons(dir: string, depth = 0): Promise<string[]> {
  const results: string[] = [];
  const pkgJson = path.join(dir, "package.json");
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
        ![
          "node_modules",
          "dist",
          "build",
          ".git",
          "target",
          "archive",
        ].includes(entry.name)
      ) {
        results.push(
          ...(await findPackageJsons(path.join(dir, entry.name), depth + 1)),
        );
      }
    }
  }
  return results;
}

/** Extract workspace deps from a package.json */
function extractWorkspaceDeps(
  pkg: PackageJson,
  allPackageNames: Map<string, string>,
): string[] {
  const deps: string[] = [];
  for (const depsObj of [pkg.dependencies, pkg.devDependencies]) {
    if (depsObj === undefined) continue;
    for (const [name, version] of Object.entries(depsObj)) {
      if (version.startsWith("workspace:") || version.startsWith("file:")) {
        // Map scoped package name to directory name
        const shortName = name.startsWith("@") ? name.split("/").pop() : name;
        const shortDir =
          shortName === undefined ? undefined : allPackageNames.get(shortName);
        const fullDir = allPackageNames.get(name);
        if (shortDir !== undefined) {
          deps.push(shortDir);
        } else if (fullDir !== undefined) {
          deps.push(fullDir);
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
    const content = PackageJsonSchema.parse(
      JSON.parse(await readFile(pkgJsonPath, "utf8")),
    );
    const relPath = path.relative(
      path.join(ROOT, "packages"),
      path.join(pkgJsonPath, ".."),
    );

    // Use the package name (without scope) as the key
    const name: string = content.name ?? relPath;
    const shortName = name.startsWith("@")
      ? (name.split("/").pop() ?? name)
      : name;

    nameToPath.set(shortName, relPath);
    nameToPath.set(name, relPath);
    packages.push({ name: shortName, path: relPath, workspaceDeps: [] });
  }

  // Resolve workspace deps for each package
  for (const pkg of packages) {
    const pkgJsonPath = path.join(PACKAGES_DIR, pkg.path, "package.json");
    const content = PackageJsonSchema.parse(
      JSON.parse(await readFile(pkgJsonPath, "utf8")),
    );
    pkg.workspaceDeps = extractWorkspaceDeps(content, nameToPath);
  }

  // Read current deps.ts and extract the manually maintained WORKSPACE_DEPS
  const currentContent = await readFile(DEPS_FILE, "utf8");
  // Match both quoted keys ("foo": [...) and unquoted keys (foo: [...)
  const currentKeys = [
    ...currentContent.matchAll(/^\s+(?:"([^"]+)"|(\w[\w/.-]*))\s*:\s*\[/gm),
  ]
    .map((m) => m[1] ?? m[2])
    .filter((k) => k !== undefined);

  // For each key in deps.ts, parse its listed deps
  const currentDeps = new Map<string, string[]>();
  for (const key of currentKeys) {
    const escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const re = new RegExp(
      String.raw`(?:"${escaped}"|${escaped})\s*:\s*\[([^\]]*)\]`,
    );
    const match = currentContent.match(re);
    const matchBody = match?.[1];
    const deps =
      matchBody === undefined
        ? []
        : [...matchBody.matchAll(/"([^"]+)"/g)]
            .map((m) => m[1])
            .filter((d) => d !== undefined);
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
      (k) => pkg.path.startsWith(`${k}/`) && k !== pkg.path,
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
    console.error(
      `\n${String(issues)} issue(s) found. Update .dagger/src/deps.ts manually.`,
    );
    if (checkMode) process.exit(1);
  } else {
    console.log("deps.ts is consistent with package.json workspace deps");
  }
}

await main();
