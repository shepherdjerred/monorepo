import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { pad, wallSign, camera, inspectors } from "./fixtures.ts";
import { localHelper } from "#captures/helper.ts";

export default defineCaptureScene({
  name: "customer-shop-trades",
  description:
    "Create four sign formats and complete paid customer trades with a second genuine player",
  bounds: { min: [0, -1, 0], max: [13, 4, 8] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    const helper = await localHelper(context);
    for (const permission of [
      "thestorm.shops.other.create.tsmcdemohelper",
      "thestorm.shops.admin",
    ])
      await context.prepare(
        `lp user ${context.name} permission set ${permission} true`,
        {
          kind: "command",
          command: `lp user ${context.name} permission unset ${permission}`,
        },
      );
    await context.playerCommand("balance", "Balance: 500 crystals");
    await helper.command("balance", "Balance: 500 crystals");
    await context.track("shopkeeper", 1);
    await helper.track("shopkeeper", 1);
    await helper.command("perks", "Shopkeeper I");
    for (const name of [context.name, helper.name])
      await context.defer({ kind: "command", command: `eco set ${name} 500` });
    await pad(context, [13, 4, 8]);
    for (const [x, price, item] of [
      [1, "B 50", "oak_planks"],
      [4, "S 40", "oak_planks"],
      [7, "B 50:S 40", "oak_planks"],
      [10, "B 50", "?"],
    ] as const) {
      await context.set(
        context.at(x, 0, 4),
        context.at(x, 0, 4),
        "minecraft:barrel[facing=north]",
      );
      await context.defer({
        kind: "break",
        sneak: true,
        position: context.at(x, 0, 3),
        standing: context.at(x + 0.5, 0, 1.5),
      });
      await wallSign(context, {
        position: [x, 0, 3],
        standing: [x + 0.5, 0, 1.5],
        lines: [helper.name, "16", price, item],
      });
      await context.feedback(item === "?" ? "Shop made." : "Shop open.");
      await context.command(
        `minecraft:item replace block ${context.at(x, 0, 4).join(" ")} container.0 with minecraft:oak_planks 64`,
      );
    }
  },
  run: async (context) => {
    for (const [x, name, caption] of [
      [
        1,
        "shop-buy-sign",
        "B 50 lets a customer buy sixteen oak planks for fifty crystals.",
      ],
      [
        4,
        "shop-sell-sign",
        "S 40 lets a customer sell sixteen oak planks for forty crystals.",
      ],
      [
        7,
        "shop-both-sign",
        "A combined sign offers both prices for the same quantity.",
      ],
      [
        10,
        "shop-unset-sign",
        "A question mark leaves the item unset until the owner selects it.",
      ],
    ] as const) {
      await camera(context, [x + 0.5, 0, 1.5], [x + 0.5, 0.5, 3.9]);
      await context.capture({
        schema: 1,
        name,
        alt: caption,
        caption,
        annotations: [],
      });
    }
    await camera(context, [7.5, 0, 6.5], [7.5, 0.5, 4.5]);
    await context.use();
    const stock = await context.waitFor(
      "stock container",
      (state) => state.connected && state.screen === "Barrel",
    );
    if (!stock.connected) throw new Error("Stock view disconnected");
    await context.action("hover-slot", {
      containerId: stock["containerId"],
      stateId: stock["stateId"],
      slot: 0,
    });
    await context.capture({
      schema: 1,
      name: "shop-stock",
      alt: "A barrel holds sixty-four oak planks available for shop trades",
      caption: "The shop trades the matching items stored in its container.",
      annotations: [],
    });
    await context.action("close");
    await camera(context, [7.5, 0, 1.5], [7.5, 0.5, 3.9]);
    await context.action("clear-overlays");
    await context.use();
    await context.waitFor(
      "customer receives sixteen planks",
      (state) =>
        state.connected &&
        state.inventory.some(
          (item) => item.type === "minecraft:oak_planks" && item.count === 16,
        ),
    );
    await context.playerCommand("balance", "Balance: 450 crystals");
    const helper = await localHelper(context);
    await helper.command("balance", "Balance: 550 crystals");
    await context.action("chat-open");
    await context.capture({
      schema: 1,
      name: "shop-customer-buy",
      alt: "A successful purchase transfers sixteen oak planks and charges fifty crystals",
      caption:
        "The customer receives sixteen planks and pays the shop owner fifty crystals.",
      annotations: [],
    });
    await context.action("close");
    await context.action("clear-overlays");
    await context.attack();
    await context.waitFor(
      "customer sells the sixteen planks",
      (state) =>
        state.connected &&
        !state.inventory.some((item) => item.type === "minecraft:oak_planks"),
    );
    await context.playerCommand("balance", "Balance: 490 crystals");
    await helper.command("balance", "Balance: 510 crystals");
    await context.action("chat-open");
    await context.capture({
      schema: 1,
      name: "shop-customer-sell",
      alt: "Selling the sixteen oak planks back pays forty crystals",
      caption:
        "Selling back pays the sign's S price, which can differ from its B price.",
      annotations: [],
    });
    await context.action("close");
  },
});
