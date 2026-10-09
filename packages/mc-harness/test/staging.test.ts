import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedProfile } from "#sandbox/profiles.ts";
import { stageSandboxFiles } from "#sandbox/staging.ts";

async function mode(file: string): Promise<number> {
  const info = await stat(file);
  return info.mode & 0o777;
}

describe("stageSandboxFiles", () => {
  it("stages a /plugins tree the image's unprivileged user can read", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mc-staging-"));
    const repoRoot = path.join(root, "repo");
    const dir = path.join(root, "sandbox");
    await Bun.write(path.join(repoRoot, "out", "Plugin.jar"), "jar");
    await Bun.write(path.join(repoRoot, "config", "plugin.yml"), "a: 1\n");
    const profile: ResolvedProfile = {
      image: "example/paper@sha256:0",
      env: {},
      plugins: [],
      staged: [
        { kind: "repo-file", source: "out/Plugin.jar", target: "Plugin.jar" },
        {
          kind: "repo-file",
          source: "config/plugin.yml",
          target: path.join("Plugin", "config.yml"),
        },
      ],
      pluginMount: "directory",
      seedData: false,
      ports: [],
      defaultProvider: "docker",
      memory: { request: "1Gi", limit: "1Gi" },
    };

    const { pluginsDir, seedFiles } = await stageSandboxFiles({
      dir,
      cacheDir: path.join(root, "cache"),
      repoRoot,
      profile,
    });

    expect(seedFiles).toEqual([]);
    if (pluginsDir === null) {
      throw new Error("expected a plugins dir");
    }
    // Docker bind-mounts this tree at /plugins; the itzg image syncs it as
    // uid 1000, so every directory needs o+rx and every file o+r.
    expect(await mode(pluginsDir)).toBe(0o755);
    expect(await mode(path.join(pluginsDir, "Plugin"))).toBe(0o755);
    expect((await mode(path.join(pluginsDir, "Plugin.jar"))) & 0o004).toBe(
      0o004,
    );
    expect(
      (await mode(path.join(pluginsDir, "Plugin", "config.yml"))) & 0o004,
    ).toBe(0o004);
  });
});
