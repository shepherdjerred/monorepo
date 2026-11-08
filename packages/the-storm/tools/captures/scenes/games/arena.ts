import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { localHelper } from "#captures/helper.ts";
import shots from "#captures/presentations/games/arena.ts";
import { presentation } from "#captures/presentations/lookup.ts";

export default defineCaptureScene({
  name: "colosseum-knight-and-spectator",
  description:
    "Join the preserved Colosseum, choose Knight, face a real wave and watch as a spectator",
  bounds: { min: [-67, -14, -63], max: [64, 58, 62] },
  staging: [-2.5, 0, -2.5],
  inspectors: [],
  setup: async (context) => {
    await context.command(`minecraft:gamemode survival ${context.name}`);
    await context.command(`minecraft:clear ${context.name}`);
    await context.command(`minecraft:give ${context.name} minecraft:emerald 3`);
    await context.playerCommand(
      "arena join colosseum",
      "entered The Colosseum.",
    );
    await context.waitFor(
      "Colosseum lobby",
      (s) => s.connected && Math.abs(s.position[1] - 33) < 0.2,
    );
  },
  run: async (context) => {
    await context.action("clear-overlays");
    await context.lookAt([220.5, 35.2, 2.5]);
    await context.capture(presentation(shots, "mob-arena-classes"));
    await context.playerCommand("arena class knight", "You are a Knight.");
    await context.action("inventory", { open: true });
    await context.waitFor(
      "Knight equipment",
      (s) =>
        s.connected &&
        s.screen === "Crafting" &&
        s.inventory.some((i) => i.type === "minecraft:stone_sword"),
    );
    await context.capture(presentation(shots, "mob-arena-knight-kit"));
    await context.action("close");
    const helper = await localHelper(context);
    await helper.command("arena join colosseum", "entered The Colosseum.");
    await helper.command("arena class knight", "You are a Knight.");
    await helper.command("arena ready", "is ready.");
    await context.playerCommand("arena ready", "is ready.");
    await context.feedback("Wave 1!");
    await context.waitFor(
      "fighter reaches arena floor",
      (s) => s.connected && s.position[1] > 40 && s.position[1] < 45,
    );
    await context.lookAt([227.5, 43, -22]);
    await context.action("chat-open");
    await context.capture(presentation(shots, "mob-arena-wave"));
    await context.action("close");
    await context.action("command", { text: "arena leave" });
    await context.waitFor(
      "survival inventory restored",
      (s) =>
        s.connected &&
        s.inventory.some(
          (i) => i.type === "minecraft:emerald" && i.count === 3,
        ) &&
        !s.inventory.some((i) => i.type === "minecraft:stone_sword"),
    );
    await context.playerCommand(
      "arena spec colosseum",
      "You are watching The Colosseum.",
    );
    await context.waitFor(
      "spectator balcony",
      (s) => s.connected && Math.abs(s.position[1] - 66) < 0.2,
    );
    await context.lookAt([227.5, 43, 2.5]);
    await context.action("clear-overlays");
    await context.capture(presentation(shots, "mob-arena-spectator"));
    await context.action("command", { text: "arena leave" });
    await helper.action("command", { text: "arena leave" });
  },
});
