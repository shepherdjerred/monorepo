import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandBotDeps } from "./command-bot-deps.ts";
import { runMusicCommand } from "@shepherdjerred/streambot/discord/music.ts";
import { runExternalMusicCommand } from "@shepherdjerred/streambot/discord/music-links.ts";
import {
  UserIdSchema,
  type ChannelId,
} from "@shepherdjerred/streambot/types/ids.ts";

export async function handleMusicCommand(
  interaction: ChatInputCommandInteraction,
  deps: CommandBotDeps,
  issuerVoiceChannel: () => ChannelId | null,
): Promise<boolean> {
  if (
    interaction.commandName === "music" ||
    (interaction.options.getSubcommandGroup() === "playback" &&
      interaction.options.getSubcommand() === "web")
  ) {
    await runMusicCommand(interaction, deps);
    return true;
  }
  if (await runExternalMusicCommand(interaction, deps)) return true;
  const sub = interaction.options.getSubcommand();
  const voice = issuerVoiceChannel();
  if (
    voice !== null &&
    interaction.guildId !== null &&
    ["stop", "clear", "leave"].includes(sub) &&
    deps.config.discord.adminIds.includes(
      UserIdSchema.parse(interaction.user.id),
    )
  ) {
    deps.music?.loads.cancelRoom(
      interaction.guildId,
      voice,
      sub === "leave"
        ? undefined
        : await deps.getSessions().selectedChannel({
            guildId: interaction.guildId,
            channelId: voice,
            userId: interaction.user.id,
          }),
    );
  }
  return false;
}
