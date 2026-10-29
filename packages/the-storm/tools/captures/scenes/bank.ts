import { z } from "zod";
import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";

export default defineCaptureScene({
  name: "deposit-bank",
  description: "Move cobblestone from a bank into its linked shelf",
  bounds: { min: [0, -1, 0], max: [7, 3, 6] },
  staging: [-3, 0, -3],
  inspectors: ["wilderness", "shops", "banks", "stargates"],
  setup: async (context) => {
    await context.command(`minecraft:gamemode creative ${context.name}`);
    await context.set(
      context.at(0, -1, 0),
      context.at(7, -1, 6),
      "minecraft:stone_bricks",
    );
    for (const x of [2, 5]) {
      await context.set(
        context.at(x, 0, 3),
        context.at(x, 0, 3),
        "minecraft:barrel[facing=north]",
      );
      await context.teleport(context.at(x + 0.5, 0, 0.5), 0, 0);
      await context.command(
        `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:oak_sign`,
      );
      await context.action("hotbar", { slot: 0 });
      await context.lookAt(context.at(x + 0.5, 0.5, 3));
      await context.defer({
        kind: "break",
        position: context.at(x, 0, 2),
        standing: context.at(x + 0.5, 0, 0.5),
      });
      await context.use(true);
      await context.sign(
        x === 2 ? ["[Bank]", "", "", ""] : ["[Shelf]", "cobblestone", "", ""],
      );
    }
  },
  run: async (context) => {
    await context.teleport(context.at(3.5, 0, 0.5), 0, 0);
    await context.lookAt(context.at(3.5, 0.5, 3.5));
    await context.capture({
      schema: 1,
      name: "deposit-bank",
      alt: "A deposit bank barrel beside a cobblestone shelf",
      caption: "Closing the bank sends matching items to its linked shelf.",
      annotations: [],
    });
    await context.teleport(context.at(2.5, 0, 5.5), 180, 0);
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.1 with minecraft:cobblestone 16`,
    );
    await context.lookAt(context.at(2.5, 0.5, 3.5));
    await context.use();
    await context.waitFor(
      "bank inventory",
      (state) =>
        state.connected &&
        typeof state["containerId"] === "number" &&
        state["containerId"] > 0,
    );
    await context.transfer("minecraft:cobblestone", "inventory");
    await context.action("close");
    await context.teleport(context.at(5.5, 0, 5.5), 180, 0);
    await context.lookAt(context.at(5.5, 0.5, 3.5));
    await context.use();
    const SlotsSchema = z.object({
      slots: z.array(z.object({ type: z.string(), count: z.number() })),
    });
    await context.waitFor("sixteen cobblestone in shelf", (state) => {
      if (!state.connected) return false;
      const slots = SlotsSchema.parse(state).slots;
      return slots
        .slice(0, -36)
        .some(
          (item) => item.type === "minecraft:cobblestone" && item.count === 16,
        );
    });
    await context.capture({
      schema: 1,
      name: "bank-delivered",
      alt: "Sixteen cobblestone have arrived in the linked shelf barrel",
      caption: "The matching shelf receives the deposited cobblestone.",
      annotations: [],
    });
    await context.action("close");
  },
});
