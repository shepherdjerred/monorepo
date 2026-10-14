import path from "node:path";
import { describe, expect, test } from "vitest";
import { z as schema } from "zod";
import { readSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { galleries, lobbyWithAnnex } from "./lobby.ts";

describe("War Room annex", () => {
  test("preserves original geometry outside two documented entrances and all old functional places", async () => {
    const { grid, original } = await lobbyWithAnnex();
    let changes = 0;
    original.grid.forEach((x, y, z, state) => {
      if (grid.get(x, y, z) === state) return;
      changes++;
      expect(
        ((x === 106 && y === 6) || (x === 107 && y === 5)) &&
          ((z >= 20 && z <= 24) || (z >= 76 && z <= 80)),
      ).toBe(true);
    });
    expect(changes).toBe(20);
    const originalMetadata = schema
      .record(schema.string(), schema.unknown())
      .parse(
        Bun.YAML.parse(
          await Bun.file(path.join(import.meta.dir, "lobby/base.yml")).text(),
        ),
      );
    const shipped = schema
      .record(schema.string(), schema.unknown())
      .parse(
        Bun.YAML.parse(
          await Bun.file(
            path.resolve(
              import.meta.dir,
              "../../server/owned/plugins/TheStorm/rwf/lobby/lobby.yml",
            ),
          ).text(),
        ),
      );
    for (const key of [
      "spawn",
      "sides",
      "rotation",
      "podiums",
      "leaderboards",
      "rules",
      "board",
      "balcony",
    ])
      expect(shipped[key]).toEqual(originalMetadata[key]);
    const Alcoves = schema.array(
      schema
        .object({
          kit: schema.string(),
          stand: schema.object({
            x: schema.number(),
            y: schema.number(),
            z: schema.number(),
          }),
        })
        .loose(),
    );
    const oldAlcoves = Alcoves.parse(originalMetadata["alcoves"]);
    const newAlcoves = Alcoves.parse(shipped["alcoves"]);
    expect(newAlcoves.slice(0, 33)).toEqual(oldAlcoves);
    expect(newAlcoves.map((alcove) => alcove.kit)).toEqual([
      ...oldAlcoves.map((alcove) => alcove.kit),
      ...galleries.flat(),
    ]);
    expect(new Set(newAlcoves.map((alcove) => alcove.kit)).size).toBe(51);
    const installed = await readSchematic(
      new Uint8Array(
        await Bun.file(
          path.resolve(
            import.meta.dir,
            "../../server/owned/plugins/TheStorm/rwf/lobby/blocks.schem",
          ),
        ).arrayBuffer(),
      ),
    );
    expect(grid.diff(installed.grid).count).toBe(0);
    for (const { stand } of newAlcoves.slice(33)) {
      const [x, y, z] = [
        Math.floor(stand.x),
        Math.floor(stand.y) - 64,
        Math.floor(stand.z),
      ];
      expect(grid.get(x, y - 1, z)).not.toBe("minecraft:air");
      expect(grid.get(x, y, z)).toBe("minecraft:air");
      expect(grid.get(x, y + 1, z)).toBe("minecraft:air");
    }
  }, 120_000);
});
