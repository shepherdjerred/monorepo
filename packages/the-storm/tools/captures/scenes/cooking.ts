import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";

export default defineCaptureScene({
  name: "cooking-pot",
  description:
    "Build and use a cooking pot in wilderness, then restore the site",
  bounds: { min: [0, -1, 0], max: [6, 3, 6] },
  staging: [-3, 0, -3],
  inspectors: ["wilderness", "shops", "banks", "stargates"],
  setup: async (context) => {
    await context.track("mechanic", 1);
    await context.command(`minecraft:gamemode creative ${context.name}`);
    await context.set(
      context.at(0, -1, 0),
      context.at(6, -1, 6),
      "minecraft:stone_bricks",
    );
    await context.set(
      context.at(3, 0, 3),
      context.at(3, 0, 3),
      "minecraft:magma_block",
    );
    await context.set(
      context.at(3, 1, 3),
      context.at(3, 1, 3),
      "minecraft:stone",
    );
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:oak_sign`,
    );
    await context.action("hotbar", { slot: 0 });
    await context.teleport(context.at(3.5, 0, 0.5), 0, 0);
    await context.lookAt(context.at(3.5, 1.5, 3));
    await context.use();
    await context.defer({
      kind: "break",
      position: context.at(3, 1, 2),
      standing: context.at(3.5, 0, 0.5),
    });
    await context.sign(["", "[Cook]", "", ""]);
    await context.action("close");
  },
  run: async (context) => {
    await context.lookAt(context.at(3.5, 1.5, 2.5));
    await context.capture({
      schema: 1,
      name: "cooking-pot",
      alt: "A cooking-pot sign on stone above a magma block in the wilderness",
      caption: "The sign sits on a solid block above the heat source.",
      annotations: [
        {
          kind: "arrow",
          from: [0.65, 0.25],
          to: [0.5, 0.5],
          text: "Cooking-pot sign",
          startMs: 0,
          endMs: 12_000,
        },
      ],
    });
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:porkchop 1`,
    );
    await context.use();
    await context.waitFor(
      "cooked food",
      (state) =>
        state.connected &&
        state.inventory.some(
          (item) =>
            item.type === "minecraft:cooked_porkchop" && item.count >= 1,
        ),
    );
  },
});
