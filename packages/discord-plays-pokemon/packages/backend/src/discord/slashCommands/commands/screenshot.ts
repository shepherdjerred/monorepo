import type { ChatInputCommandInteraction, Client } from "discord.js";
import {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  time,
  userMention,
} from "discord.js";
import { encodePng } from "#src/emulator/png.ts";
import type { PokemonGameDriver } from "#src/lifecycle/pokemon-driver.ts";

export const screenshotCommand = new SlashCommandBuilder()
  .setName("screenshot")
  .setDescription("Take a screenshot and upload it to the game channel.");

const SCREENSHOT_SCALE = 3;

export function makeScreenshot(driver: PokemonGameDriver, botClient: Client) {
  return async function handleScreenshotCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "`/screenshot` must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const runtime = driver.getActiveRuntime();
    if (runtime?.session.guildId !== interaction.guildId) {
      await interaction.reply({
        content:
          "No Pokémon session is active in this server. Run `/play` first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const buffer = encodePng(runtime.emulator.renderFrame(), SCREENSHOT_SCALE);
    const date = new Date();
    const attachment = new AttachmentBuilder(buffer, {
      name: "screenshot.png",
      description: `Screenshot of the Pokémon game at ${date.toISOString()}`,
    });
    const embed = new EmbedBuilder()
      .setTitle("Pokémon Screenshot")
      .setImage("attachment://screenshot.png");
    await interaction.reply({
      content: "Screenshot sent to the game channel.",
      flags: MessageFlags.Ephemeral,
    });

    const channel = await botClient.channels.fetch(
      runtime.session.textChannelId,
    );
    if (channel?.type === ChannelType.GuildText) {
      await channel.send({
        content: `Screenshot taken by ${userMention(interaction.user.id)} at ${time(date)}`,
        embeds: [embed],
        files: [attachment],
      });
    }
  };
}
