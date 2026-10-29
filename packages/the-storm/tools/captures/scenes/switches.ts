import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { pad, wallSign, camera, waitBlock, inspectors } from "./fixtures.ts";

export default defineCaptureScene({
  name: "hidden-and-light-switches",
  description: "Operate a hidden switch and toggle a bulb and candle together",
  // Include the light switch's complete eight-block search radius.
  bounds: { min: [-1, -7, -5], max: [15, 9, 11] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    await context.track("mechanic", 1);
    await pad(context, [9, 4, 7]);
    for (const x of [2, 7])
      await context.set(
        context.at(x, 0, 4),
        context.at(x, 2, 4),
        "minecraft:stone_bricks",
      );
    await context.set(
      context.at(3, 0, 3),
      context.at(3, 0, 3),
      "minecraft:stone_bricks",
    );
    await context.set(
      context.at(3, 1, 3),
      context.at(3, 1, 3),
      "minecraft:lever[face=floor,facing=north,powered=false]",
    );
    for (const x of [5, 8])
      await context.set(
        context.at(x, 0, 4),
        context.at(x, 0, 4),
        "minecraft:stone_bricks",
      );
    await context.set(
      context.at(5, 1, 4),
      context.at(5, 1, 4),
      "minecraft:waxed_copper_bulb[lit=false,powered=false]",
    );
    await context.set(
      context.at(8, 1, 4),
      context.at(8, 1, 4),
      "minecraft:candle[candles=1,lit=false,waterlogged=false]",
    );
    await wallSign(context, {
      position: [2, 1, 3],
      standing: [2.5, 0, 0.5],
      lines: ["Hidden switch", "[X]", "", ""],
    });
    await context.feedback("Built.");
    await wallSign(context, {
      position: [7, 1, 3],
      standing: [7.5, 0, 0.5],
      lines: ["Lights", "[|]", "", ""],
    });
    await context.feedback("Built.");
  },
  run: async (context) => {
    await camera(context, [2.5, 0, 6.5], [2.5, 1.5, 4.99]);
    await context.use();
    await waitBlock(
      context,
      [3, 1, 3],
      (block) =>
        block.startsWith("minecraft:lever[") && block.includes("powered=true"),
    );
    await camera(context, [2.5, 0, 0.5], [2.9, 1.5, 3.5]);
    await context.capture({
      schema: 1,
      name: "hidden-switch",
      alt: "An X sign on the hidden side of a block with an adjacent powered lever",
      caption:
        "Click the opposite face of the supporting block to toggle the lever beside the sign.",
      annotations: [],
    });
    await camera(context, [6.5, 0, 0.5], [6.8, 1.35, 4]);
    await context.capture({
      schema: 1,
      name: "lights-off",
      alt: "An unlit copper bulb and candle beside their light-switch sign",
      caption: "The supported lights start off.",
      annotations: [],
    });
    await context.lookAt(context.at(7.5, 1.5, 3.5));
    await context.use();
    await context.feedback("Lights on.");
    for (const x of [5, 8])
      await waitBlock(context, [x, 1, 4], (block) =>
        block.includes("lit=true"),
      );
    await camera(context, [6.5, 0, 0.5], [6.8, 1.35, 4]);
    await context.capture({
      schema: 1,
      name: "lights-on",
      alt: "The same copper bulb and candle lit together by the light-switch sign",
      caption: "One sign switches both nearby lights on together.",
      annotations: [],
    });
  },
});
