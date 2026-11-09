import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import shots from "#captures/presentations/essentials/onboarding.ts";
import { presentation } from "#captures/presentations/lookup.ts";

export default defineCaptureScene({
  name: "new-player-menus",
  description: "Open genuine first-session tools over the preserved spawn",
  bounds: { min: [-16, -4, -16], max: [16, 16, 16] },
  staging: [-2.5, 0, -2.5],
  inspectors: [],
  setup: async (context) => {
    await context.command(`minecraft:gamemode survival ${context.name}`);
    await context.action("clear-overlays");
  },
  run: async (context) => {
    const state = await context.status();
    if (!state.connected) throw new Error("Onboarding camera disconnected");
    const compass = state.inventory.find(
      (item) =>
        item.type === "minecraft:compass" && item.name === "Choose a Biome",
    );
    if (!compass || compass.slot > 8)
      throw new Error("Fresh account lacks its genuine starter compass");
    await context.action("hotbar", { slot: compass.slot });
    await context.lookAt(context.at(-2.5, -1, -2.5));
    await context.use();
    await context.waitFor(
      "biome chooser",
      (s) => s.connected && s.screen === "Welcome to The Storm!",
    );
    await context.capture(presentation(shots, "starter-compass"));
    await context.action("close");
    await context.action("command", { text: "guide" });
    await context.waitFor(
      "welcome guide",
      (s) => s.connected && s.screen === "Book View Screen",
    );
    await context.capture(presentation(shots, "welcome-guide"));
    await context.action("close");
    await context.action("command", { text: "worlds" });
    await context.waitFor(
      "world destinations",
      (s) => s.connected && s.screen === "Travel",
    );
    await context.capture(presentation(shots, "worlds-menu"));
    await context.action("close");
  },
});
