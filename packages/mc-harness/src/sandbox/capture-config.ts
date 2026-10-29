import { z } from "zod";
import type { StagedEntry } from "#sandbox/profiles.ts";

type Entry = Extract<StagedEntry, { kind: "capture-content" }>;

/** Local reservations describe this copy, never production holdings on unrelated terrain. */
export function captureConfig(source: string, entry: Entry): string {
  const parsed = z
    .record(z.string(), z.unknown())
    .parse(Bun.YAML.parse(source));
  const [x, y, zz] = entry.spawn;
  switch (entry.content) {
    case "arena-survival": {
      const arena = z.object({ world: z.string() }).parse(parsed["arena"]);
      return Bun.YAML.stringify({
        ...parsed,
        enabled:
          parsed["enabled"] === true &&
          (entry.additionalWorlds ?? []).includes(arena.world),
      });
    }
    case "multiverse":
      return Bun.YAML.stringify(
        Object.fromEntries(
          (entry.additionalWorlds ?? []).map((name) => [
            `minecraft:${name}`,
            {
              "auto-load": true,
              biome: "",
              generator: "",
              "adjust-spawn": false,
              "keep-spawn-in-memory": false,
              gamemode: "survival",
              "read-only": {
                environment: "normal",
                "generator-settings": "",
                "legacy-world-name": name,
              },
              version: 1.3,
            },
          ]),
        ),
      );
    case "world":
      return Bun.YAML.stringify({
        ...parsed,
        worlds: [
          { name: "world", preset: "normal", rtp: true },
          ...(entry.additionalWorlds ?? []).map((name) => ({
            name,
            preset: "normal",
            rtp: false,
          })),
        ],
        borders: [
          {
            world: "world",
            centerX: 0,
            centerZ: 0,
            size: 14_000,
            shape: "circle",
          },
        ],
      });
    case "shards": {
      const drops = z
        .looseObject({ worlds: z.array(z.string()) })
        .parse(parsed["drops"]);
      const loaded = new Set([
        "minecraft:overworld",
        "minecraft:the_nether",
        "minecraft:the_end",
        ...(entry.additionalWorlds ?? []).map((name) => `minecraft:${name}`),
      ]);
      return Bun.YAML.stringify({
        ...parsed,
        drops: {
          ...drops,
          worlds: drops.worlds.filter((world) => loaded.has(world)),
        },
      });
    }
    case "travel":
      return Bun.YAML.stringify({
        ...parsed,
        destinations: [
          {
            id: "local_map",
            label: "Local Map",
            description: "Isolated demonstration copy",
            world: "world",
            arrival: "rtp",
          },
        ],
        portals: [],
      });
    case "stargates":
      // Server hubs refer to realms omitted from the disposable import.
      // Player-built networks retain their ordinary configuration.
      return Bun.YAML.stringify({ ...parsed, serverGates: [] });
    case "essentials":
      return Bun.YAML.stringify({
        ...parsed,
        spawn: { world: "world", x, y, z: zz, yaw: 0, pitch: 0 },
      });
    case "parcels":
      return Bun.YAML.stringify({ ...parsed, parcels: [] });
    case "towns": {
      const claims = z.record(z.string(), z.unknown()).parse(parsed["claims"]);
      return Bun.YAML.stringify({
        ...parsed,
        claims: { ...claims, worlds: ["world", "skylands"] },
        regions: [],
      });
    }
    case "heritage":
      return Bun.YAML.stringify({
        schemaVersion: 2,
        archives: [
          {
            id: "local-capture-map",
            sha256: entry.sha256,
            world: "world",
            spawnSite: "capture-spawn",
          },
        ],
        sites: [
          {
            id: "capture-spawn",
            name: "Local capture spawn",
            kind: "SERVER",
            activeTownName: "",
            world: "world",
            profile: "SAFE",
            protectedChunks: [
              { x: Math.floor(x / 16), z: Math.floor(zz / 16) },
            ],
            protectedAreas: [],
            editingChunks: [],
            editors: [],
            provenance:
              "Local demonstration reservation on the imported map; no historical ownership is inferred.",
          },
        ],
      });
  }
}
