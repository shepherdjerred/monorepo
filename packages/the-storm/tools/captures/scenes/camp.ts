import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { camera, inspectors } from "./fixtures.ts";
import { localHelper } from "#captures/helper.ts";

export default defineCaptureScene({
  name: "camp-claims",
  description: "Claim and share one complete chunk with another genuine player",
  // The complete claimed chunk, including the land outside the camera's immediate view.
  bounds: { min: [0, -1, -8], max: [15, 8, 7] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    await localHelper(context);
    await camera(context, [0.5, 0, -0.5], [3, 1, 1]);
    await context.defer({
      kind: "player-command",
      command: "camp delete delete",
      expectedMessage: "Deleted your camp",
      standing: context.at(0.5, 0, -0.5),
      look: context.at(3, 1, 1),
    });
    await context.playerCommand("camp create", "Created your camp.");
    await context.playerCommand("claim", "Claimed chunk");
    await context.playerCommand(
      "camp invite TsmcDemoHelper",
      "Invited TsmcDemoHelper",
    );
    const helper = await localHelper(context);
    await helper.command("camp join XiguaJerred", "Joined the camp.");
  },
  run: async (context) => {
    for (const [name, command, expected, caption] of [
      [
        "camp-overview",
        "camp",
        "Your camp has",
        "Your camp reports its members, claimed chunks, and activity window.",
      ],
      [
        "claim-personal",
        "claim personal",
        "is yours.",
        "A personal chunk keeps building and container access with its holder.",
      ],
      [
        "claim-shared",
        "claim shared",
        "is shared with your camp again.",
        "Sharing the chunk restores access for the camp.",
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
