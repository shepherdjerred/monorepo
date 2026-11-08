import {
  defineCaptureScene,
  type CaptureContext,
} from "@shepherdjerred/mc-harness/capture/define.ts";
import type { ClientState } from "@shepherdjerred/mc-harness/protocol/client.ts";
import {
  pad,
  camera,
  commandShot,
  inspectors,
} from "#captures/scenes/fixtures.ts";
import shots from "#captures/presentations/progression/spells.ts";
import { presentation } from "#captures/presentations/lookup.ts";

function count(state: ClientState, type: string) {
  if (!state.connected) throw new Error("Spell camera disconnected");
  return state.inventory
    .filter((item) => item.type === `minecraft:${type}`)
    .reduce((sum, item) => sum + item.count, 0);
}
async function focus(context: CaptureContext, name: string) {
  const state = await context.waitFor(
    `${name} focus delivered`,
    (s) =>
      s.connected && s.inventory.some((i) => i.name === name && i.slot <= 8),
  );
  if (!state.connected) throw new Error("Spell camera disconnected");
  const item = state.inventory.find((i) => i.name === name && i.slot <= 8);
  if (!item) throw new Error(`Missing ${name} focus`);
  await context.action("hotbar", { slot: item.slot });
}
export default defineCaptureScene({
  name: "mark-and-recall",
  description:
    "Bind real foci, pay Mark's reagents, and Recall to the observed position",
  bounds: { min: [0, -1, 0], max: [12, 4, 12] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    await pad(context, [12, 4, 12]);
    await context.track("spellcaster", 1);
    await camera(context, [2.5, 0, 2.5], [2.5, -1, 3.5]);
    await context.playerCommand(
      "spells bind mark",
      "Your mark focus is ready.",
    );
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.1 with minecraft:redstone 30`,
    );
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.2 with minecraft:lapis_lazuli 15`,
    );
  },
  run: async (context) => {
    await commandShot(context, [
      "spell-mark-info",
      "spells info mark",
      "Spellcaster I",
      presentation(shots, "spell-mark-info").caption,
    ]);
    await focus(context, "Mark");
    await context.action("clear-overlays");
    await context.lookAt(context.at(12, 1, 12));
    await context.action("inventory", { open: true });
    await context.waitFor(
      "focus and reagents",
      (s) =>
        s.connected &&
        s.screen === "Crafting" &&
        count(s, "redstone") === 30 &&
        count(s, "lapis_lazuli") === 15,
    );
    await context.capture(presentation(shots, "spell-focus-reagents"));
    await context.action("close");
    await context.lookAt(context.at(2.5, -1, 3.5));
    await context.use();
    await context.feedback("Marked");
    await context.waitFor(
      "Mark reagents spent",
      (s) =>
        s.connected &&
        count(s, "redstone") === 15 &&
        count(s, "lapis_lazuli") === 0,
    );
    await context.lookAt(context.at(12, 1, 12));
    await context.action("chat-open");
    await context.capture(presentation(shots, "spell-mark-cast"));
    await context.action("close");
    await context.playerCommand(
      "spells bind recall",
      "Your recall focus is ready.",
    );
    await context.teleport(context.at(10.5, 0, 10.5), 0, 0);
    await focus(context, "Recall");
    await context.lookAt(context.at(10.5, -1, 11.5));
    await context.use();
    const expected = context.at(2.5, 0, 2.5);
    await context.waitFor(
      "Recall arrival and payment",
      (s) =>
        s.connected &&
        s.position.every(
          (n, i) => Math.abs(n - (expected[i] ?? Infinity)) < 0.5,
        ) &&
        count(s, "redstone") === 0,
    );
    await context.action("clear-overlays");
    await context.lookAt(context.at(8, 1, 8));
    await context.capture(presentation(shots, "spell-recall-arrival"));
  },
});
