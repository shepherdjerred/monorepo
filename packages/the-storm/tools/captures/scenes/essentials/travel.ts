import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { localHelper } from "#captures/helper.ts";
import { camera, inspectors } from "#captures/scenes/fixtures.ts";
import shots from "#captures/presentations/essentials/travel.ts";
import { presentation } from "#captures/presentations/lookup.ts";

export default defineCaptureScene({
  name: "homes-and-requests",
  description: "Save a home and receive a request from a genuine second player",
  bounds: { min: [0, -1, 0], max: [12, 4, 12] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    await camera(context, [2.5, 0, 2.5], [12, 1, 12]);
    await context.defer({
      kind: "player-command",
      command: "delhome docs-camp",
      expectedMessage: "Deleted home docs-camp.",
      standing: context.at(2.5, 0, 2.5),
      look: context.at(12, 1, 12),
    });
    await context.playerCommand("sethome docs-camp", "Home docs-camp.");
  },
  run: async (context) => {
    await context.action("clear-overlays");
    await context.playerCommand("homes", "docs-camp");
    await context.action("chat-open");
    await context.capture(presentation(shots, "saved-homes"));
    await context.action("close");
    await context.action("clear-overlays");
    const helper = await localHelper(context);
    await helper.command(
      `tpa ${context.name}`,
      `Request sent to ${context.name}`,
    );
    await context.feedback(`${helper.name} wants to teleport to you.`);
    await context.action("chat-open");
    await context.capture(presentation(shots, "incoming-teleport-request"));
    await context.action("close");
    await context.playerCommand(`tpdeny ${helper.name}`, "Request denied.");
    await helper.feedback(`${context.name} denied your request.`);
  },
});
