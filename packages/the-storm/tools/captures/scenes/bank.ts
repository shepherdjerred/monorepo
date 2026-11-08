import presentations from "#captures/presentations/bank.ts";
import { presentation } from "#captures/presentations/lookup.ts";
import { z } from "zod";
import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";

const SlotsSchema = z.object({
  slots: z.array(z.object({ type: z.string(), count: z.number() })),
});

export default defineCaptureScene({
  name: "deposit-bank",
  description: "Move cobblestone from a bank into its linked shelf",
  bounds: { min: [0, -1, 0], max: [7, 3, 6] },
  staging: [-3, 0, -3],
  inspectors: ["wilderness", "shops", "banks"],
  setup: async (context) => {
    await context.command(`minecraft:gamemode creative ${context.name}`);
    await context.set(
      context.at(0, 0, 0),
      context.at(7, 3, 6),
      "minecraft:air",
    );
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
        x === 2
          ? ["[Bank]", "", "", ""]
          : ["[Shelf]", "cobblestone", "oak_planks", ""],
      );
      await context.feedback(x === 2 ? "Bank created." : "Shelf linked.");
    }
  },
  run: async (context) => {
    await context.command(`minecraft:gamemode survival ${context.name}`);
    await context.action("hotbar", { slot: 7 });
    await context.teleport(context.at(3.5, 0, 0.5), 0, 0);
    await context.lookAt(context.at(3.5, 0.5, 3.5));
    await context.action("clear-overlays");
    await context.capture(presentation(presentations, "deposit-bank"));
    await context.teleport(context.at(5.5, 0, 0.5), 0, 0);
    await context.lookAt(context.at(5.5, 0.5, 2.5));
    await context.capture(presentation(presentations, "bank-shelf-types"));
    await context.teleport(context.at(2.5, 0, 5.5), 180, 0);
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.1 with minecraft:cobblestone 16`,
    );
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.2 with minecraft:oak_planks 12`,
    );
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.3 with minecraft:spruce_log 4`,
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
    await context.transfer("minecraft:oak_planks", "inventory");
    await context.transfer("minecraft:spruce_log", "inventory");
    await context.waitFor(
      "bank holds the three deposits",
      (state) =>
        state.connected &&
        SlotsSchema.parse(state)
          .slots.slice(0, -36)
          .filter((item) => item.count > 0).length === 3,
    );
    await context.action("clear-overlays");
    await context.capture(presentation(presentations, "bank-deposit"));
    await context.action("close");
    await context.teleport(context.at(5.5, 0, 5.5), 180, 0);
    await context.lookAt(context.at(5.5, 0.5, 3.5));
    await context.use();
    await context.waitFor("sixteen cobblestone in shelf", (state) => {
      if (!state.connected) return false;
      const slots = SlotsSchema.parse(state).slots;
      const contents = slots.slice(0, -36);
      return (
        contents.some(
          (item) => item.type === "minecraft:cobblestone" && item.count === 16,
        ) &&
        contents.some(
          (item) => item.type === "minecraft:oak_planks" && item.count === 12,
        )
      );
    });
    await context.capture(presentation(presentations, "bank-delivered"));
    await context.action("close");
    await context.teleport(context.at(2.5, 0, 5.5), 180, 0);
    await context.lookAt(context.at(2.5, 0.5, 3.5));
    await context.use();
    await context.waitFor("unmatched spruce logs stay in the bank", (state) => {
      if (!state.connected) return false;
      const contents = SlotsSchema.parse(state)
        .slots.slice(0, -36)
        .filter((item) => item.count > 0);
      return (
        contents.length === 1 &&
        contents.some(
          (item) => item.type === "minecraft:spruce_log" && item.count === 4,
        )
      );
    });
    await context.capture(presentation(presentations, "bank-unmatched"));
    await context.action("close");
  },
});
