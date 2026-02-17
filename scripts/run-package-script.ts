#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

type PackageMeta = {
  dir: string;
  name: string;
  scripts: Record<string, string>;
};

async function getPackageJsonPaths(): Promise<string[]> {
  const paths: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name === ".git" || entry.name === "examples" || entry.name === "example") {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(fullPath);
      } else if (entry.name === "package.json") {
        paths.push(fullPath);
      }
    }
  }

  await walk("packages");
  return paths.sort();
}

async function loadPackageMeta(path: string): Promise<PackageMeta> {
  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text) as { name?: string; scripts?: Record<string, string> };
  return {
    dir: dirname(path),
    name: parsed.name ?? relative("packages", dirname(path)),
    scripts: parsed.scripts ?? {},
  };
}

async function main(): Promise<void> {
  const scriptName = process.argv[2];
  if (!scriptName) {
    console.error("Usage: bun run scripts/run-package-script.ts <script>");
    process.exit(1);
  }

  if (!existsSync("packages")) {
    console.error("Expected to run from repository root.");
    process.exit(1);
  }

  const packageJsonPaths = await getPackageJsonPaths();
  const metas = await Promise.all(packageJsonPaths.map((path) => loadPackageMeta(path)));
  const runnable = metas.filter((meta) => meta.scripts[scriptName]);
  const skipped = metas.length - runnable.length;
  const failures: Array<{ dir: string; error: unknown }> = [];

  console.log(`Running '${scriptName}' in ${String(runnable.length)} package(s) (${String(skipped)} skipped)...`);

  for (const meta of runnable) {
    console.log(`\n--- ${meta.name} (${meta.dir}) ---`);
    try {
      await $`bun run ${scriptName}`.cwd(meta.dir);
    } catch (error) {
      failures.push({ dir: meta.dir, error });
    }
  }

  if (failures.length > 0) {
    console.error(`\n${String(failures.length)} package(s) failed '${scriptName}':`);
    for (const failure of failures) {
      const message = failure.error instanceof Error ? failure.error.message : String(failure.error);
      console.error(`- ${failure.dir}: ${message}`);
    }
    process.exit(1);
  }
}

await main();
