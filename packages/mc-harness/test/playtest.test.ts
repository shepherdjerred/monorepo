import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newRunId } from "#daemon/playtests.ts";
import type { InfoResponse } from "#protocol/bridge.ts";
import { playtestExitCode, RunIdSchema } from "#protocol/playtest.ts";
import { blockMatches, eventMatches } from "#playtest/context.ts";
import { missingRequirements } from "#playtest/run.ts";
import { loadScenario, scenarioMeta } from "#playtest/scenario.ts";
import { stormServerImages } from "#src/pins.ts";
import { resolveProfile } from "#sandbox/profiles.ts";
import { requireStagedSources, stageEntries } from "#sandbox/staging.ts";
import {
  STORM_PATHS,
  stormImageConfig,
  stormModuleConfig,
} from "#sandbox/storm.ts";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "mc-harness-playtest-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const info: InfoResponse = {
  apiVersion: 1,
  bridgeVersion: "0.1.0",
  minecraftVersion: "26.2",
  serverVersion: "26.2-129",
  dataVersion: 4903,
  onlineMode: false,
  worlds: [],
  plugins: [
    { name: "WorldEdit", version: "7.4.5", enabled: true },
    { name: "TheStorm", version: "0.1.0", enabled: false },
  ],
  capabilities: ["worldedit"],
};

describe("block and event matching", () => {
  it("matches ids and only the properties the expectation names", () => {
    const lever = "minecraft:lever[face=floor,facing=north,powered=true]";
    expect(blockMatches(lever, "minecraft:lever")).toBe(true);
    expect(blockMatches(lever, "lever[powered=true]")).toBe(true);
    expect(blockMatches(lever, "minecraft:lever[powered=false]")).toBe(false);
    expect(blockMatches("minecraft:air", "minecraft:cave_air")).toBe(false);
  });

  it("matches events by type, player and text", () => {
    const event = {
      seq: 3,
      ts: "2026-10-04T00:00:00Z",
      type: "chat" as const,
      player: "alice",
      text: "hello there",
    };
    expect(eventMatches(event, { type: "chat", player: "alice" })).toBe(true);
    expect(eventMatches(event, { text: /there$/u })).toBe(true);
    expect(eventMatches(event, { text: "nope" })).toBe(false);
    expect(eventMatches(event, { player: "bob" })).toBe(false);
  });
});

describe("scenario loading", () => {
  it("validates the default export and derives metadata", async () => {
    const file = path.join(dir, "ok.playtest.ts");
    await Bun.write(
      file,
      `export default {
        name: "ok",
        requires: { profiles: ["storm-dev"], plugins: ["TheStorm"] },
        actors: { alice: { at: { x: 0, y: -60, z: 0 } } },
        run: async () => {},
      };`,
    );
    const meta = scenarioMeta(await loadScenario(file));
    expect(meta).toEqual({
      name: "ok",
      description: "",
      requires: {
        profiles: ["storm-dev"],
        plugins: ["TheStorm"],
        capabilities: ["citizens"],
      },
      timeoutMs: 120_000,
      actors: ["alice"],
    });
  });

  it("rejects a file that does not export a scenario", async () => {
    const file = path.join(dir, "bad.playtest.ts");
    await Bun.write(
      file,
      `export default { name: "bad", actors: { "no-dash": { at: { x: 0, y: 0, z: 0 } } } };`,
    );
    await expect(loadScenario(file)).rejects.toThrow(/defineScenario/u);
  });

  it("reports what a target lacks", () => {
    const meta = {
      name: "x",
      description: "",
      requires: {
        profiles: ["storm-dev" as const],
        plugins: ["TheStorm"],
        capabilities: ["citizens" as const],
      },
      timeoutMs: 1000,
      actors: [],
    };
    expect(missingRequirements(meta, info, "paper")).toEqual([
      "profile storm-dev (target is paper)",
      "plugin TheStorm",
      "capability citizens",
    ]);
  });
});

describe("run ids and exit codes", () => {
  it("formats sortable run ids", () => {
    const id = newRunId(new Date("2026-10-04T01:59:29.123Z"));
    expect(id).toMatch(/^pt-20261004-015929-[0-9a-f]{4}$/u);
    expect(RunIdSchema.safeParse(id).success).toBe(true);
  });

  it("maps statuses to exit codes", () => {
    expect(playtestExitCode(["passed", "skipped"])).toBe(0);
    expect(playtestExitCode(["passed", "failed"])).toBe(1);
    expect(playtestExitCode(["failed", "timedOut"])).toBe(2);
    expect(playtestExitCode(["errored"])).toBe(2);
  });
});

