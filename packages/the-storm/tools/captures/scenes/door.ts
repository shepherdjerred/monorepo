import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { pad, wallSign, camera, waitBlock, inspectors } from "./fixtures.ts";

export default defineCaptureScene({
  name: "moving-door",
  description: "Open and close a three-block sign-controlled door",
  bounds: { min: [0, -1, 0], max: [7, 7, 6] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    await context.track("mechanic", 2);
    await pad(context, [7, 7, 6]);
    for (const x of [2, 4])
      await context.set(
        context.at(x, 0, 3),
        context.at(x, 6, 3),
        "minecraft:stone_bricks",
      );
    for (const y of [0, 6])
      await context.set(
        context.at(3, y, 4),
        context.at(3, y, 4),
        "minecraft:stone_bricks",
      );
    for (const y of [1, 5])
      await context.set(
        context.at(3, y, 3),
        context.at(3, y, 3),
        "minecraft:oak_planks",
      );
    await wallSign(context, {
      position: [3, 0, 3],
      standing: [3.5, 0, 0.5],
      lines: ["", "[Door Up]", "", ""],
    });
    await context.feedback("Built.");
    await context.set(
      context.at(3, 4, 0),
      context.at(3, 4, 1),
      "minecraft:stone_bricks",
    );
    await wallSign(context, {
      position: [3, 6, 3],
      standing: [3.5, 5, 0.5],
      lines: ["", "[Door Down]", "", ""],
    });
    await context.feedback("Built.");
    await context.set(
      context.at(3, 4, 0),
      context.at(3, 4, 1),
      "minecraft:air",
    );
    await context.teleport(context.at(3.5, 0, 0.5), 0, 0);
    await context.lookAt(context.at(3.5, 0.5, 3.9));
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:oak_planks 3`,
    );
    await context.action("hotbar", { slot: 0 });
    await context.use();
    await context.feedback("Added 3");
    await context.action("hotbar", { slot: 7 });
    await context.use();
    await waitBlock(
      context,
      [3, 3, 3],
      (block) => block === "minecraft:oak_planks",
    );
  },
  run: async (context) => {
    await camera(context, [3.5, 0, -3], [3.5, 3.5, 3.5]);
    await context.capture({
      schema: 1,
      name: "door-closed",
      alt: "Oak planks fill the moving section between the Door Up and Door Down ends",
      caption: "Matching signs and base blocks define the closed door.",
      annotations: [],
    });
    await camera(context, [3.5, 0, 0.5], [3.5, 0.5, 3.9]);
    await context.use();
    await waitBlock(context, [3, 3, 3], (block) => block === "minecraft:air");
    await camera(context, [3.5, 0, -3], [3.5, 3.5, 3.5]);
    await context.capture({
      schema: 1,
      name: "door-open",
      alt: "The three moving oak planks are removed, leaving an open doorway between the fixed ends",
      caption:
        "Opening the door stores its moving blocks for the next closing.",
      annotations: [],
    });
    await camera(context, [3.5, 0, 0.5], [3.5, 0.5, 3.9]);
    await context.use();
    await waitBlock(
      context,
      [3, 3, 3],
      (block) => block === "minecraft:oak_planks",
    );
  },
});
