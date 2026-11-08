import {
  defineCaptureScene,
  type CaptureContext,
} from "@shepherdjerred/mc-harness/capture/define.ts";
import { fixtureAim } from "@shepherdjerred/mc-harness/capture/camera.ts";
import shots from "#captures/presentations/worlds/world-tour.ts";
import { presentation } from "#captures/presentations/lookup.ts";
import { assertLanding } from "@shepherdjerred/mc-harness/capture/landing.ts";
import { CaptureTransport } from "@shepherdjerred/mc-harness/capture/transport.ts";

async function control(
  context: CaptureContext,
  position: [number, number, number],
  standing: [number, number, number],
) {
  const block = await context.block(position);
  await context.teleport(standing, 0, 0);
  await context.lookAt(fixtureAim(position, block));
}
async function waitClosed(context: CaptureContext) {
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    if ((await context.block([6, 74, 110])) === "minecraft:air") return;
    await Bun.sleep(100);
  }
  throw new Error("Welcome gate did not close");
}
export default defineCaptureScene({
  name: "welcome-gate-and-landmarks",
  description:
    "Use the preserved welcome gate to visit Skylands, then photograph authentic spawn landmarks",
  bounds: { min: [-112, -20, -212], max: [140, 50, 60] },
  staging: [-2.5, 0, -2.5],
  inspectors: [],
  setup: async (context) => {
    await context.command("minecraft:time set 6000");
    await context.command("minecraft:weather clear");
    await context.command(`minecraft:gamemode survival ${context.name}`);
    await context.command(`minecraft:clear ${context.name}`);
    await context.action("hotbar", { slot: 8 });
    await context.action("clear-overlays");
  },
  run: async (context) => {
    await control(context, [9, 75, 111], [9.5, 73, 113.5]);
    for (const destination of ["2026", "2015", "Skylands"]) {
      await context.use();
      await context.feedback(`Destination: ${destination}.`);
    }
    await context.action("chat-open");
    await context.capture(presentation(shots, "welcome-gate-selection"));
    await context.action("close");
    await control(context, [3, 75, 111], [3.5, 73, 113.5]);
    await context.use();
    await context.feedback("World gate open to Skylands.");
    await context.teleport([6.5, 73, 116.5], 180, 0);
    await context.lookAt([6, 76, 110.5]);
    await context.action("clear-overlays");
    await context.capture(presentation(shots, "welcome-stargate"));
    await waitClosed(context);
    await control(context, [3, 75, 111], [3.5, 73, 113.5]);
    await context.record(
      presentation(shots, "welcome-gate"),
      async () => {
        await context.step("open", async () => {
          await context.use();
          await context.feedback("World gate open to Skylands.");
        });
        await context.teleport([6.5, 73, 113.5], 180, 0);
        await context.lookAt([6.5, 75, 110.5]);
        await context.step("travel", async () => {
          // Stop walking at the world transition instead of carrying movement off the arrival island.
          for (let attempt = 0; attempt < 20; attempt++) {
            const state = await context.status();
            if (state.connected && state.world === "minecraft:skylands") break;
            await context.action("move", {
              buttons: ["forward", "jump"],
              ticks: 3,
            });
          }
          await context.action("release-inputs");
          await context.waitFor(
            "Skylands arrival",
            (s) =>
              s.connected &&
              s.world === "minecraft:skylands" &&
              s.screen === "",
          );
        });
        await context.lookAt([0, 82, 0]);
      },
      4,
    );
    await context.action("clear-overlays");
    const overlook: [number, number, number] = [15.5, 129, 30.5];
    await assertLanding(
      new CaptureTransport(context.target, "Verify imported Skylands overlook"),
      "skylands",
      overlook,
    );
    await context.command(
      `minecraft:execute in minecraft:skylands run minecraft:tp ${context.name} ${overlook.join(" ")}`,
    );
    await context.waitFor(
      "Skylands island overlook",
      (s) =>
        s.connected &&
        s.world === "minecraft:skylands" &&
        s.position.every(
          (v, i) => Math.abs(v - (overlook[i] ?? Infinity)) < 0.2,
        ),
    );
    await context.lookAt([10, 114, -20]);
    await context.capture(presentation(shots, "skylands"));
    await context.command(
      `minecraft:execute in minecraft:overworld run minecraft:tp ${context.name} 68.5 69 66.5`,
    );
    await context.waitFor(
      "return to main map",
      (s) => s.connected && s.world === "minecraft:overworld",
    );
    // Stay west of the trader and windmill porch so neither fills the town view.
    await context.teleport([64.5, 69, 66.5], 0, 0);
    await context.lookAt([-15, 73, 30]);
    await context.capture(presentation(shots, "spawn-town"));
    await context.teleport([146.5, 68, -88.5], 0, 0);
    await context.lookAt(
      fixtureAim([143, 69, -89], await context.block([143, 69, -89])),
    );
    await context.capture(presentation(shots, "historic-market-shop"));
  },
});
