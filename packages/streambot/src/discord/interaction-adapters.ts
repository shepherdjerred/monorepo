/**
 * Adapters from discord.js interactions to the {@link CommandInteraction} surface
 * `command-handler.ts` is written against. Kept out of `command-bot.ts` so that file stays under the
 * 500-line `max-lines` cap, and out of the handler so the handler stays discord.js-free.
 */
import {
  type ChatInputCommandInteraction,
  MessageFlags,
  type MessageComponentInteraction,
} from "discord.js";
import type { CommandInteraction } from "@shepherdjerred/streambot/discord/command-handler.ts";
import { sendPaginatedReply } from "@shepherdjerred/streambot/discord/pagination.ts";
import { sendSubtitleMenu } from "@shepherdjerred/streambot/discord/subtitle-menu.ts";
import { toUserId } from "@shepherdjerred/streambot/types/ids.ts";

/** Adapt a real slash-command interaction. Every reply is ephemeral; public output is separate. */
export function adaptCommandInteraction(
  interaction: ChatInputCommandInteraction,
): CommandInteraction {
  return {
    userId: toUserId(interaction.user.id),
    subcommand: () => interaction.options.getSubcommand(),
    getString: (name) => interaction.options.getString(name),
    getStringRequired: (name) => interaction.options.getString(name, true),
    getIntegerRequired: (name) => interaction.options.getInteger(name, true),
    reply: async (content) => {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    },
    defer: async () => {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    },
    editReply: async (content) => {
      await interaction.editReply(content);
    },
    replyPaginated: async (payload) => {
      await sendPaginatedReply(interaction, payload);
    },
    replySelectMenu: (candidates) => sendSubtitleMenu(interaction, candidates),
  };
}

/** Options are never read on the card's only handler path (`subtitles`); reading one is a wiring bug. */
function unavailableOption(name: string): never {
  throw new Error(`player card cannot supply the "${name}" option`);
}

/**
 * Adapt a player-card component interaction so it can drive a real `/stream <subcommand>` handler.
 * Only option-free subcommands are reachable this way — anything that reads an option or paginates
 * fails loudly rather than silently substituting a default.
 */
export function adaptCardInteraction(
  interaction: MessageComponentInteraction,
  subcommand: string,
): CommandInteraction {
  return {
    userId: toUserId(interaction.user.id),
    subcommand: () => subcommand,
    getString: () => null,
    getStringRequired: (name) => unavailableOption(name),
    getIntegerRequired: (name) => unavailableOption(name),
    reply: async (content) => {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    },
    defer: async () => {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    },
    editReply: async (content) => {
      await interaction.editReply(content);
    },
    replyPaginated: () =>
      Promise.reject(new Error("player card replies are never paginated")),
    replySelectMenu: (candidates) => sendSubtitleMenu(interaction, candidates),
  };
}
