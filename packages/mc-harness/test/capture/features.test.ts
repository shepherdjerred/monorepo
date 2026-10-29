import { it, expect } from "vitest";
import { captureModules } from "#sandbox/capture-features.ts";
import { resolveProfile } from "#sandbox/profiles.ts";
import { captureConfig } from "#sandbox/capture-config.ts";
import { SandboxCreateRequestSchema } from "#protocol/ipc.ts";

it("requires imported RWF terrain and resolves the full milestone service graph", () => {
  const source = {
    sha256: "a".repeat(64),
    files: 1,
    bytes: 1,
    dimensions: ["minecraft:overworld"],
  };
  expect(() => captureModules(["rwf"], source)).toThrow(
    "imported real terrain",
  );
  const imported = {
    ...source,
    dimensions: [...source.dimensions, "minecraft:rwf", "minecraft:settlement"],
  };
  expect(() => captureModules(["stargates"], source)).toThrow(
    "minecraft:creative",
  );
  expect(
    captureModules(["stargates"], {
      ...source,
      dimensions: [...source.dimensions, "minecraft:creative"],
    }),
  ).toEqual(["creative", "stargates"]);
  const modules = captureModules(["advancements"], imported);
  expect(modules).toEqual(
    expect.arrayContaining([
      "mobs",
      "npcs",
      "quests",
      "shards",
      "arena",
      "rwf",
      "advancements",
    ]),
  );
  for (const external of ["discord", "agent", "rwfbots"])
    expect(modules).not.toContain(external);
  const request = SandboxCreateRequestSchema.parse({
    profile: "storm-dev",
    world: "real-map",
    mapDirectory: "/maps/main",
    mapSpawn: [68.5, 69, 66.5],
    ttlSeconds: 3600,
    keep: false,
    captureFeatures: ["advancements"],
  });
  const profile = resolveProfile(
    request,
    { bridgeToken: "a".repeat(48), rconPassword: "b".repeat(48) },
    imported,
  );
  const worlds = profile.staged.find(
    (entry) => entry.kind === "capture-content" && entry.content === "world",
  );
  const shards = profile.staged.find(
    (entry) => entry.kind === "capture-content" && entry.content === "shards",
  );
  const registry = profile.staged.find(
    (entry) =>
      entry.kind === "capture-content" && entry.content === "multiverse",
  );
  if (registry?.kind !== "capture-content")
    throw new Error("Missing imported-world startup registry");
  const startup = Bun.YAML.parse(captureConfig("worlds: []", registry));
  expect(startup).toMatchObject({
    "minecraft:rwf": { "auto-load": true },
    "minecraft:settlement": { "auto-load": true },
  });
  expect(startup).not.toHaveProperty("minecraft:creative");
  if (worlds?.kind !== "capture-content" || shards?.kind !== "capture-content")
    throw new Error("Missing capture overlays");
  expect(captureConfig("worlds: []\nborders: []", worlds)).toContain(
    "name: rwf",
  );
  const mapped = captureConfig(
    "drops:\n  worlds: [minecraft:overworld, minecraft:frontier]\naltars: [preserve-exact-altar]",
    shards,
  );
  expect(mapped).not.toContain("frontier");
  expect(mapped).toContain("preserve-exact-altar");
  const optionalArena = profile.staged.find(
    (entry) =>
      entry.kind === "capture-content" && entry.content === "arena-survival",
  );
  if (optionalArena?.kind !== "capture-content")
    throw new Error("Missing survival-map overlay");
  expect(
    Bun.YAML.parse(
      captureConfig("enabled: true\narena: {world: rustworks}", optionalArena),
    ),
  ).toMatchObject({ enabled: false });
  expect(
    Bun.YAML.parse(
      captureConfig("enabled: true\narena: {world: settlement}", optionalArena),
    ),
  ).toMatchObject({ enabled: true });
});
