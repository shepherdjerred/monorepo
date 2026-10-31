import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { pad, camera, inspectors } from "./fixtures.ts";

export default defineCaptureScene({
  name: "container-locks",
  description:
    "Show private, public, donation, supply and display locks plus a trusted player",
  bounds: { min: [0, -1, 0], max: [7, 3, 6] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    if (context.target === "live")
      throw new Error("Lock examples require an isolated map copy");
    await pad(context, [7, 3, 6]);
    await context.set(
      context.at(3, 0, 3),
      context.at(3, 0, 3),
      "minecraft:barrel[facing=north]",
    );
    await camera(context, [3.5, 0, 0.5], [3.5, 0.5, 3.5]);
    await context.defer({
      kind: "player-command",
      command: "unlock",
      expectedMessage: "Unlocked.",
      standing: context.at(3.5, 0, 0.5),
      look: context.at(3.5, 0.5, 3.5),
    });
    await context.playerCommand("lock private", "Locked as private.");
  },
  run: async (context) => {
    for (const [kind, caption] of [
      [
        "private",
        "A private lock names its owner and blocks untrusted players.",
      ],
      ["public", "A public lock allows anyone to use the container."],
      [
        "donation",
        "A donation lock lets visitors add items without taking them.",
      ],
      ["supply", "A supply lock lets visitors take items without adding them."],
      ["display", "A display lock lets visitors look without moving items."],
    ] as const) {
      if (kind !== "private")
        await context.playerCommand(
          `lock ${kind}`,
          `This lock is now ${kind}.`,
        );
      await context.action("clear-overlays");
      await context.playerCommand("lock info", `; ${kind}.`);
      await context.action("chat-open");
      await context.capture({
        schema: 1,
        name: `lock-${kind}`,
        alt: caption,
        caption,
        annotations: [],
      });
      await context.action("close");
    }
    await context.playerCommand("lock private", "This lock is now private.");
    await context.playerCommand(
      "lock trust TsmcDemoHelper manage",
      "can now open and break it.",
    );
    await context.action("clear-overlays");
    await context.playerCommand("lock info", "TsmcDemoHelper (manage)");
    await context.action("chat-open");
    await context.capture({
      schema: 1,
      name: "lock-trusted",
      alt: "Lock information lists TsmcDemoHelper with manage access",
      caption:
        "Manage access lets a trusted player open and break the locked container.",
      annotations: [],
    });
    await context.action("close");
  },
});
