import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { CommandBotDeps } from "./commands/command-bot-deps.ts";
import { webPageUrl } from "./web-link.ts";
import { DiscordMusicBrowser } from "./music-browser.ts";
import { runPlaylistCommand } from "./music-playlists.ts";

export async function runMusicCommand(
  interaction: ChatInputCommandInteraction,
  deps: CommandBotDeps,
) {
  if (interaction.options.getSubcommand() === "web") {
    const page = interaction.commandName === "music" ? "/music" : "/plex";
    const url = await webPageUrl(
      deps.config,
      {
        guildId: interaction.guildId ?? undefined,
        userId: interaction.user.id,
      },
      page,
    );
    await interaction.reply({
      content:
        url === undefined
          ? "The Streambot web remote is not available here yet."
          : "[Open Streambot](" + url + ")",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.options.getSubcommandGroup() === "playlist") {
    await runPlaylistCommand(interaction, deps);
    return;
  }
  await new DiscordMusicBrowser(interaction, deps).run();
}
