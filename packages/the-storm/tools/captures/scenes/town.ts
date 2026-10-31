import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { camera, inspectors } from "./fixtures.ts";
import { localHelper } from "#captures/helper.ts";

export default defineCaptureScene({
  name: "town-management",
  description:
    "Show owner and assistant roles and the ownership handover confirmation",
  bounds: { min: [0, -1, -8], max: [15, 8, 7] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    await localHelper(context);
    await context.track("governor", 1);
    await camera(context, [0.5, 0, -0.5], [3, 1, 1]);
    await context.defer({
      kind: "player-command",
      command: "town delete DocsTown",
      expectedMessage: "Deleted DocsTown",
      standing: context.at(0.5, 0, -0.5),
      look: context.at(3, 1, 1),
    });
    await context.playerCommand("town create DocsTown", "Founded DocsTown.");
    await context.playerCommand("claim", "Claimed chunk");
    await context.playerCommand("town invite TsmcDemoHelper", "Invited");
    const helper = await localHelper(context);
    await helper.command("town accept DocsTown", "You joined DocsTown.");
    await context.playerCommand(
      "town promote TsmcDemoHelper",
      "is now an assistant.",
    );
  },
  run: async (context) => {
    for (const [name, command, expected, caption] of [
      [
        "town-roles",
        "town info",
        "assistant TsmcDemoHelper",
        "Town information lists the owner, assistants, and members.",
      ],
      [
        "town-transfer-confirmation",
        "town transfer TsmcDemoHelper",
        "type /town transfer confirm",
        "Ownership handover requires a separate confirmation before the owner changes.",
      ],
    ] as const) {
      await context.action("clear-overlays");
      await context.playerCommand(command, expected);
      await context.action("chat-open");
      await context.capture({
        schema: 1,
        name,
        alt: caption,
        caption,
        annotations: [],
      });
      await context.action("close");
    }
  },
});
