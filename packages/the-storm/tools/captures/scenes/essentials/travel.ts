import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { localHelper } from "#captures/helper.ts";
import { chatCamera, chatVenue } from "#captures/scenes/fixtures.ts";
import shots from "#captures/presentations/essentials/travel.ts";
import { presentation } from "#captures/presentations/lookup.ts";

export default defineCaptureScene({
  name: "homes-and-requests",
  description: "Save a home and receive a request from a genuine second player",
  ...chatVenue,
  setup: async (context) => {
    await chatCamera(context);
    await context.defer({
      kind: "player-command",
      command: "delhome riverside",
      expectedMessage: "Deleted home riverside.",
      standing: context.at(0.5, 0, 0.5),
      look: context.at(-63, 6, -66),
    });
    await context.playerCommand("sethome riverside", "Home riverside.");
  },
  run: async (context) => {
    await context.action("clear-overlays");
    await context.playerCommand("homes", "riverside");
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
