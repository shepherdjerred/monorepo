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

import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

const ParentPkgSchema = z.object({
  files: z.array(z.string()).optional(),
});

const [parentDirArg, depName, exampleDirArg] = process.argv.slice(2);

if (!parentDirArg || !depName || !exampleDirArg) {
  console.error(
    "Usage: copy-example-deps.ts <parent-dir> <dep-name> <example-dir>",
  );
  process.exit(1);
}

const parentDir = path.resolve(exampleDirArg, parentDirArg);
const exampleDir = path.resolve(exampleDirArg);
const targetDir = path.join(exampleDir, "node_modules", depName);

const parentPkgPath = path.join(parentDir, "package.json");
if (!(await pathExists(parentPkgPath))) {
  console.error(`Parent package.json not found: ${parentPkgPath}`);
  process.exit(1);
}

const parentPkg = ParentPkgSchema.parse(
  JSON.parse(await Bun.file(parentPkgPath).text()),
);
const files = parentPkg.files;

if (!Array.isArray(files)) {
  console.error(`No "files" field in ${parentPkgPath}`);
  process.exit(1);
}

// Always include package.json
const toCopy: string[] = [...new Set(["package.json", ...files])];

// Clean and recreate target
if (await pathExists(targetDir)) {
  await rm(targetDir, { recursive: true });
}
await mkdir(targetDir, { recursive: true });

for (const entry of toCopy) {
  const src = path.join(parentDir, entry);
  if (!(await pathExists(src))) {
    // Skip missing optional files (e.g. CHANGELOG.md before first release)
    continue;
  }
  const dest = path.join(targetDir, entry);
  await cp(src, dest, { recursive: true });
}

console.log(
  `Copied ${depName} (${String(toCopy.length)} entries) → ${targetDir}`,
);
