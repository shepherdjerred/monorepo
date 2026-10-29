import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { camera, inspectors } from "./fixtures.ts";

export default defineCaptureScene({
  name: "command-guides",
  description: "Capture real command output over the populated map",
  bounds: { min: [0, -1, 0], max: [0, -1, 0] },
  staging: [-3, 0, -3],
  inspectors,
  setup: async (context) => {
    if (context.target === "live")
      throw new Error("Command examples require the owned local demo account");
    await context.prepare(`minecraft:deop ${context.name}`, {
      kind: "command",
      command: `minecraft:op ${context.name}`,
    });
    await camera(context, [-2.5, 0, -2.5], [0, 1, 0]);
  },
  run: async (context) => {
    for (const [name, command, feedback, caption] of [
      [
        "perks-overview",
        "perks",
        "Your tracks:",
        "The perks overview shows your level and the next price for every track.",
      ],
      [
        "perks-mechanic",
        "perks info mechanic",
        "Mechanic:",
        "The Mechanic detail lists the builds unlocked at each level.",
      ],
      [
        "travel-prices",
        "tpinfo",
        "Each command has its own price",
        "Use /tpinfo to check the configured price and cooldown for each kind of travel.",
      ],
      [
        "chat-channels",
        "channels",
        "Channels (",
        "The channel list shows which conversations are visible and where you are speaking.",
      ],
      [
        "help-mail",
        "help mail",
        "mail [send",
        "Use /help followed by a command to see its syntax.",
      ],
      [
        "ticket-help",
        "ticket",
        "what happened",
        "Start a report with /ticket and a description of the problem.",
      ],
    ] as const) {
      await context.action("clear-overlays");
      await context.playerCommand(command, feedback);
      await context.action("chat-open");
      await context.waitFor(
        "expanded command output",
        (state) => state.connected && state.screen !== "",
      );
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