describe("published Storm image profiles", () => {
  it.each(["prod", "candidate"] as const)(
    "uses the module schema snapshot pinned to the %s image digest",
    (channel) => {
      const config = stormImageConfig(stormServerImages[channel]);
      expect(config.moduleKeys).toContain("rwfbots");
      expect(config.enabledModules).toContain("companions");
      expect(config.enabledModules).not.toContain("rwf");

      const profile = resolveProfile(
        {
          profile: channel === "prod" ? "storm-prod" : "storm-candidate",
          world: "flat",
        },
        { bridgeToken: "token", rconPassword: "password" },
      );
      expect(profile.staged[0]).toMatchObject({
        kind: "storm-config",
        modules: config.enabledModules,
        moduleKeys: config.moduleKeys,
      });
    },
  );

  it("requires a schema snapshot for each published image digest", () => {
    expect(() =>
      stormImageConfig(
        "ghcr.io/shepherdjerred/the-storm-server:test@sha256:" + "0".repeat(64),
      ),
    ).toThrow(/No Storm module config snapshot/u);
  });
});

describe("profiles and staging", () => {
  const secrets = { bridgeToken: "a".repeat(48), rconPassword: "b".repeat(48) };

  it("stages Citizens in paper and TheStorm in storm-dev", () => {
    const paper = resolveProfile({ profile: "paper", world: "flat" }, secrets);
    const storm = resolveProfile(
      { profile: "storm-dev", world: "flat" },
      secrets,
    );
    expect(paper.plugins.map((pin) => pin.name)).toEqual([
      "WorldEdit",
      "Citizens",
    ]);
    expect(storm.plugins.map((pin) => pin.name)).toEqual([
      "WorldEdit",
      "Citizens",
      "CoreProtect",
      "LuckPerms",
      "Multiverse-Core",
    ]);
    expect(storm.staged.map((entry) => entry.target)).toEqual([
      "MCBridge.jar",
      "TheStorm.jar",
      "TheStormFixtures.jar",
      "TheStorm",
      "Citizens",
      path.join("TheStorm", "config.yml"),
      "TheStormMechanicsE2E.jar",
      path.join("TheStormMechanicsE2E", "mechanics.yml"),
    ]);
  });

  it.each(["storm-prod", "storm-candidate"] as const)(
    "gives %s the inert Flipt bootstrap companions need to enable",
    (profile) => {
      const image = resolveProfile({ profile, world: "flat" }, secrets);
      expect(image.env).toMatchObject({
        FLIPT_URL: "http://127.0.0.1:9",
        FLIPT_ENVIRONMENT: "beta",
        RWF_RECORDING_SALT: "mc-harness-storm-fixture-recording-salt",
      });
      expect(image.staged).toHaveLength(2);
      const imageConfig = image.staged[0];
      expect(imageConfig?.kind).toBe("storm-config");
      if (imageConfig?.kind === "storm-config") {
        expect(imageConfig.target).toBe(path.join("TheStorm", "config.yml"));
        expect(imageConfig.modules).toContain("companions");
        expect(imageConfig.modules).not.toContain("rwf");
        expect(imageConfig.modules).not.toContain("rwfbots");
      }
      expect(image.staged[1]).toMatchObject({
        kind: "repo-file",
        source: STORM_PATHS.fixturesJar,
        target: "TheStormFixtures.jar",
      });
    },
  );

  it("fails with the build command when an output is missing", async () => {
    await expect(
      requireStagedSources(dir, [
        {
          kind: "repo-file",
          source: "missing.jar",
          target: "x.jar",
          build: "make jar",
        },
      ]),
    ).rejects.toThrow(
      /missing\.jar is missing\. Build it first:\n {2}make jar/u,
    );
  });

  it("copies files and derives the Storm module config", async () => {
    const repo = path.join(dir, "repo");
    await mkdir(path.join(repo, "owned"), { recursive: true });
    await Bun.write(path.join(repo, "a.jar"), "jar");
    await Bun.write(path.join(repo, "owned", "x.yml"), "x: 1\n");
    await Bun.write(
      path.join(repo, "owned", "config.yml"),
      "modules:\n  economy: true\n  agent: true\n",
    );
    const plugins = path.join(dir, "plugins");
    await stageEntries(plugins, repo, [
      { kind: "repo-file", source: "a.jar", target: "A.jar" },
      { kind: "repo-dir", source: "owned", target: "Owned" },
      {
        kind: "storm-config",
        source: path.join("owned", "config.yml"),
        target: path.join("Owned", "config.yml"),
        modules: ["economy"],
      },
    ]);
    expect(await Bun.file(path.join(plugins, "A.jar")).text()).toBe("jar");
    expect(await Bun.file(path.join(plugins, "Owned", "x.yml")).text()).toBe(
      "x: 1\n",
    );
    expect(
      await Bun.file(path.join(plugins, "Owned", "config.yml")).text(),
    ).toBe("modules:\n  economy: true\n  agent: false\n");
  });

  it("rejects unknown Storm modules", () => {
    expect(() =>
      stormModuleConfig("modules:\n  economy: true\n", ["towns"]),
    ).toThrow(/Unknown modules: towns/u);
  });
});
