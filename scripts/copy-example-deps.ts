#!/usr/bin/env bun
/**
 * Copies a parent package's published files into an example's node_modules.
 *
 * Usage: bun run copy-example-deps.ts <parent-dir> <dep-name> <example-dir>
 *
 * Reads the parent's package.json `files` field to determine what to copy,
 * mirroring what `npm pack` would include. This replaces `file:` / `link:`
 * protocols that create recursive symlinks when the example lives inside
 * the parent package.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const [parentDirArg, depName, exampleDirArg] = process.argv.slice(2);

if (!parentDirArg || !depName || !exampleDirArg) {
  console.error(
    "Usage: copy-example-deps.ts <parent-dir> <dep-name> <example-dir>",
  );
  process.exit(1);
}

const parentDir = resolve(exampleDirArg, parentDirArg);
const exampleDir = resolve(exampleDirArg);
const targetDir = join(exampleDir, "node_modules", depName);

const parentPkgPath = join(parentDir, "package.json");
if (!existsSync(parentPkgPath)) {
  console.error(`Parent package.json not found: ${parentPkgPath}`);
  process.exit(1);
}

const parentPkg = JSON.parse(
  await Bun.file(parentPkgPath).text(),
) as Record<string, unknown>;
const files = parentPkg["files"];

if (!Array.isArray(files)) {
  console.error(`No "files" field in ${parentPkgPath}`);
  process.exit(1);
}

// Always include package.json
const toCopy: string[] = [
  ...new Set(["package.json", ...(files as string[])]),
];

// Clean and recreate target
if (existsSync(targetDir)) {
  rmSync(targetDir, { recursive: true });
}
mkdirSync(targetDir, { recursive: true });

for (const entry of toCopy) {
  const src = join(parentDir, entry);
  if (!existsSync(src)) {
    // Skip missing optional files (e.g. CHANGELOG.md before first release)
    continue;
  }
  const dest = join(targetDir, entry);
  cpSync(src, dest, { recursive: true });
}

console.log(`Copied ${depName} (${toCopy.length} entries) → ${targetDir}`);
