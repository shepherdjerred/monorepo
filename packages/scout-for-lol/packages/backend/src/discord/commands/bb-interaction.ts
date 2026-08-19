import type { ChatInputCommandInteraction } from "discord.js";
import type {
  CommandEditReply,
  CommandReply,
} from "#src/discord/commands/define-command.ts";

export type BbCommandInteraction = {
  id: string;
  guildId: string | null;
  user: { id: string };
  options: Pick<
    ChatInputCommandInteraction["options"],
    "getSubcommand" | "getString" | "getInteger"
  >;
  replied: boolean;
  deferred: boolean;
  reply: CommandReply;
  deferReply: (
    ...args: Parameters<ChatInputCommandInteraction["deferReply"]>
  ) => Promise<unknown>;
  editReply: CommandEditReply;
  followUp: (
    ...args: Parameters<ChatInputCommandInteraction["followUp"]>
  ) => Promise<unknown>;
};
