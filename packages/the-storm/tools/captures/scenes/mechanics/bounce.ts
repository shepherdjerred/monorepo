import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { localHelper } from "#captures/helper.ts";
import {
  pad,
  wallSign,
  camera,
  inspectors,
} from "#captures/scenes/fixtures.ts";
import shots from "#captures/presentations/mechanics/bounce.ts";
import { presentation } from "#captures/presentations/lookup.ts";

export default defineCaptureScene({
  name: "bounce-launch",
  description:
    "A real redstone pulse launches a genuine second player from a Bounce piston",
  bounds: { min: [0, -1, 0], max: [12, 26, 12] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    await context.track("mechanic", 4);
    await pad(context, [12, 26, 12]);
    await context.set(
      context.at(5, 0, 5),
      context.at(5, 0, 5),
      "minecraft:piston[facing=up,extended=false]",
    );
    await wallSign(context, {
      position: [5, 0, 4],
      standing: [5.5, 0, 2.5],
      lines: ["", "[Bounce]", "", ""],
    });
    await context.feedback("Built.");
    const helper = await localHelper(context);
    await context.command(`minecraft:gamemode survival ${helper.name}`);
    await context.command(
      `minecraft:execute in minecraft:overworld run minecraft:tp ${helper.name} ${context.at(5.5, 1, 5.5).join(" ")} 180 0`,
    );
    await context.playerCommand("pvp status", "Your PvP is on.");
    await helper.command("pvp status", "Your PvP is on.");
    await camera(context, [9.5, 0, 1.5], [5.5, 1.4, 5.5]);
  },
  run: async (context) => {
    const helper = await localHelper(context);
    const initialStatus = await helper.status();
    const initial = initialStatus.state;
    if (
      !initial.connected ||
      Math.abs(initial.position[1] - context.at(0, 1, 0)[1]) > 0.2
    )
      throw new Error("Bounce volunteer is not standing on the piston");
    await context.capture(presentation(shots, "bounce-before"));
    await camera(context, [17.5, 0, -3.5], [5.5, 7, 5.5]);
    await context.record(
      presentation(shots, "bounce-launch-demo"),
      async () => {
        await context.step("launch", async () => {
          await context.command(
            `minecraft:setblock ${context.at(4, 0, 5).join(" ")} minecraft:redstone_block`,
          );
          const deadline = performance.now() + 5000;
          let launched = false;
          while (performance.now() < deadline) {
            const status = await helper.status();
            const state = status.state;
            if (
              state.connected &&
              state.position[1] > initial.position[1] + 3
            ) {
              launched = true;
              break;
            }
            await Bun.sleep(25);
          }
          if (!launched)
            throw new Error("Bounce did not launch the genuine player");
        });
        const deadline = performance.now() + 5000;
        for (;;) {
          const status = await helper.status();
          if (
            status.state.connected &&
            status.state.position[1] <= initial.position[1] + 1.3
          )
            break;
          if (performance.now() > deadline)
            throw new Error("Bounce volunteer did not return from the launch");
          await Bun.sleep(50);
        }
        await context.command(
          `minecraft:setblock ${context.at(4, 0, 5).join(" ")} minecraft:air`,
        );
      },
      5,
    );
  },
});
