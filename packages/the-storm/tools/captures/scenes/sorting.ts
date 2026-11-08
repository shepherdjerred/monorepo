import presentations from "#captures/presentations/sorting.ts";
import { presentation } from "#captures/presentations/lookup.ts";
import { z } from "zod";
import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { pad } from "./fixtures.ts";

const Slots = z.object({
  containerId: z.number(),
  slots: z.array(
    z.object({ slot: z.number(), type: z.string(), count: z.number() }),
  ),
});

export default defineCaptureScene({
  name: "container-sorting",
  description: "Sort a real barrel with the ordinary empty-hand shortcut",
  bounds: { min: [0, -1, 0], max: [6, 3, 6] },
  staging: [-3, 0, -3],
  inspectors: ["wilderness", "shops", "banks"],
  setup: async (context) => {
    await pad(context, [6, 3, 6]);
    await context.set(
      context.at(3, 0, 3),
      context.at(3, 0, 3),
      "minecraft:barrel[facing=north]",
    );
    for (const [slot, item, count] of [
      [0, "cobblestone", 8],
      [5, "oak_planks", 4],
      [9, "iron_ingot", 8],
      [13, "wheat_seeds", 3],
      [19, "cobblestone", 8],
      [23, "potato", 2],
      [26, "oak_planks", 8],
    ] as const) {
      await context.command(
        `minecraft:item replace block ${context.at(3, 0, 3).join(" ")} container.${slot.toString()} with minecraft:${item} ${count.toString()}`,
      );
    }
    await context.command(`minecraft:gamemode survival ${context.name}`);
    await context.action("hotbar", { slot: 7 });
    await context.teleport(context.at(3.5, 0, 0.5), 0, 0);
    await context.lookAt(context.at(3.5, 0.5, 3.5));
  },
  run: async (context) => {
    await context.use();
    await context.waitFor(
      "seven scattered stacks",
      (state) =>
        state.connected &&
        Slots.parse(state).containerId > 0 &&
        Slots.parse(state)
          .slots.slice(0, -36)
          .filter((item) => item.count > 0).length === 7,
    );
    await context.action("clear-overlays");
    await context.capture(presentation(presentations, "sorting-before"));
    await context.action("close");
    await context.attack(true);
    await context.feedback("Sorted.");
    if (
      (await context.block(context.at(3, 0, 3))) !==
      "minecraft:barrel[facing=north,open=false]"
    )
      throw new Error("The sorting shortcut changed its container");
    await context.use();
    await context.waitFor(
      "five compacted stacks with all items preserved",
      (state) => {
        if (!state.connected) return false;
        const view = Slots.parse(state);
        const contents = view.slots
          .slice(0, -36)
          .filter((item) => item.count > 0);
        return (
          view.containerId > 0 &&
          contents.length === 5 &&
          contents.every((item, index) => item.slot === index) &&
          contents.some(
            (item) =>
              item.type === "minecraft:cobblestone" && item.count === 16,
          ) &&
          contents.some(
            (item) => item.type === "minecraft:oak_planks" && item.count === 12,
          ) &&
          contents.reduce((count, item) => count + item.count, 0) === 41
        );
      },
    );
    await context.action("clear-overlays");
    await context.capture(presentation(presentations, "sorting-after"));
    await context.action("close");
  },
});
