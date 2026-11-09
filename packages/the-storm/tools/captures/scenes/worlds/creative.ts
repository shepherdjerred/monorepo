import { regionFingerprint } from "@shepherdjerred/mc-harness/capture/admission.ts";
import {
  defineCaptureScene,
  type CaptureContext,
} from "@shepherdjerred/mc-harness/capture/define.ts";
import { CaptureTransport } from "@shepherdjerred/mc-harness/capture/transport.ts";
import { RegionReadResponseSchema } from "@shepherdjerred/mc-harness/protocol/bridge.ts";
import { localHelper } from "#captures/helper.ts";
import shots from "#captures/presentations/worlds/creative.ts";
import { presentation } from "#captures/presentations/lookup.ts";

async function fingerprint(context: CaptureContext) {
  const transport = new CaptureTransport(
    context.target,
    "Verify restored demonstration build",
    undefined,
    context.name,
  );
  const region = await transport.world(
    RegionReadResponseSchema,
    "region-read",
    {
      world: "creative",
      min: { x: 576, y: 64, z: 16 },
      max: { x: 591, y: 72, z: 31 },
    },
  );
  return regionFingerprint(region);
}
async function shot(context: CaptureContext, name: string) {
  await context.action("chat-open");
  await context.capture(presentation(shots, name));
  await context.action("close");
}
export default defineCaptureScene({
  name: "creative-plot-library",
  description:
    "Claim two unclaimed plots, share access, save and restore a real build, then merge",
  bounds: { min: [-30, -2, -15], max: [155, 12, 65] },
  staging: [-2.5, 0, -2.5],
  inspectors: [],
  setup: async (context) => {
    await context.command(`minecraft:gamemode creative ${context.name}`);
    await context.teleport([580.5, 65, 20.5], 0, 0);
    await context.lookAt([590, 67, 28]);
    await context.action("clear-overlays");
  },
  run: async (context) => {
    await context.playerCommand("creative claim", "You claimed 7;1.");
    await shot(context, "creative-plot-claim");
    await context.action("clear-overlays");
    await context.playerCommand("creative trust MapleFox", "Trusted MapleFox");
    const helper = await localHelper(context);
    await helper.command("creative", "Creative");
    await context.playerCommand("creative info", "7;1 owner");
    // A compact demonstration pavilion exists only on this fresh imported copy.
    await context.command(
      "minecraft:execute in minecraft:creative run minecraft:fill 578 65 24 584 65 30 minecraft:stone_bricks",
    );
    for (const x of [578, 584])
      for (const zz of [24, 30])
        await context.command(
          `minecraft:execute in minecraft:creative run minecraft:fill ${x.toString()} 66 ${zz.toString()} ${x.toString()} 69 ${zz.toString()} minecraft:oak_log`,
        );
    await context.command(
      "minecraft:execute in minecraft:creative run minecraft:fill 577 70 23 585 70 31 minecraft:oak_slab[type=bottom]",
    );
    await context.command(
      `minecraft:item replace entity ${helper.name} hotbar.0 with minecraft:oak_planks`,
    );
    await context.command(`minecraft:deop ${helper.name}`);
    await context.command(
      `minecraft:execute in minecraft:creative run minecraft:tp ${helper.name} 581.5 66 24.5`,
    );
    await helper.waitFor(
      "trusted builder reaches the pavilion",
      (s) =>
        s.connected &&
        s.world === "minecraft:creative" &&
        s["terrainReady"] === true &&
        s.screen === "" &&
        Math.abs(s.position[1] - 66) < 0.2,
    );
    await helper.action("hotbar", { slot: 0 });
    await helper.waitFor(
      "trusted builder holds the supplied plank",
      (s) =>
        s.connected &&
        s.hotbar === 0 &&
        s.inventory.some(
          (i) => i.slot === 0 && i.type === "minecraft:oak_planks",
        ),
    );
    // Confirm a server round trip after teleporting and changing operator status.
    await helper.command("creative info", "7;1 owner");
    if ((await context.block([582, 66, 25])) !== "minecraft:air")
      throw new Error("The trusted builder's placement cell is not empty");
    await helper.lookAt([582.5, 65.9, 25.5]);
    await helper.action("use");
    const deadline = performance.now() + 30_000;
    while ((await context.block([582, 66, 25])) !== "minecraft:oak_planks") {
      if (performance.now() > deadline) {
        const { state } = await helper.status();
        throw new Error(
          `The trusted non-operator could not build on the plot: ${JSON.stringify({ block: await context.block([582, 66, 25]), client: state.connected ? { position: state.position, target: state.target, held: state.inventory.find((i) => i.slot === state.hotbar) } : state, messages: await helper.action("messages", { since: 0 }) })}`,
        );
      }
      await Bun.sleep(100);
    }
    await context.lookAt([581.5, 67, 25.5]);
    await shot(context, "creative-plot-access");
    const before = await fingerprint(context);
    await context.lookAt([581.5, 68, 27.5]);
    await context.action("clear-overlays");
    await context.capture(presentation(shots, "creative-plot"));
    await context.playerCommand(
      "creative save garden-pavilion",
      "Saved garden-pavilion.",
    );
    await context.action("clear-overlays");
    await context.playerCommand("creative load", "garden-pavilion");
    await shot(context, "creative-saved-library");
    await context.playerCommand("creative clear confirm", "Cleared 7;1.");
    if ((await fingerprint(context)) === before)
      throw new Error("Creative clear left the build in place");
    await context.playerCommand(
      "creative paste garden-pavilion",
      "Pasted garden-pavilion onto 7;1.",
    );
    if ((await fingerprint(context)) !== before)
      throw new Error("Restored build differs from the saved blocks");
    await context.action("clear-overlays");
    await context.capture(presentation(shots, "creative-restored-build"));
    await context.teleport([672.5, 65, 20.5], 0, 0);
    await context.playerCommand("creative claim", "You claimed 8;1.");
    await context.playerCommand("creative merge 7;1", "Merged 8;1 with 7;1.");
    await context.lookAt([635, 65, 30]);
    await shot(context, "creative-merged-plots");
  },
});
