import { z } from "zod";
import {
  defineCaptureScene,
  type CaptureContext,
} from "@shepherdjerred/mc-harness/capture/define.ts";
import shots from "#captures/presentations/progression/shards.ts";
import { presentation } from "#captures/presentations/lookup.ts";
import { hoverItem } from "#captures/inventory.ts";

const View = z.object({
  containerId: z.number(),
  stateId: z.number(),
  slots: z.array(
    z.object({
      slot: z.number(),
      type: z.string(),
      name: z.string(),
      components: z.string(),
    }),
  ),
});
async function itemShot(context: CaptureContext, name: string, type: string) {
  await context.action("clear-overlays");
  await context.action("inventory", { open: true });
  await context.waitFor(
    "gear inventory",
    (s) => s.connected && s.screen === "Crafting",
  );
  await hoverItem(context, type);
  await context.capture(presentation(shots, name));
  await context.action("close");
}
export default defineCaptureScene({
  name: "windmill-storm-upgrade",
  description:
    "Spend a genuine shard at the preserved windmill altar in the rain",
  bounds: { min: [-5, -3, -5], max: [6, 7, 6] },
  staging: [-2.5, 0, -2.5],
  inspectors: [],
  setup: async (context) => {
    if ((await context.block([74, 68, 66])) !== "minecraft:emerald_block")
      throw new Error("Missing windmill altar");
    await context.command(`minecraft:clear ${context.name}`);
    await context.command(`minecraft:gamemode survival ${context.name}`);
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:diamond_sword`,
    );
    await context.command(`shards give ${context.name} 1`);
    await context.feedback("Storm Shard(s)");
    await context.command("minecraft:weather rain");
    await context.action("hotbar", { slot: 0 });
    await context.lookAt([74.5, 68.5, 66.5]);
  },
  run: async (context) => {
    await itemShot(context, "storm-shard-item", "minecraft:prismarine_shard");
    await itemShot(context, "storm-upgrade-before", "minecraft:diamond_sword");
    await context.action("clear-overlays");
    await context.lookAt([74.5, 68.5, 66.5]);
    await context.capture(presentation(shots, "shard-altar"));
    await context.use();
    await context.feedback("The storm answers.");
    await context.waitFor(
      "Storm I sword and spent shard",
      (s) =>
        s.connected &&
        !s.inventory.some((i) => i.type === "minecraft:prismarine_shard") &&
        View.parse(s).slots.some(
          (i) =>
            i.type === "minecraft:diamond_sword" &&
            i.components.includes("Storm I"),
        ),
    );
    await itemShot(context, "storm-upgrade-after", "minecraft:diamond_sword");
  },
});
