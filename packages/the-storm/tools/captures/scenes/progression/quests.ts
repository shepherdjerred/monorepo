import {
  defineCaptureScene,
  type CaptureContext,
} from "@shepherdjerred/mc-harness/capture/define.ts";
import { activate, hasControl } from "#captures/ui.ts";
import shots from "#captures/presentations/progression/quests.ts";
import { presentation } from "#captures/presentations/lookup.ts";
import { z } from "zod";

const NpcTarget = z.object({
  kind: z.literal("entity"),
  type: z.literal("minecraft:player"),
  bounds: z.object({ min: z.tuple([z.number(), z.number(), z.number()]) }),
});
async function aimNpc(
  context: CaptureContext,
  position: [number, number, number],
) {
  await context.lookAt([position[0], position[1] + 1.3, position[2]]);
  await context.waitFor("the intended NPC's rendered body", (state) => {
    if (!state.connected) return false;
    const target = NpcTarget.safeParse(state.target);
    return (
      target.success &&
      target.data.bounds.min.every(
        (v, i) => Math.abs(v - (position[i] ?? Infinity)) < 0.5,
      )
    );
  });
}

async function talk(context: CaptureContext) {
  await context.action("close");
  await aimNpc(context, [-49.5, 70, 24.5]);
  await context.use();
  await context.waitFor(
    "Thomas conversation",
    (s) => s.connected && s.screen.includes("Thomas"),
  );
}
async function journal(context: CaptureContext, name: string) {
  await context.action("command", { text: "quests" });
  await context.waitFor(
    "quest journal",
    (s) => s.connected && s.screen === "Quest Journal",
  );
  await context.action("clear-overlays");
  await context.capture(presentation(shots, name));
  await context.action("close");
}
async function handIn(context: CaptureContext) {
  await talk(context);
  // Thomas may offer another quest alongside this one; choose the actual active matter.
  if (await hasControl(context, "A Blacksmith's Task"))
    await activate(context, "A Blacksmith's Task");
  await activate(context, "Hand over");
  await context.action("close");
}
export default defineCaptureScene({
  name: "blacksmith-and-field-notes",
  description:
    "Accept Thomas's real quest, make a partial delivery, and earn its actual payout",
  bounds: { min: [-7, -8, -30], max: [12, 8, 7] },
  staging: [-2.5, 0, -2.5],
  inspectors: [],
  setup: async (context) => {
    await context.action("gui-scale", { scale: 2 });
    await context.command("minecraft:time set 6000");
    await context.command("minecraft:weather clear");
    await context.command(`minecraft:gamemode survival ${context.name}`);
    await context.command(`minecraft:clear ${context.name}`);
    await context.action("hotbar", { slot: 0 });
  },
  run: async (context) => {
    await context.teleport([-37.5, 64, 3.5], 0, 0);
    await aimNpc(context, [-37.5, 64, 1.5]);
    await context.use();
    await context.waitFor(
      "quest board",
      (s) => s.connected && s.screen === "Tamsin",
    );
    await context.action("clear-overlays");
    await context.capture(presentation(shots, "quest-board"));
    await context.action("close");
    await context.teleport([-46.5, 70, 24.5], 0, 0);
    await talk(context);
    if (await hasControl(context, "A Blacksmith's Task"))
      await activate(context, "A Blacksmith's Task");
    await context.capture(presentation(shots, "npc-quest-offer"));
    await activate(context, "Accept");
    await context.action("close");
    await journal(context, "quest-objectives");
    await context.command(
      `minecraft:give ${context.name} minecraft:iron_ingot 16`,
    );
    await handIn(context);
    await context.waitFor(
      "partial iron consumed",
      (s) =>
        s.connected &&
        !s.inventory.some((i) => i.type === "minecraft:iron_ingot"),
    );
    await journal(context, "quest-partial-delivery");
    await journal(context, "quest-journal");
    for (const [item, amount] of [
      ["iron_ingot", 16],
      ["coal", 16],
      ["stick", 16],
      ["string", 16],
      ["feather", 16],
      ["gold_ingot", 12],
      ["diamond", 4],
    ] as const)
      await context.command(
        `minecraft:give ${context.name} minecraft:${item} ${amount.toString()}`,
      );
    await context.action("clear-overlays");
    await handIn(context);
    await context.feedback("750");
    await context.playerCommand("balance", "Balance: 1,250 crystals");
    await context.action("chat-open");
    await context.capture(presentation(shots, "quest-completion-reward"));
    await context.action("close");
    // An actual pickup, rather than /give, reveals the authored collection entry.
    const [x, y, zz] = context.at(-2.5, 0, -2.5);
    await context.command(
      `minecraft:summon minecraft:item ${x.toString()} ${y.toString()} ${zz.toString()} {Item:{id:"minecraft:wheat",count:1},PickupDelay:0s}`,
    );
    await context.feedback("Town Harvest");
    await context.waitFor(
      "wheat picked up",
      (s) =>
        s.connected && s.inventory.some((i) => i.type === "minecraft:wheat"),
    );
    await journal(context, "quest-field-note");
  },
});
