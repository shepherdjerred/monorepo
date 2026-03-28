#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Walk the packages/ directory and run `bun install` in each package
 * that has a package.json with dependencies, generating per-package lockfiles.
 */
async function main(): Promise<void> {
  if (!existsSync("packages")) {
    console.error("Expected to run from repository root.");
    process.exit(1);
  }

  const packageDirs: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === ".git" ||
        entry.name === "target" ||
        entry.name === "archive"
      ) {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (existsSync(join(fullPath, "package.json"))) {
          packageDirs.push(fullPath);
        }
        await walk(fullPath);
      }
    }
  }

  await walk("packages");

  const failures: Array<{ dir: string; error: string }> = [];
  let installed = 0;

  for (const dir of packageDirs.sort()) {
    const text = await readFile(join(dir, "package.json"), "utf8");
    const json = JSON.parse(text) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    // Skip packages with no deps
    if (!json.dependencies && !json.devDependencies) {
      continue;
    }

    console.log(`\n--- ${dir} ---`);
    try {
      await $`bun install`.cwd(dir);
      installed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ dir, error: message });
      console.error(`  FAILED: ${message}`);
    }
  }

  console.log(`\n${String(installed)} package(s) installed successfully.`);
  if (failures.length > 0) {
    console.error(`${String(failures.length)} package(s) failed:`);
    for (const f of failures) {
      console.error(`  - ${f.dir}`);
    }
    process.exit(1);
  }
}

await main();
