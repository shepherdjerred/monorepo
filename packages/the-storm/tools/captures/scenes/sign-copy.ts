import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { pad, wallSign, camera, inspectors } from "./fixtures.ts";

export default defineCaptureScene({
  name: "sign-copying",
  description: "Copy one sign's text onto another with the feather tool",
  bounds: { min: [0, -1, 0], max: [7, 3, 6] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    await context.track("mechanic", 3);
    await pad(context, [7, 3, 6]);
    for (const x of [2, 5]) {
      await context.set(
        context.at(x, 0, 4),
        context.at(x, 1, 4),
        "minecraft:stone_bricks",
      );
      await wallSign(context, {
        position: [x, 1, 3],
        standing: [x + 0.5, 0, 0.5],
        lines:
          x === 2
            ? ["The Storm", "Welcome home", "Storage room", ""]
            : ["", "", "", ""],
      });
    }
    await camera(context, [3.5, 0, 0.5], [2.5, 1.5, 3.5]);
    await context.command(
      `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:feather`,
    );
    await context.action("hotbar", { slot: 0 });
  },
  run: async (context) => {
    await context.attack();
    await context.feedback("Copied. Right-click a sign to paste.");
    await context.lookAt(context.at(5.5, 1.5, 3.5));
    await context.use();
    await context.feedback("Pasted.");
    await context.action("hotbar", { slot: 7 });
    await context.lookAt(context.at(3.5, 1.5, 3.5));
    await context.action("clear-overlays");
    await context.capture({
      schema: 1,
      name: "sign-copied",
      alt: "Two signs now display the same welcome and storage-room text",
      caption:
        "Punch the source sign with a feather, then right-click the destination to paste its text.",
      annotations: [],
    });
  },
});
