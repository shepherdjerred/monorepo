import type {
  ChatInputCommandInteraction,
  Message,
  MessageComponentInteraction,
  MessageEditOptions,
} from "discord.js";
import { MessageFlags } from "discord.js";

export type MusicLinkReply = {
  start: (payload: MessageEditOptions) => Promise<void>;
  edit: (payload: MessageEditOptions) => Promise<unknown>;
  onCancel: (
    listener: (component: MessageComponentInteraction) => void,
  ) => Promise<void>;
};

export function collectMusicCancellation(
  message: Message,
  listener: (component: MessageComponentInteraction) => void,
): void {
  message
    .createMessageComponentCollector({ time: 5 * 60_000 })
    .on("collect", listener);
}

export function interactionMusicLinkReply(
  interaction: ChatInputCommandInteraction,
): MusicLinkReply {
  return {
    start: async (payload) => {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply(payload);
    },
    edit: (payload) => interaction.editReply(payload),
    onCancel: async (listener) => {
      collectMusicCancellation(await interaction.fetchReply(), listener);
    },
  };
}
