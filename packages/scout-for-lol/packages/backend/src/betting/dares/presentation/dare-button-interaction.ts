import {
  type Interaction,
  type ActionRowBuilder,
  type ButtonBuilder,
  type InteractionReplyOptions,
} from "discord.js";

/** Structural Discord interaction a Dare button handler needs. */
export type DareButtonInteractionBase = {
  customId: string;
  guildId: Interaction["guildId"];
  user: { id: string };
  deferReply: (options: { ephemeral: true }) => Promise<unknown>;
  deferUpdate: () => Promise<unknown>;
  editReply: (options: {
    content: string;
    components?: ActionRowBuilder<ButtonBuilder>[];
    embeds?: never[];
  }) => Promise<unknown>;
};

/** What the router needs on top: an ephemeral apology after a failure. */
export type DareButtonInteraction = DareButtonInteractionBase & {
  followUp: (options: InteractionReplyOptions) => Promise<unknown>;
};
