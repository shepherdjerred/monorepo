import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";

export default defineCaptureScene({
  name: "elevator",
  description: "Travel between two real elevator signs and restore both floors",
  bounds: { min: [0, -1, 0], max: [6, 6, 6] },
  staging: [-3, 0, -3],
  inspectors: ["wilderness", "shops", "banks", "stargates"],
  setup: async (context) => {
    await context.track("mechanic", 2);
    await context.command(`minecraft:gamemode creative ${context.name}`);
    await context.set(
      context.at(0, -1, 0),
      context.at(6, -1, 6),
      "minecraft:stone_bricks",
    );
    await context.set(
      context.at(2, 3, 0),
      context.at(4, 3, 1),
      "minecraft:stone_bricks",
    );
    for (const height of [0, 4]) {
      await context.set(
        context.at(3, height + 1, 3),
        context.at(3, height + 1, 3),
        "minecraft:stone",
      );
      await context.teleport(context.at(3.5, height, 0.5), 0, 0);
      await context.command(
        `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:oak_sign`,
      );
      await context.action("hotbar", { slot: 0 });
      await context.lookAt(context.at(3.5, height + 1.5, 3));
      await context.use();
      await context.defer({
        kind: "break",
        position: context.at(3, height + 1, 2),
        standing: context.at(3.5, height, 0.5),
      });
      await context.sign([
        height === 0 ? "Ground" : "Upper",
        height === 0 ? "[Lift Up]" : "[Lift Down]",
        "",
        "",
      ]);
    }
  },
  run: async (context) => {
    await context.teleport(context.at(3.5, 0, 0.5), 0, 0);
    await context.lookAt(context.at(3.5, 1.5, 2.5));
    await context.capture({
      schema: 1,
      name: "elevator-lower",
      alt: "The lower elevator sign in the wilderness",
      caption: "Right-click Lift Up to reach the aligned upper stop.",
      annotations: [
        {
          kind: "arrow",
          from: [0.7, 0.25],
          to: [0.5, 0.5],
          text: "Lower stop",
          startMs: 0,
          endMs: 12_000,
        },
      ],
    });
    const base = context.at(0, 0, 0)[1];
    await context.record(
      {
        schema: 1,
        name: "elevator-travel",
        alt: "Using the elevator to travel up and return to ground level",
        caption: "The signs move the player between aligned stops.",
        annotations: [],
      },
      async () => {
        await context.use();
        await context.waitFor(
          "upper stop",
          (state) =>
            state.connected && Math.abs(state.position[1] - (base + 4)) < 0.2,
        );
        await context.lookAt(context.at(3.5, 5.5, 2.5));
        await context.use();
        await context.waitFor(
          "ground stop",
          (state) =>
            state.connected && Math.abs(state.position[1] - base) < 0.2,
        );
      },
      8,
    );
  },
});
