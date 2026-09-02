import type { ActionRowBuilder, ButtonBuilder } from "discord.js";

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
