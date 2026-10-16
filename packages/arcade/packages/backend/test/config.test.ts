import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { defineConfig } from "@shepherdjerred/config";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";
import { configDefinition, gameEnabled, loadConfig } from "#src/config.ts";

function source(
  name: "file" | "flag",
  values: Readonly<Record<string, unknown>>,
): ConfigSource {
  return {
    name,
    get: async (names) =>
      Object.hasOwn(values, names.key)
        ? { value: values[names.key] }
        : undefined,
  };
}

describe("Arcade configuration", () => {
  it("reads the actual flat TOML keys used by the deployment", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "arcade-config-"));
    const file = path.join(root, "arcade.toml");
    try {
      await Bun.write(
        file,
        'controllerActive = true\nmk64OutputFps = 60\nstateRoot = "/fixtures/saves"\nport = 18081\n',
      );
      const config = await loadConfig(file, "beta");
      expect(await config.get("controllerActive")).toEqual({
        value: true,
        source: "file",
      });
      expect(await config.value("mk64OutputFps")).toBe(60);
      expect(await config.value("stateRoot")).toBe("/fixtures/saves");
      expect(await config.value("port")).toBe(18_081);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("defaults new games off and records provenance", async () => {
    const config = defineConfig({ definition: configDefinition, sources: {} });
    await expect(config.get("enabled")).resolves.toEqual({
      value: false,
      source: "default",
    });
    await expect(config.get("maxSessions")).resolves.toEqual({
      value: 2,
      source: "default",
    });
    await expect(config.get("controllerActive")).resolves.toEqual({
      value: false,
      source: "default",
    });
    for (const gameId of [
      "mk64",
      "emerald",
      "mkwii",
      "melee",
      "brawl",
    ] as const)
      await expect(gameEnabled(config, gameId, "1")).resolves.toBe(false);
    const enabled = defineConfig({
      definition: configDefinition,
      sources: { file: source("file", { enabled: true }) },
    });
    await expect(gameEnabled(enabled, "mk64", "1")).resolves.toBe(true);
    await expect(gameEnabled(enabled, "brawl", "1")).resolves.toBe(false);
  });

  it("honors explicit flag false and a zero heavy-game allowance", async () => {
    const config = defineConfig({
      definition: configDefinition,
      sources: {
        flag: source("flag", { enabled: false }),
        file: source("file", { enabled: true, maxHeavySessions: 0 }),
      },
    });
    await expect(config.get("enabled")).resolves.toEqual({
      value: false,
      source: "flag",
    });
    await expect(config.get("maxHeavySessions")).resolves.toEqual({
      value: 0,
      source: "file",
    });
  });

  it("rejects present invalid values instead of replacing them with defaults", async () => {
    const config = defineConfig({
      definition: configDefinition,
      sources: {
        flag: source("flag", { enabled: "true" }),
        file: source("file", { maxSessions: 3 }),
      },
    });
    await expect(config.value("enabled")).rejects.toThrow(
      "from flag failed validation",
    );
    await expect(config.value("maxSessions")).rejects.toThrow(
      "from file failed validation",
    );
  });

  it("observes a failing source while resolving the declared fallback", async () => {
    const onSourceError = vi.fn();
    const config = defineConfig({
      definition: configDefinition,
      sources: {
        flag: {
          name: "flag",
          get: async () => {
            throw new Error("flag service unavailable");
          },
        },
        file: source("file", { enabled: true }),
      },
      hooks: { onSourceError },
    });
    await expect(config.get("enabled")).resolves.toEqual({
      value: true,
      source: "file",
    });
    expect(onSourceError).toHaveBeenCalledWith(
      "enabled",
      "flag",
      "flag service unavailable",
    );
    const description = await config.describe();
    expect(
      description.find((entry) => entry.key === "mk64OutputFps"),
    ).toMatchObject({
      source: "default",
      value: 30,
    });
    expect(description.some((entry) => entry.key.includes("Token"))).toBe(
      false,
    );
  });

  it("evaluates rollouts for the requesting server", async () => {
    const targetingKeys: (string | undefined)[] = [];
    const config = defineConfig({
      definition: configDefinition,
      sources: {
        flag: {
          name: "flag",
          get: async (_names, context) => {
            targetingKeys.push(context?.targetingKey);
            return { value: context?.targetingKey === "1" };
          },
        },
      },
    });
    await expect(gameEnabled(config, "mkwii", "1")).resolves.toBe(true);
    await expect(gameEnabled(config, "mkwii", "2")).resolves.toBe(false);
    expect(targetingKeys).toEqual(["1", "1", "2"]);
  });
});
