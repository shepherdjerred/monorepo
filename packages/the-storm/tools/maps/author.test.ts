import path from "node:path";
import { describe, expect, test } from "vitest";
import { compileProgram } from "@shepherdjerred/mc-build/compile/runner.ts";
import {
  readSchematic,
  writeSchematic,
} from "@shepherdjerred/mc-build/core/schem.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { AuthoredMap, terrainHash } from "./author.ts";

const owned = path.resolve(
  import.meta.dir,
  "../../server/owned/plugins/TheStorm/rwf/maps",
);
const ids = [
  "copperworks",
  "tidewatch",
  "red-mesa",
  "frostline",
  "bamboo-bastion",
  "catacombs",
  "sunspire",
  "railcut",
  "overgrown-relay",
  "stormbreak",
];

describe("original arena export contracts", () => {
  test("terrain identity agrees with the Java-produced training fixture", async () => {
    const directory = path.join(owned, "training-yard");
    const schematic = await readSchematic(
      new Uint8Array(
        await Bun.file(path.join(directory, "blocks.schem")).arrayBuffer(),
      ),
    );
    const metadata: unknown = Bun.YAML.parse(
      await Bun.file(path.join(directory, "map.yml")).text(),
    );
    expect(metadata).toHaveProperty(
      "blocksSha256",
      terrainHash(schematic.grid),
    );
  });

  for (const id of ids)
    test(`${id} reproduces owned terrain and keeps deployment courts usable`, async () => {
      const map = AuthoredMap.parse(
        await Bun.file(
          path.join(import.meta.dir, "authored", `${id}.json`),
        ).json(),
      );
      const compile = () =>
        compileProgram({
          program: path.join(import.meta.dir, "authored", `${id}.ts`),
          seed: map.seed,
          anchor: map.anchor,
          site: null,
          timeoutMs: 120_000,
        });
      const first = await compile();
      const second = await compile();
      expect(first.grid.diff(second.grid).count).toBe(0);
      const registry = await loadRegistry();
      const decoded = await readSchematic(
        writeSchematic(first.grid, registry.dataVersion),
      );
      const shipped = await readSchematic(
        new Uint8Array(
          await Bun.file(path.join(owned, id, "blocks.schem")).arrayBuffer(),
        ),
      );
      expect(terrainHash(decoded.grid)).toBe(terrainHash(shipped.grid));
      expect(decoded.grid.size).toEqual(map.size);
      for (const at of map.bombs) {
        expect(decoded.grid.get(at.x, at.y, at.z)).toMatch(/^minecraft:tnt\[/u);
        expect(decoded.grid.get(at.x, at.y - 1, at.z)).not.toBe(
          "minecraft:air",
        );
        for (const dx of [-1, 1]) {
          expect(decoded.grid.get(at.x + dx, at.y, at.z)).toBe("minecraft:air");
          expect(decoded.grid.get(at.x + dx, at.y + 1, at.z)).toBe(
            "minecraft:air",
          );
        }
      }
      for (const at of map.nukes) {
        expect(decoded.grid.get(at.x, at.y, at.z)).toBe(
          "minecraft:tnt[unstable=false]",
        );
        expect(decoded.grid.get(at.x, at.y - 1, at.z)).not.toBe(
          "minecraft:air",
        );
        expect(decoded.grid.get(at.x, at.y + 1, at.z)).toBe("minecraft:air");
      }
      for (const x of [5, 7, map.size.x - 6, map.size.x - 8])
        for (const dz of [-6, -4, 4, 6]) {
          const z = Math.floor(map.size.z / 2) + dz;
          expect(decoded.grid.get(x, map.spawnY, z)).toBe("minecraft:air");
          expect(decoded.grid.get(x, map.spawnY + 1, z)).toBe("minecraft:air");
          expect(decoded.grid.get(x, map.spawnY - 1, z)).not.toBe(
            "minecraft:air",
          );
        }
      // Every straight spawn pair crosses the west court's opaque front screen.
      for (const from of [-6, -4, 4, 6])
        for (const to of [-6, -4, 4, 6]) {
          const fraction = (24 - 5) / (map.size.x - 6 - 5);
          const z = Math.floor(map.size.z / 2 + from + (to - from) * fraction);
          expect(decoded.grid.get(24, map.spawnY + 1, z)).not.toBe(
            "minecraft:air",
          );
        }
    }, 120_000);
});
