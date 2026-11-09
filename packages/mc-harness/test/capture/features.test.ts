import { it, expect } from "vitest";
import { z } from "zod";
import { captureModules } from "#sandbox/capture-features.ts";
import { resolveProfile } from "#sandbox/profiles.ts";
import { captureConfig } from "#sandbox/capture-config.ts";
import { SandboxCreateRequestSchema } from "#protocol/ipc.ts";

it("loads the production MOTD owner for branded multiplayer-list captures", () => {
  expect(
    captureModules(["server-list"], {
      sha256: "a".repeat(64),
      files: 1,
      bytes: 1,
    }),
  ).toEqual(["messages"]);
});

it("limits the annual-event preset to Stormnight's calendar while retaining its real doors and rewards", () => {
  const source =
    "mainWorld: world\ntimeZone: America/Los_Angeles\nevents:\n  - {id: stormnight, firstDay: 10-28, lastDay: 10-31, title: Stormnight, doors: [authored-door], rewards: [authored-reward]}\n  - {id: winter_vigil, firstDay: 12-24, lastDay: 01-01}";
  const spawn: [number, number, number] = [0, 65, 0];
  const entry = {
    kind: "capture-content" as const,
    content: "seasonal" as const,
    source: "unused",
    target: "unused",
    spawn,
    sha256: "a".repeat(64),
  };
  const before = z
    .looseObject({ events: z.array(z.looseObject({ id: z.string() })) })
    .parse(Bun.YAML.parse(source));
  const rendered = Bun.YAML.parse(captureConfig(source, entry));
  expect(rendered).toEqual({
    ...before,
    events: [{ ...before.events[0], firstDay: "01-01", lastDay: "12-31" }],
  });
  expect(Bun.YAML.parse(source)).toEqual(before);
  expect(() => captureConfig("events: []", entry)).toThrow("lacks Stormnight");
});

it("keeps public hub destinations only when their authentic worlds are imported", () => {
  const spawn: [number, number, number] = [0, 64, 0];
  const source = {
    sha256: "a".repeat(64),
    files: 7,
    bytes: 100,
    dimensions: [
      "minecraft:overworld",
      "minecraft:creative",
      "minecraft:frontier",
      "minecraft:skylands",
      "minecraft:map2",
    ],
  };
  expect(captureModules(["public-hub"], source)).toEqual([
    "creative",
    "stargates",
  ]);
  for (const missing of source.dimensions.slice(1))
    expect(() =>
      captureModules(["public-hub"], {
        ...source,
        dimensions: source.dimensions.filter((d) => d !== missing),
      }),
    ).toThrow("requires imported");
  for (const content of ["travel", "stargates"] as const) {
    const config =
      content === "travel"
        ? "destinations: [{id: skylands, world: skylands}]\nportals: []"
        : "serverGates: [{id: welcome-world-gate}]";
    const entry = {
      kind: "capture-content" as const,
      content,
      source: "unused",
      target: "unused",
      spawn,
      sha256: source.sha256,
    };
    expect(
      Bun.YAML.parse(captureConfig(config, { ...entry, publicHub: true })),
    ).toEqual(Bun.YAML.parse(config));
    expect(Bun.YAML.parse(captureConfig(config, entry))).not.toEqual(
      Bun.YAML.parse(config),
    );
  }
  const worldEntry = {
    kind: "capture-content" as const,
    content: "world" as const,
    source: "unused",
    target: "unused",
    spawn,
    sha256: source.sha256,
    additionalWorlds: ["frontier", "map2", "rwf"],
  };
  expect(
    Bun.YAML.parse(
      captureConfig("worlds: []\nborders: []", {
        ...worldEntry,
        publicHub: true,
      }),
    ),
  ).toMatchObject({
    worlds: [
      { name: "world", rtp: true },
      { name: "frontier", rtp: true },
      { name: "map2", rtp: false },
      { name: "rwf", rtp: false },
    ],
  });
});

it("places returning and first-time players at the imported map's selected landing point", () => {
  const actual = Bun.YAML.parse(
    captureConfig(
      "spawn: {world: world, x: 6.5, y: 73, z: 118.5}\nnewcomerSpawn: {world: world, x: 6.5, y: 73, z: 118.5}\nhomeLimit: 4",
      {
        kind: "capture-content",
        content: "essentials",
        source: "unused",
        target: "unused",
        spawn: [201.5, 71, -401.5],
        sha256: "a".repeat(64),
      },
    ),
  );
  const landing = {
    world: "world",
    x: 201.5,
    y: 71,
    z: -401.5,
    yaw: 0,
    pitch: 0,
  };
  expect(actual).toMatchObject({
    spawn: landing,
    newcomerSpawn: landing,
    homeLimit: 4,
  });
});

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
    "minecraft:overworld": {
      "adjust-spawn": false,
      "read-only": { "legacy-world-name": "world" },
    },
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
  ).toMatchObject({ enabled: false });
});
