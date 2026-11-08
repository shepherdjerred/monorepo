import { expect, it } from "vitest";
import type { z } from "zod";
import { assertLanding, assertOriginWorld } from "#src/capture/landing.ts";

it("rejects an origin in another world before it can be checkpointed", () => {
  expect(() =>
    assertOriginWorld(
      { world: "minecraft:the_nether", screen: "" },
      "minecraft:overworld",
    ),
  ).toThrow("fixture world before checkpointing");
  expect(() =>
    assertOriginWorld(
      { world: "minecraft:overworld", screen: "" },
      "minecraft:overworld",
    ),
  ).not.toThrow();
});

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

it("admits the real lobby's smooth stone but refuses partial or hazardous surfaces", async () => {
  await expect(
    assertLanding(
      terrain(["minecraft:smooth_stone", "minecraft:air", "minecraft:air"]),
      "rwf_lobby",
      [31.5, 70, 31.5],
    ),
  ).resolves.toBeUndefined();
  for (const floor of [
    "minecraft:smooth_stone_slab[type=bottom,waterlogged=false]",
    "minecraft:magma_block",
    "minecraft:lava[level=0]",
  ])
    await expect(
      assertLanding(
        terrain([floor, "minecraft:air", "minecraft:air"]),
        "rwf_lobby",
        [31.5, 70, 31.5],
      ),
    ).rejects.toThrow("safe ground");
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
