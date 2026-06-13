import type { CommandInteraction } from "discord.js";
import {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  channelMention,
  userMention,
  time,
  ChannelType,
} from "discord.js";
import client from "#src/discord/client.ts";
import { getConfig } from "#src/config/index.ts";
import type { N64Emulator } from "#src/emulator/n64-emulator.ts";
import { encodeScreenshotPng } from "#src/emulator/screenshot.ts";

export const screenshotCommand = new SlashCommandBuilder()
  .setName("screenshot")
  .setDescription("Take a screenshot and upload it to the chat");

export function makeScreenshot(emulator: N64Emulator) {
  return async function handleScreenshotCommand(
    interaction: CommandInteraction,
  ) {
    const frame = emulator.renderFrame();
    const buffer = encodeScreenshotPng(frame);
    const date = new Date();
    const attachment = new AttachmentBuilder(buffer, {
      name: "screenshot.png",
      description: `Screenshot of Mario Kart 64 at ${date.toISOString()}`,
    });
    const embed = new EmbedBuilder()
      .setTitle("Mario Kart 64 Screenshot")
      .setImage("attachment://screenshot.png");
    await interaction.reply({
      content: `Screenshot sent to ${channelMention(getConfig().bot.notifications.channel_id)}`,
      ephemeral: true,
    });

    const channel = client.channels.cache.get(
      getConfig().bot.notifications.channel_id,
    );
    await (channel?.type === ChannelType.GuildText
      ? channel.send({
          content: `Screenshot taken by ${userMention(interaction.user.id)} at ${time(date)}`,
          embeds: [embed],
          files: [attachment],
        })
      : interaction.reply({
          ephemeral: true,
          content: "There was an error",
        }));
  };
}
