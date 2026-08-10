import { helpCommand } from "#src/discord/commands/help.ts";
import {
  docsCommand,
  inviteCommand,
  setupCommand,
  statusCommand,
} from "#src/discord/commands/onboarding.ts";
import { listCommand } from "#src/discord/commands/list.ts";
import { trackCommand } from "#src/discord/commands/track.ts";

export const commandDefinitions = [
  helpCommand,
  setupCommand,
  statusCommand,
  inviteCommand,
  docsCommand,
  trackCommand,
  listCommand,
] as const;

export const commandPayload = commandDefinitions.map((command) =>
  command.toJSON(),
);
