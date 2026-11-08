import {
  defineCaptureScene,
  type CaptureContext,
} from "@shepherdjerred/mc-harness/capture/define.ts";
import { CaptureTransport } from "@shepherdjerred/mc-harness/capture/transport.ts";
import { RegionReadResponseSchema } from "@shepherdjerred/mc-harness/protocol/bridge.ts";
import { localHelper } from "#captures/helper.ts";
import { hoverItem } from "#captures/inventory.ts";
import shots from "#captures/presentations/games/rwf.ts";
import { presentation } from "#captures/presentations/lookup.ts";

const helpers = ["MapleFox", "RiverOtter", "BirchOwl"];
async function bombBlock(context: CaptureContext) {
  const transport = new CaptureTransport(
    context.target,
    "Verify the actual Valley bomb",
    undefined,
    context.name,
  );
  const point = { x: 4146, y: 41, z: 5285 };
  const region = await transport.world(
    RegionReadResponseSchema,
    "region-read",
    { world: "rwf", min: point, max: point },
  );
  const state =
    region.palette[Buffer.from(region.blocks, "base64").readUInt32LE(0)];
  if (state === undefined) throw new Error("Missing Valley bomb state");
  return state;
}
async function arrive(
  context: CaptureContext,
  name: string,
  position: [number, number, number],
) {
  await context.command(
    `minecraft:execute in minecraft:rwf run minecraft:tp ${name} ${position.join(" ")}`,
  );
  const helper =
    name === context.name ? undefined : await localHelper(context, name);
  const wait = helper?.waitFor ?? context.waitFor;
  await wait(
    "Valley bomb approach",
    (s) =>
      s.connected &&
      s.world === "minecraft:rwf" &&
      s.position.every((v, i) => Math.abs(v - (position[i] ?? Infinity)) < 0.3),
  );
}
async function chargeBomb(
  context: CaptureContext,
  action: CaptureContext["action"],
  safe: boolean,
) {
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    await action("use");
    const block = await bombBlock(context);
    if (safe ? block.startsWith("minecraft:tnt") : block === "minecraft:air")
      return;
    await Bun.sleep(100);
  }
  throw new Error("Real fuse clicks did not finish the bomb transition");
}
async function selectTeams(context: CaptureContext) {
  await context.playerCommand(
    "rwf admin setmap valley",
    "The next match is played on Valley of Death.",
  );
  for (const [name, team] of [
    [context.name, "Blue"],
    [helpers[0], "Red"],
    [helpers[1], "Red"],
    [helpers[2], "Blue"],
  ] as const) {
    if (name === undefined) throw new Error("Missing genuine RWF participant");
    await context.playerCommand(
      `rwf admin team ${name} ${team.toLowerCase()}`,
      `${name} plays for ${team} Team.`,
    );
  }
}
export default defineCaptureScene({
  name: "valley-bomb-and-round",
  description:
    "Four genuine players start Valley of Death, arm and defuse a real bomb, and finish a round",
  bounds: { min: [-25, -6, -30], max: [120, 26, 60] },
  staging: [-2.5, 0, -2.5],
  inspectors: [],
  setup: async (context) => {
    await context.defer({ kind: "command", command: "rwf admin forcestop" });
    for (const name of helpers) {
      const helper = await localHelper(context, name);
      const cap = await helper.action("frame-cap", { fps: 30 });
      if (
        typeof cap !== "object" ||
        cap === null ||
        !("fpsCap" in cap) ||
        cap.fpsCap !== 30
      )
        throw new Error("RWF helper did not apply its render budget");
      await helper.command("rwf join", `${name} joined the match.`);
      await helper.action("command", { text: "rwf kit trooper" });
    }
    await context.action("command", { text: "rwf kit trooper" });
    await selectTeams(context);
  },
  run: async (context) => {
    await context.action("clear-overlays");
    await context.lookAt([31.5, 73, 40]);
    await context.capture(presentation(shots, "search-lobby"));
    await context.action("command", { text: "rwf kits" });
    await context.waitFor(
      "RWF kit picker",
      (s) => s.connected && s.screen === "Pick a kit",
    );
    await hoverItem(context, "minecraft:iron_sword", "Pick a kit");
    await context.capture(presentation(shots, "rwf-kit-menu"));
    await context.action("close");
    await context.playerCommand("rwf admin start", "Started.");
    await context.waitFor(
      "live Valley inventory",
      (s) =>
        s.connected &&
        s.world === "minecraft:rwf" &&
        s.inventory.some((i) => i.name === "Bomb Fuse"),
      90_000,
    );
    await context.feedback("You are in Blue Team");
    await context.action("clear-overlays");
    await context.lookAt([4143.5, 43, 5240]);
    await context.capture(presentation(shots, "rwf-live-hud"));
    await context.action("inventory", { open: true });
    await context.waitFor(
      "fuse inventory",
      (s) => s.connected && s.screen === "Crafting",
    );
    await hoverItem(context, "minecraft:blaze_powder");
    await context.capture(presentation(shots, "rwf-bomb-fuse"));
    await context.action("close");
    await arrive(context, context.name, [4146.5, 40, 5282.5]);
    await context.action("hotbar", { slot: 0 });
    await context.lookAt([4146.5, 41.5, 5285.5]);
    const safeBomb = await bombBlock(context);
    if (!safeBomb.startsWith("minecraft:tnt"))
      throw new Error("Blue bomb is not initially safe");
    await context.capture(presentation(shots, "rwf-bomb-safe"));
    const attacker = await localHelper(context, "MapleFox");
    await arrive(context, attacker.name, [4144.5, 40, 5285.5]);
    await attacker.action("hotbar", { slot: 0 });
    await attacker.lookAt([4146.5, 41.5, 5285.5]);
    await chargeBomb(context, attacker.action, false);
    await context.feedback("just armed");
    if ((await bombBlock(context)) !== "minecraft:air")
      throw new Error(
        "Arming did not replace the TNT block with the real primed entity",
      );
    await context.capture(presentation(shots, "rwf-bomb-armed"));
    await context.record(
      presentation(shots, "rwf-defuse-demo"),
      async () => {
        await context.step("defuse", async () => {
          await chargeBomb(context, context.action, true);
          await context.step("safe-again", async () => {
            await context.feedback("has just defused their bomb!");
            const defused = await bombBlock(context);
            if (!defused.startsWith("minecraft:tnt"))
              throw new Error("Defusing did not restore the safe bomb block");
          });
        });
      },
      12,
    );
    await context.action("chat-open");
    await context.capture(presentation(shots, "rwf-bomb-defused"));
    await context.action("close");
    await context.action("clear-overlays");
    for (const name of ["MapleFox", "RiverOtter"]) {
      const helper = await localHelper(context, name);
      await helper.action("command", { text: "suicide" });
    }
    await context.feedback("Blue Team wins!");
    await context.action("chat-open");
    await context.capture(presentation(shots, "rwf-round-result"));
    await context.action("close");
    await context.action("command", { text: "rwf leave" });
    await context.waitFor(
      "survival world restored",
      (s) => s.connected && s.world === "minecraft:overworld",
    );
    await context.action("command", { text: "rwf spectate" });
    await context.waitFor(
      "Valley spectator",
      (s) => s.connected && s.world === "minecraft:rwf" && s.position[1] > 65,
    );
    await context.lookAt([4143.5, 40, 5215.5]);
    await context.action("clear-overlays");
    await context.capture(presentation(shots, "rwf-spectator-view"));
    await context.action("command", { text: "rwf leave" });
  },
});
