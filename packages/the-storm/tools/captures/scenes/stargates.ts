import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";

export default defineCaptureScene({
  name: "player-stargates",
  description:
    "Create a private pair of Stargates, travel, and remove the private network",
  bounds: { min: [0, -1, 0], max: [7, 5, 14] },
  staging: [-3, 0, -3],
  inspectors: ["wilderness", "shops", "banks", "stargates"],
  setup: async (context) => {
    await context.track("mechanic", 3);
    await context.command(`minecraft:gamemode creative ${context.name}`);
    const network = `cap-${context.id.replaceAll("-", "").slice(-10)}`;
    await context.defer({
      kind: "resource",
      resource: "stargate-network",
      id: network,
    });
    await context.playerCommand(
      `stargate network create private ${network}`,
      `Created network ${network}.`,
    );
    await context.set(
      context.at(0, -1, 0),
      context.at(7, -1, 14),
      "minecraft:stone_bricks",
    );
    for (const zz of [3, 10]) {
      await context.set(
        context.at(2, 0, zz - 3),
        context.at(5, 0, zz - 1),
        "minecraft:stone_bricks",
      );
      for (const y of [0, 4])
        await context.set(
          context.at(3, y, zz),
          context.at(4, y, zz),
          "minecraft:obsidian",
        );
      for (const x of [2, 5])
        await context.set(
          context.at(x, 1, zz),
          context.at(x, 3, zz),
          "minecraft:obsidian",
        );
      await context.set(
        context.at(5, 2, zz - 1),
        context.at(5, 2, zz - 1),
        "minecraft:stone_button[face=wall,facing=north,powered=false]",
      );
      await context.teleport(context.at(2.5, 1, zz - 2.5), 0, 0);
      await context.command(
        `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:oak_sign`,
      );
      await context.action("hotbar", { slot: 0 });
      await context.lookAt(context.at(2.5, 2.5, zz));
      await context.defer({
        kind: "break",
        position: context.at(2, 2, zz - 1),
        standing: context.at(2.5, 1, zz - 2.5),
      });
      await context.use();
      const name = zz === 3 ? "Home" : "Mine";
      await context.sign([name, "", network, ""]);
      await context.feedback(`Stargate ${name} created.`);
    }
  },
  run: async (context) => {
    await context.teleport(context.at(3.5, 1, 0.5), 0, 0);
    await context.lookAt(context.at(2.5, 2.5, 2.5));
    await context.use();
    await context.capture({
      schema: 1,
      name: "player-stargate",
      alt: "A player-built Stargate with a selected destination",
      caption:
        "Select a destination on the sign, then press the button to open the gate.",
      annotations: [],
    });
    await context.record(
      {
        schema: 1,
        name: "player-stargate-travel",
        alt: "Opening and walking through a player-built Stargate",
        caption: "The private network connects Home and Mine.",
        annotations: [],
      },
      async () => {
        await context.lookAt(context.at(5.5, 2.5, 2.5));
        await context.use();
        await context.lookAt(context.at(3.5, 2.62, 3.5));
        await context.action("move", { buttons: ["forward"], ticks: 20 });
        const threshold = context.at(0, 0, 6)[2];
        await context.waitFor(
          "arrival at Mine",
          (state) => state.connected && state.position[2] > threshold,
        );
      },
      10,
    );
  },
});
