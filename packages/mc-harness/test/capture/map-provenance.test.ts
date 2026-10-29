import { it, expect } from "vitest";
import { isImportedWorld } from "#sandbox/map-provenance.ts";
import { InfoResponseSchema } from "#protocol/bridge.ts";

it("admits saved creative terrain but refuses generated auxiliary dimensions", () => {
  const source = {
    sha256: "a".repeat(64),
    files: 3,
    bytes: 1000,
    dimensions: ["minecraft:overworld", "minecraft:creative"],
  };
  const server = InfoResponseSchema.parse({
    apiVersion: 1,
    bridgeVersion: "test",
    minecraftVersion: "26.3",
    serverVersion: "test",
    dataVersion: 5023,
    onlineMode: false,
    plugins: [],
    capabilities: [],
    worlds: [
      {
        name: "world",
        key: "minecraft:overworld",
        environment: "NORMAL",
        minY: -64,
        maxY: 319,
      },
      {
        name: "creative",
        key: "minecraft:creative",
        environment: "NORMAL",
        minY: -64,
        maxY: 319,
      },
      {
        name: "skylands",
        key: "minecraft:skylands",
        environment: "NORMAL",
        minY: -64,
        maxY: 319,
      },
    ],
  });
  expect(isImportedWorld(source, "creative", server)).toBe(true);
  expect(isImportedWorld(source, "skylands", server)).toBe(false);
  expect(isImportedWorld(source, "creative", null)).toBe(false);
  expect(
    isImportedWorld(
      { sha256: source.sha256, files: 3, bytes: 1000 },
      "creative",
      server,
    ),
  ).toBe(false);
  expect(isImportedWorld(undefined, "world", server)).toBe(false);
});
