import type {
  Message,
  MessageComponentInteraction,
  MessageEditOptions,
} from "discord.js";

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
