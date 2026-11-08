import { z } from "zod";
import {
  defineCaptureScene,
  type CaptureContext,
} from "@shepherdjerred/mc-harness/capture/define.ts";
import { pad, camera, inspectors } from "#captures/scenes/fixtures.ts";
import shots from "#captures/presentations/mechanics/repair.ts";
import { presentation } from "#captures/presentations/lookup.ts";

const Slots = z.object({
  slots: z.array(z.object({ type: z.string(), components: z.string() })),
});
function damage(state: unknown) {
  const item = Slots.parse(state).slots.find(
    (slot) => slot.type === "minecraft:iron_pickaxe",
  );
  if (!item) throw new Error("Missing iron pickaxe");
  const match = /minecraft:damage=>(\d+)/u.exec(item.components);
  return match === null ? 0 : Number(match[1]);
}
async function photograph(context: CaptureContext, name: string) {
  await context.action("clear-overlays");
  await context.action("inventory", { open: true });
  const state = await context.waitFor(
    "pickaxe inventory",
    (s) => s.connected && s.screen === "Crafting",
  );
  const menu = z
    .object({ containerId: z.number(), stateId: z.number() })
    .parse(state);
  await context.action("hover-slot", { ...menu, slot: 36 });
  await context.capture(presentation(shots, name));
  await context.action("close");
}
export default defineCaptureScene({
  name: "iron-block-repair",
  description:
    "Repair a damaged pickaxe through the real iron-block interaction",
  bounds: { min: [0, -1, 0], max: [8, 4, 8] },
  staging: [-2.5, 0, -2.5],
  inspectors,
  setup: async (context) => {
    await pad(context, [8, 4, 8]);
    await context.set(
      context.at(3, 0, 3),
      context.at(3, 0, 3),
      "minecraft:iron_block",
    );
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:iron_pickaxe[minecraft:damage=200]`,
    );
    await context.command(
      `minecraft:item replace entity ${context.name} weapon.offhand with minecraft:iron_ingot 2`,
    );
    await camera(context, [3.5, 0, 1], [3.5, 0.5, 3.5]);
    await context.action("hotbar", { slot: 0 });
    await context.waitFor(
      "damaged pickaxe ready",
      (s) => s.connected && damage(s) === 200,
    );
  },
  run: async (context) => {
    await photograph(context, "repair-before");
    await context.lookAt(context.at(3.5, 0.5, 3.5));
    await context.use();
    await context.feedback("Repaired 62 durability.");
    await context.waitFor(
      "durability repaired and one ingredient spent",
      (s) =>
        s.connected &&
        damage(s) === 138 &&
        s.inventory.some(
          (i) =>
            i.slot === 40 && i.type === "minecraft:iron_ingot" && i.count === 1,
        ),
    );
    await photograph(context, "repair-after");
  },
});
