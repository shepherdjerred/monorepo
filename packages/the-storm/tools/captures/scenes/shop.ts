import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";

export default defineCaptureScene({
  name: "shop-owner-test",
  description:
    "Stock a player shop and verify its supported owner-testing transaction",
  bounds: { min: [0, -1, 0], max: [6, 3, 6] },
  staging: [-3, 0, -3],
  inspectors: ["wilderness", "shops", "banks", "stargates"],
  setup: async (context) => {
    await context.track("shopkeeper", 1);
    await context.command(`minecraft:gamemode creative ${context.name}`);
    await context.set(
      context.at(0, -1, 0),
      context.at(6, -1, 6),
      "minecraft:stone_bricks",
    );
    await context.set(
      context.at(3, 0, 3),
      context.at(3, 0, 3),
      "minecraft:barrel[facing=north]",
    );
    await context.teleport(context.at(3.5, 0, 0.5), 0, 0);
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:oak_sign`,
    );
    await context.action("hotbar", { slot: 0 });
    await context.lookAt(context.at(3.5, 0.5, 3));
    await context.defer({
      kind: "break",
      position: context.at(3, 0, 2),
      standing: context.at(3.5, 0, 0.5),
    });
    await context.use(true);
    await context.sign(["", "16", "B 50:S 40", "oak_planks"]);
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.1 with minecraft:oak_planks 32`,
    );
    await context.teleport(context.at(3.5, 0, 5.5), 180, 0);
    await context.lookAt(context.at(3.5, 0.5, 3.5));
    await context.use();
    await context.waitFor(
      "shop stock inventory",
      (state) =>
        state.connected &&
        typeof state["containerId"] === "number" &&
        state["containerId"] > 0,
    );
    await context.transfer("minecraft:oak_planks", "inventory");
    await context.action("close");
    await context.shopAccess(true);
  },
  run: async (context) => {
    await context.teleport(context.at(3.5, 0, 0.5), 0, 0);
    await context.lookAt(context.at(3.5, 0.5, 2.5));
    const before = await context.status();
    if (!before.connected) throw new Error("Shop client disconnected");
    const count = before.inventory
      .filter((item) => item.type === "minecraft:oak_planks")
      .reduce((sum, item) => sum + item.count, 0);
    await context.record(
      {
        schema: 1,
        name: "shop-owner-test",
        alt: "The owner tests a stocked shop with shop access enabled",
        caption:
          "Owner-testing mode checks item movement without a payment to yourself.",
        annotations: [],
      },
      async () => {
        await context.use();
        await context.waitFor(
          "sixteen planks delivered",
          (state) =>
            state.connected &&
            state.inventory
              .filter((item) => item.type === "minecraft:oak_planks")
              .reduce((sum, item) => sum + item.count, 0) ===
              count + 16,
        );
      },
      8,
    );
  },
});
