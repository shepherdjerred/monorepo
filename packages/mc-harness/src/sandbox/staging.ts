import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { StagedEntry } from "#sandbox/profiles.ts";
import { stormModuleConfig } from "#sandbox/storm.ts";

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Fails before any container exists when a staged repository output is missing. */
export async function requireStagedSources(
  repoRoot: string,
  entries: readonly StagedEntry[],
): Promise<void> {
  for (const entry of entries) {
    const source = path.join(repoRoot, entry.source);
    if (!(await exists(source))) {
      const hint =
        entry.kind === "repo-file" && entry.build !== undefined
          ? ` Build it first:\n  ${entry.build}`
          : " It is a repository file; restore it from git.";
      throw new Error(`${source} is missing.${hint}`);
    }
  }
}

/** Copies repository outputs and derived config into a sandbox's /plugins mount. */
export async function stageEntries(
  pluginsDir: string,
  repoRoot: string,
  entries: readonly StagedEntry[],
): Promise<void> {
  await requireStagedSources(repoRoot, entries);
  for (const entry of entries) {
    const source = path.join(repoRoot, entry.source);
    const target = path.join(pluginsDir, entry.target);
    await mkdir(path.dirname(target), { recursive: true });
    switch (entry.kind) {
      case "repo-file": {
        await Bun.write(target, Bun.file(source));
        break;
      }
      case "repo-dir": {
        await cp(source, target, { recursive: true });
        break;
      }
      case "storm-config": {
        await Bun.write(
          target,
          stormModuleConfig(await Bun.file(source).text(), entry.modules),
        );
        break;
      }
    }
  }
}
