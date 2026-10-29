import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import type { CaptureContext } from "@shepherdjerred/mc-harness/capture/define.ts";

async function waitForSpan(
  context: CaptureContext,
  expected: string,
): Promise<void> {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if ((await context.block(context.at(4, -1, 3))) === expected) return;
    await Bun.sleep(50);
  }
  throw new Error(`Bridge span did not become ${expected}`);
}

export default defineCaptureScene({
  name: "moving-bridge",
  description: "Toggle a sign-controlled bridge over a small temporary trench",
  bounds: { min: [-1, -3, 0], max: [9, 3, 6] },
  staging: [-3, 0, -3],
  inspectors: ["wilderness", "shops", "banks"],
  setup: async (context) => {
    await context.track("mechanic", 2);
    await context.command(`minecraft:gamemode creative ${context.name}`);
    await context.set(
      context.at(-1, 0, 0),
      context.at(9, 3, 6),
      "minecraft:air",
    );
    await context.set(
      context.at(-1, -1, 0),
      context.at(9, -1, 6),
      "minecraft:stone_bricks",
    );
    await context.set(
      context.at(2, -3, 3),
      context.at(6, -1, 3),
      "minecraft:air",
    );
    for (const [x, standing] of [
      [1, -0.5],
      [7, 8.5],
    ]) {
      if (x === undefined || standing === undefined)
        throw new Error("Missing bridge endpoint");
      await context.set(
        context.at(x, -1, 3),
        context.at(x, -1, 3),
        "minecraft:oak_planks",
      );
      await context.teleport(context.at(standing, 0, 3.5), 0, 0);
      await context.command(
        `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:oak_sign`,
      );
      await context.action("hotbar", { slot: 0 });
      await context.lookAt(context.at(x + 0.5, -0.01, 3.5));
      await context.use();
      await context.defer({
        kind: "break",
        position: context.at(x, 0, 3),
        standing: context.at(standing, 0, 3.5),
      });
      await context.sign(["", "[Bridge]", "", ""]);
      await context.feedback("Built.");
    }
    await context.teleport(context.at(4.5, 0, 0.5), 0, 0);
    await context.lookAt(context.at(1.5, 0.5, 3.5));
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:oak_planks 5`,
    );
    await context.action("hotbar", { slot: 0 });
    await context.use();
    await context.feedback("Added 5");
  },
  run: async (context) => {
    await context.command(`minecraft:gamemode survival ${context.name}`);
    await context.action("hotbar", { slot: 7 });
    await context.teleport(context.at(4.5, 0, 0.5), 0, 0);
    await context.lookAt(context.at(4.5, -0.5, 3.5));
    await context.action("clear-overlays");
    await context.capture({
      schema: 1,
      name: "bridge-retracted",
      alt: "The moving bridge is retracted, leaving a gap between its matching ends",
      caption: "Matching Bridge signs control the gap between the fixed ends.",
      annotations: [],
    });
    await context.lookAt(context.at(1.5, 0.5, 3.5));
    await context.record(
      {
        schema: 1,
        name: "moving-bridge",
        alt: "A sign-controlled bridge opens and closes over a trench",
        caption: "Right-click either Bridge sign to toggle the moving section.",
        annotations: [
          {
            kind: "label",
            from: [0.15, 0.2],
            to: [0.15, 0.2],
            text: "Walkway extended",
            atStep: "open-end",
            startMs: 0,
            endMs: 1500,
          },
          {
            kind: "label",
            from: [0.15, 0.2],
            to: [0.15, 0.2],
            text: "Walkway retracted",
            atStep: "close-end",
            startMs: 0,
            endMs: 1500,
          },
        ],
      },
      async () => {
        await context.step("open", async () => {
          await context.use();
          await waitForSpan(context, "minecraft:oak_planks");
        });
        await context.action("pan", { yaw: 0, pitch: 35, ticks: 30 });
        await context.lookAt(context.at(1.5, 0.5, 3.5));
        await context.step("close", async () => {
          await context.use();
          await waitForSpan(context, "minecraft:air");
        });
        await context.action("pan", { yaw: 0, pitch: 35, ticks: 30 });
      },
      5,
    );
    await context.lookAt(context.at(1.5, 0.5, 3.5));
    await context.use();
    await waitForSpan(context, "minecraft:oak_planks");
    await context.lookAt(context.at(4.5, -0.5, 3.5));
    await context.action("clear-overlays");
    await context.capture({
      schema: 1,
      name: "bridge-extended",
      alt: "Bridge planks span the five spaces between its fixed ends",
      caption: "Activating either sign extends the walkway across the gap.",
      annotations: [],
    });
    // Keep stock placed: terrain restoration removes it without dropping stored materials.
  },
});
