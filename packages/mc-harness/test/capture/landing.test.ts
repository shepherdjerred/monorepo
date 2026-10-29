import { expect, it } from "vitest";
import type { z } from "zod";
import { assertLanding } from "#src/capture/landing.ts";

function terrain(states: string[]) {
  const bytes = Buffer.alloc(states.length * 4);
  states.forEach((_, index) => bytes.writeUInt32LE(index, index * 4));
  return {
    world: <T extends z.ZodType>(schema: T): Promise<z.infer<T>> =>
      Promise.resolve(
        schema.parse({
          world: "world",
          min: { x: 0, y: 63, z: 0 },
          max: { x: 0, y: 65, z: 0 },
          size: { x: 1, y: 3, z: 1 },
          palette: states,
          blocks: bytes.toString("base64"),
          blockEntities: [],
        }),
      ),
  };
}

it("admits solid ground and a clear player body", async () => {
  await expect(
    assertLanding(
      terrain(["minecraft:stone", "minecraft:air", "minecraft:air"]),
      "world",
      [0, 64, 0],
    ),
  ).resolves.toBeUndefined();
});

it("requires ground unless restoring a flying origin", async () => {
  const air = terrain(["minecraft:air", "minecraft:air", "minecraft:air"]);
  await expect(assertLanding(air, "world", [0, 64, 0])).rejects.toThrow(
    "safe ground",
  );
  await expect(
    assertLanding(air, "world", [0, 64, 0], true),
  ).resolves.toBeUndefined();
});

it("rejects foliage intersecting a player even when flight is allowed", async () => {
  await expect(
    assertLanding(
      terrain([
        "minecraft:stone",
        "minecraft:oak_leaves[distance=2,persistent=false,waterlogged=false]",
        "minecraft:air",
      ]),
      "world",
      [0, 64, 0],
      true,
    ),
  ).rejects.toThrow("clearance");
});

it("rejects incomplete landing data", async () => {
  await expect(
    assertLanding(
      terrain(["minecraft:stone", "minecraft:air"]),
      "world",
      [0, 64, 0],
    ),
  ).rejects.toThrow("incomplete");
});
