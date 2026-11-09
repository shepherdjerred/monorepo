import { expect, it } from "vitest";
import { createLookAt, fixtureAim } from "#src/capture/camera.ts";
import { ClientStateSchema } from "#protocol/client.ts";
import { connectedState } from "#test/fake-client.ts";
it("aims at the panel of thin wall controls instead of empty cell centres", () => {
  expect(
    fixtureAim(
      [3, 75, 111],
      "minecraft:stone_button[face=wall,facing=south,powered=false]",
    ),
  ).toEqual([3.5, 75.5, 111.0625]);
  expect(
    fixtureAim(
      [3, 75, 111],
      "minecraft:stone_button[face=wall,facing=north,powered=false]",
    ),
  ).toEqual([3.5, 75.5, 111.9375]);
  expect(
    fixtureAim(
      [3, 75, 111],
      "minecraft:oak_button[face=floor,facing=north,powered=false]",
    ),
  ).toEqual([3.5, 75.0625, 111.5]);
  expect(
    fixtureAim(
      [3, 75, 111],
      "minecraft:stone_button[face=ceiling,facing=north,powered=false]",
    ),
  ).toEqual([3.5, 75.9375, 111.5]);
  expect(
    fixtureAim(
      [3, 75, 111],
      "minecraft:birch_wall_sign[facing=south,waterlogged=false]",
    ),
  ).toEqual([3.5, 75.5, 111.0625]);
  expect(fixtureAim([3, 75, 111], "minecraft:stone")).toEqual([
    3.5, 75.5, 111.5,
  ]);
});

const state = (renderedFrames: number) =>
  ClientStateSchema.parse({
    ...connectedState(0, 0),
    renderedFrames,
    eyeHeight: 1.62,
  });

it("waits for raycast frames rendered after the look RPC even when transport latency advanced the counter", async () => {
  let frame = 100;
  const look = createLookAt(
    async () => state(frame),
    async () => {
      frame = 110;
    },
    async (_description, ready) => {
      expect(ready(state(110))).toBe(false);
      expect(ready(state(112))).toBe(false);
      expect(ready(state(113))).toBe(true);
      return state(113);
    },
  );
  await look([3.5, 75.5, 111.5]);
});
