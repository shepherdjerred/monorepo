import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import type { CaptureContext } from "@shepherdjerred/mc-harness/capture/define.ts";
import { pad, wallSign, camera, waitBlock, inspectors } from "./fixtures.ts";
import { CaptureTransport } from "@shepherdjerred/mc-harness/capture/transport.ts";
import { CommandResponseSchema } from "@shepherdjerred/mc-harness/protocol/bridge.ts";
import { z } from "zod";

async function collectCrushedPlank(context: CaptureContext) {
  const transport = new CaptureTransport(
    context.target,
    "Locate the natural Crush drop",
    undefined,
    context.name,
  );
  const [x, y, zz] = context.at(0, -1, 0);
  const response = await transport.world(CommandResponseSchema, "command", {
    command: `minecraft:execute in minecraft:overworld as @e[type=minecraft:item,nbt={Item:{id:"minecraft:oak_planks",count:1}},x=${x.toString()},y=${y.toString()},z=${zz.toString()},dx=12,dy=5,dz=8] run minecraft:data get entity @s Pos`,
  });
  const coordinates = /\[([^\]]+)\]$/u.exec(response.output[0] ?? "")?.[1];
  if (
    coordinates === undefined ||
    !response.success ||
    response.output.length !== 1
  )
    throw new Error(
      `Crush did not produce exactly one loose plank: ${JSON.stringify(response.output)}`,
    );
  const position = z
    .tuple([
      z.number().min(context.box.min.x).max(context.box.max.x),
      z.number().min(context.box.min.y).max(context.box.max.y),
      z.number().min(context.box.min.z).max(context.box.max.z),
    ])
    .parse(
      coordinates.split(",").map((value) =>
        Number(
          z
            .string()
            .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?d$/u)
            .parse(value.trim())
            .slice(0, -1),
        ),
      ),
    );
  // Extension ejects drops beyond the crushed cell; collect at the observed X/Z.
  await context.teleport(
    [position[0], context.at(0, 0, 0)[1], position[2]],
    0,
    0,
  );
  await context.waitFor(
    "crushed plank collected",
    (state) =>
      state.connected &&
      state.inventory.some(
        (item) => item.type === "minecraft:oak_planks" && item.count === 1,
      ),
  );
}

async function fixture(
  context: CaptureContext,
  tag: string,
  sticky = false,
): Promise<void> {
  await pad(context, [12, 3, 8]);
  await context.set(
    context.at(3, 0, 6),
    context.at(3, 0, 6),
    `minecraft:${sticky ? "sticky_piston" : "piston"}[extended=false,facing=east]`,
  );
  await wallSign(context, {
    position: [3, 0, 5],
    standing: [3.5, 0, 2.5],
    lines: ["", tag, "", ""],
  });
  await context.feedback("Built.");
}

async function photo(
  context: CaptureContext,
  name: string,
  caption: string,
): Promise<void> {
  await camera(context, [6, 0, 0.5], [6, 0.5, 6.5]);
  await context.capture({
    schema: 1,
    name,
    alt: caption,
    caption,
    annotations: [],
  });
}

async function power(context: CaptureContext, enabled: boolean): Promise<void> {
  // Vanilla neighbor updates are required for the retraction event.
  await context.command(
    `minecraft:setblock ${context.at(2, 0, 6).join(" ")} minecraft:${enabled ? "redstone_block" : "air"}`,
  );
}

export default defineCaptureScene({
  name: "special-pistons",
  description:
    "Compare Crush and SuperPush before and after real redstone events",
  bounds: { min: [0, -1, 0], max: [12, 4, 8] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    await context.track("mechanic", 5);
  },
  run: async (context) => {
    await fixture(context, "[Crush]");
    await context.set(
      context.at(4, 0, 6),
      context.at(4, 0, 6),
      "minecraft:oak_planks",
    );
    await photo(
      context,
      "crush-before",
      "A Crush piston faces a single oak plank before receiving redstone power.",
    );
    await power(context, true);
    await waitBlock(context, [3, 0, 6], (block) =>
      block.includes("extended=true"),
    );
    await waitBlock(context, [5, 0, 6], (block) => block === "minecraft:air");
    await photo(
      context,
      "crush-after",
      "Crush breaks the plank instead of pushing it ahead of the extended head.",
    );
    // Retract the head before approaching the ejected drop.
    await power(context, false);
    await waitBlock(context, [3, 0, 6], (block) =>
      block.includes("extended=false"),
    );
    await collectCrushedPlank(context);

    await fixture(context, "[SuperPush]");
    await context.set(
      context.at(4, 0, 6),
      context.at(5, 0, 6),
      "minecraft:oak_planks",
    );
    await photo(
      context,
      "super-push-before",
      "Two oak planks sit directly in front of the SuperPush piston.",
    );
    await power(context, true);
    await waitBlock(
      context,
      [9, 0, 6],
      (block) => block === "minecraft:oak_planks",
    );
    await waitBlock(
      context,
      [10, 0, 6],
      (block) => block === "minecraft:oak_planks",
    );
    await photo(
      context,
      "super-push-after",
      "After normal extension, SuperPush moves the two planks four blocks farther.",
    );
  },
});
