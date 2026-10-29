import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";

export default defineCaptureScene({
  name: "moving-bridge",
  description: "Toggle a sign-controlled bridge over a small temporary trench",
  bounds: { min: [-1, -3, 0], max: [9, 3, 6] },
  staging: [-4, 0, -3],
  inspectors: ["wilderness", "shops", "banks", "stargates"],
  setup: async (context) => {
    await context.track("mechanic", 2);
    await context.command(`minecraft:gamemode creative ${context.name}`);
    await context.set(
      context.at(-1, -1, 0),
      context.at(9, -1, 6),
      "minecraft:stone_bricks",
    );
    await context.set(
      context.at(2, -2, 3),
      context.at(6, 0, 3),
      "minecraft:air",
    );
    for (const [x, standing] of [
      [1, -0.5],
      [7, 8.5],
    ]) {
      if (x === undefined || standing === undefined)
        throw new Error("Missing bridge endpoint");
      await context.set(
        context.at(x, 0, 3),
        context.at(x, 0, 3),
        "minecraft:oak_planks",
      );
      await context.teleport(context.at(standing, 0, 3.5), 0, 0);
      await context.command(
        `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:oak_sign`,
      );
      await context.action("hotbar", { slot: 0 });
      await context.lookAt(context.at(x + 0.5, 0.99, 3.5));
      await context.use();
      await context.defer({
        kind: "break",
        position: context.at(x, 1, 3),
        standing: context.at(standing, 0, 3.5),
      });
      await context.sign(["", "[Bridge]", "", ""]);
    }
  },
  run: async (context) => {
    await context.teleport(context.at(-0.5, 0, 3.5), -90, 0);
    await context.lookAt(context.at(1.5, 1.5, 3.5));
    await context.record(
      {
        schema: 1,
        name: "moving-bridge",
        alt: "A sign-controlled bridge opens and closes over a trench",
        caption: "Right-click either Bridge sign to toggle the moving section.",
        annotations: [],
      },
      async () => {
        await context.use();
        if (
          (await context.block(context.at(4, 0, 3))) !== "minecraft:oak_planks"
        )
          throw new Error("Bridge did not extend");
        await context.capture({
          schema: 1,
          name: "bridge-state",
          alt: "Bridge planks span the five spaces between its ends",
          caption: "The matching ends define the moving section.",
          annotations: [],
        });
        await context.use();
        if ((await context.block(context.at(4, 0, 3))) !== "minecraft:air")
          throw new Error("Bridge did not retract");
      },
      8,
    );
  },
});
