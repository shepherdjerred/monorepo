import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { chatCamera, inspectors, commandShot } from "./fixtures.ts";
import { localHelper } from "#captures/helper.ts";

export default defineCaptureScene({
  name: "town-management",
  description:
    "Show owner and assistant roles and the ownership handover confirmation",
  bounds: { min: [0, -1, 0], max: [15, 8, 15] },
  staging: [20.5, 2, -29.5],
  inspectors,
  setup: async (context) => {
    await localHelper(context);
    await context.track("governor", 1);
    await chatCamera(context);
    await context.defer({
      kind: "player-command",
      command: "town delete Riverbend",
      expectedMessage: "Deleted Riverbend",
      standing: context.at(0.5, 0, 0.5),
      look: context.at(3, 1, 1),
    });
    await context.playerCommand("town create Riverbend", "Founded Riverbend.");
    await context.playerCommand("claim", "Claimed chunk");
    await context.playerCommand("town invite MapleFox", "Invited");
    const helper = await localHelper(context);
    await helper.command("town accept Riverbend", "You joined Riverbend.");
    await context.playerCommand(
      "town promote MapleFox",
      "is now an assistant.",
    );
  },
  run: async (context) => {
    for (const shot of [
      [
        "town-roles",
        "town info",
        "assistant MapleFox",
        "Town information lists the owner, assistants, and members.",
      ],
      [
        "town-transfer-confirmation",
        "town transfer MapleFox",
        "type /town transfer confirm",
        "Ownership handover requires a separate confirmation before the owner changes.",
      ],
    ] as const) {
      await commandShot(context, shot);
    }
  },
});
