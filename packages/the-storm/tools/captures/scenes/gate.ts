import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { pad, wallSign, camera, waitBlock, inspectors } from "./fixtures.ts";

export default defineCaptureScene({
  name: "moving-gate",
  description: "Raise and lower a three-column oak fence gate",
  bounds: { min: [0, -1, 0], max: [8, 7, 7] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    await context.track("mechanic", 2);
    await pad(context, [8, 7, 7]);
    for (const x of [2, 6])
      await context.set(
        context.at(x, 0, 4),
        context.at(x, 5, 4),
        "minecraft:stone_bricks",
      );
    await context.set(
      context.at(2, 6, 4),
      context.at(6, 6, 4),
      "minecraft:stone_bricks",
    );
    await context.set(
      context.at(3, 0, 4),
      context.at(5, 5, 4),
      "minecraft:oak_fence[east=true,north=false,south=false,waterlogged=false,west=true]",
    );
    await wallSign(context, {
      position: [2, 2, 3],
      standing: [2.5, 0, 0.5],
      lines: ["Gate", "[Gate]", "", ""],
    });
    await context.feedback("Built.");
  },
  run: async (context) => {
    await camera(context, [-2.5, 0, -2.5], [4.5, 2.5, 4.5]);
    await context.capture({
      schema: 1,
      name: "gate-closed",
      alt: "A closed three-wide oak fence gate between stone posts",
      caption: "Each fence column reaches the ground when the gate is closed.",
      annotations: [],
    });
    await camera(context, [2.5, 0, 0.5], [2.5, 2.5, 3.9]);
    await context.use();
    await waitBlock(context, [4, 2, 4], (block) => block === "minecraft:air");
    await camera(context, [-2.5, 0, -2.5], [4.5, 2.5, 4.5]);
    await context.capture({
      schema: 1,
      name: "gate-open",
      alt: "The raised gate leaves an open passage while the top fence row stays in place",
      caption:
        "Opening the gate removes the lower fences and keeps the top of each column.",
      annotations: [],
    });
    await camera(context, [2.5, 0, 0.5], [2.5, 2.5, 3.9]);
    await context.use();
    await waitBlock(context, [4, 2, 4], (block) =>
      block.startsWith("minecraft:oak_fence["),
    );
  },
});
