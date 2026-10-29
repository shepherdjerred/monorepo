import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { pad, camera, inspectors } from "./fixtures.ts";

export default defineCaptureScene({
  name: "painting-selection",
  description: "Cycle a real painting without changing its size",
  bounds: { min: [0, -1, 0], max: [8, 5, 7] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    if (context.target === "live")
      throw new Error("Painting fixtures require an isolated map copy");
    await context.track("mechanic", 3);
    await pad(context, [8, 5, 7]);
    await context.set(
      context.at(2, 0, 4),
      context.at(6, 4, 4),
      "minecraft:stone_bricks",
    );
    const position = context.at(4, 2, 3);
    const tag = context.id;
    await context.prepare(
      `minecraft:summon minecraft:painting ${position.join(" ")} {Tags:["${tag}"],variant:"minecraft:match",facing:2b,block_pos:[I;${position.join(",")}]}`,
      {
        kind: "command",
        command: `minecraft:kill @e[type=minecraft:painting,tag=${tag}]`,
      },
    );
  },
  run: async (context) => {
    await camera(context, [4, 0, 1.5], [4, 3, 3.9]);
    const before = await context.waitFor(
      "painting under crosshair",
      (state) =>
        state.connected &&
        state.target.kind === "entity" &&
        state.target["type"] === "minecraft:painting",
    );
    if (!before.connected || typeof before.target["variant"] !== "string")
      throw new Error("Missing painting variant observation");
    const original = before.target["variant"];
    await context.capture({
      schema: 1,
      name: "painting-before",
      alt: "A two-by-two painting mounted on a stone wall",
      caption: "Right-click to select another picture of the same size.",
      annotations: [],
    });
    await context.use();
    await context.waitFor(
      "a different painting",
      (state) =>
        state.connected &&
        state.target["type"] === "minecraft:painting" &&
        state.target["variant"] !== original,
    );
    await context.capture({
      schema: 1,
      name: "painting-after",
      alt: "A different two-by-two painting on the same wall",
      caption: "The picture changes while its dimensions stay the same.",
      annotations: [],
    });
  },
});
