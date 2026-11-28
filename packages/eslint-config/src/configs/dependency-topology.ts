/**
 * Compute a deterministic SHA-256 fingerprint of a workspace's declared
 * dependency map and on-disk `node_modules/<dep>` link targets.
 *
 * ESLint's `LintResultCache` invalidates `.eslintcache` entries only when a
 * linted file's mtime/size changes or `JSON.stringify(config)` changes. Embed
 * this digest in `settings` so installing missing workspace symlinks or
 * switching `.bun` peer-resolution directories invalidates cached diagnostics
 * while keeping warm `.eslintcache` hits intact when topology is unchanged.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type ManifestDependencies = {
  entries: string[];
  packageNames: string[];
};

function readManifestDependencies(
  tsconfigRootDir: string,
): ManifestDependencies | null {
  const manifestPath = path.join(tsconfigRootDir, "package.json");
  let rawText: string;
  try {
    rawText = readFileSync(manifestPath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { entries: ["package.json:invalid"], packageNames: [] };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { entries: ["package.json:non-object"], packageNames: [] };
  }

  const record = parsed as Record<string, unknown>;
  const entries: string[] = [];
  const names = new Set<string>();

  for (const section of DEPENDENCY_SECTIONS) {
    const sectionValue = record[section];
    if (typeof sectionValue !== "object" || sectionValue === null) {
      continue;
    }
    const depMap = sectionValue as Record<string, unknown>;
    const sortedKeys = Object.keys(depMap).sort((a, b) => a.localeCompare(b));
    for (const depName of sortedKeys) {
      const specifier = depMap[depName];
      if (typeof specifier === "string") {
        entries.push(`${section}:${depName}=${specifier}`);
        names.add(depName);
      }
    }
  }

  return {
    entries,
    packageNames: [...names].sort((a, b) => a.localeCompare(b)),
  };
}

function describeLinkTarget(targetPath: string): string {
  const linkTarget = readlinkSync(targetPath);
  try {
    const resolvedTarget = realpathSync(targetPath);
    return `symlink:${linkTarget}->${resolvedTarget}`;
  } catch {
    return `symlink:${linkTarget}->dangling`;
  }
}

function describeNodeModulesEntry(targetPath: string): string {
  let stats;
  try {
    stats = lstatSync(targetPath);
  } catch {
    return "missing";
  }

  if (stats.isSymbolicLink()) {
    return describeLinkTarget(targetPath);
  }
  return stats.isDirectory() ? "dir" : "file";
}

export function computeDependencyTopologyHash(tsconfigRootDir: string): string {
  const hasher = createHash("sha256");
  const nodeModulesDir = path.join(tsconfigRootDir, "node_modules");
  const manifest = readManifestDependencies(tsconfigRootDir);

  if (manifest === null) {
    hasher.update("package.json:missing\n");
    hasher.update(`node_modules:${describeNodeModulesEntry(nodeModulesDir)}\n`);
    return hasher.digest("hex");
  }

  for (const entry of manifest.entries) {
    hasher.update(`${entry}\n`);
  }
  hasher.update(`node_modules:${describeNodeModulesEntry(nodeModulesDir)}\n`);

  for (const packageName of manifest.packageNames) {
    const depPath = path.join(nodeModulesDir, packageName);
    hasher.update(`dep:${packageName}:${describeNodeModulesEntry(depPath)}\n`);
  }

  return hasher.digest("hex");
}
