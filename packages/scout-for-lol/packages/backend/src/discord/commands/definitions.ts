import { helpCommand } from "#src/discord/commands/help.ts";
import {
  docsCommand,
  inviteCommand,
  setupCommand,
  statusCommand,
} from "#src/discord/commands/onboarding.ts";
import { listCommand } from "#src/discord/commands/list.ts";
import { trackCommand } from "#src/discord/commands/track.ts";
import { bbCommand } from "#src/discord/commands/bb.ts";

export const commandDefinitions = [
  helpCommand,
  setupCommand,
  statusCommand,
  inviteCommand,
  docsCommand,
  trackCommand,
  listCommand,
  bbCommand,
] as const;

export const commandPayload = commandDefinitions.map((command) =>
  command.toJSON(),
);
