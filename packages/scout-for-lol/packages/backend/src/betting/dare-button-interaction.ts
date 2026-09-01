import type { ActionRowBuilder, ButtonBuilder } from "discord.js";

/** Structural Discord interaction shared by both Dare contract versions. */
export type DareButtonInteractionBase = {
  customId: string;
  guildId: string | null;
  user: { id: string };
  deferReply: (options: { ephemeral: true }) => Promise<unknown>;
  deferUpdate: () => Promise<unknown>;
  editReply: (options: {
    content: string;
    components?: ActionRowBuilder<ButtonBuilder>[];
    embeds?: never[];
  }) => Promise<unknown>;
};
