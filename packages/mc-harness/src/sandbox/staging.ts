import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { paper } from "#src/pins.ts";
import {
  ensureArtifact,
  paperJarName,
  stagePinnedPlugins,
  writeThrottleFreeBukkitYml,
} from "#sandbox/artifacts.ts";
import {
  stagesPlugins,
  type ResolvedProfile,
  type StagedEntry,
} from "#sandbox/profiles.ts";
import { stormModuleConfig } from "#sandbox/storm.ts";

/** A host file copied into the sandbox's /data before Paper starts. */
export type SeedFile = { source: string; target: string };

/**
 * Stages everything a profile needs on the host under the sandbox dir:
 * `<dir>/plugins` for the /plugins mount (when the profile stages plugins) and
 * the /data seed files (pinned Paper jar from the cache, throttle-free
 * bukkit.yml). Both providers copy these into the server the same way.
 */
export async function stageSandboxFiles(options: {
  dir: string;
  cacheDir: string;
  repoRoot: string;
  profile: ResolvedProfile;
}): Promise<{ pluginsDir: string | null; seedFiles: SeedFile[] }> {
  const { dir, cacheDir, repoRoot, profile } = options;
  let pluginsDir: string | null = null;
  if (stagesPlugins(profile)) {
    pluginsDir = path.join(dir, "plugins");
    await stagePinnedPlugins(
      path.join(cacheDir, "plugins"),
      pluginsDir,
      profile.plugins,
    );
    await stageEntries(pluginsDir, repoRoot, profile.staged);
  }
  if (!profile.seedData) {
    return { pluginsDir, seedFiles: [] };
  }
  const paperJar = path.join(cacheDir, paperJarName);
  await ensureArtifact(paperJar, paper);
  const bukkitYml = path.join(dir, "bukkit.yml");
  await writeThrottleFreeBukkitYml(bukkitYml);
  return {
    pluginsDir,
    seedFiles: [
      { source: bukkitYml, target: "bukkit.yml" },
      { source: paperJar, target: paperJarName },
    ],
  };
}

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
          stormModuleConfig(
            await Bun.file(source).text(),
            entry.modules,
            entry.moduleKeys,
          ),
        );
        break;
      }
    }
  }
}
