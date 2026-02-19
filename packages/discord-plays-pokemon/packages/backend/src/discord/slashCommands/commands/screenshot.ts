import type {
  CommandInteraction} from "discord.js";
import {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  channelMention,
  userMention,
  time,
  ChannelType,
} from "discord.js";
import type { WebDriver } from "selenium-webdriver";
import { Buffer } from "node:buffer";
import client from "#src/discord/client.ts";
import { getConfig } from "#src/config/index.ts";

export const screenshotCommand = new SlashCommandBuilder()
  .setName("screenshot")
  .setDescription("Take a screenshot and upload it to the chat");

export function makeScreenshot(driver: WebDriver) {
  return async function handleScreenshotCommand(interaction: CommandInteraction) {
    const screenshotData = await driver.takeScreenshot();
    const buffer = Buffer.from(screenshotData, "base64");
    const date = new Date();
    const attachment = new AttachmentBuilder(buffer, {
      name: "screenshot.png",
      description: `Screenshot of the Pokémon game at ${date.toISOString()}`,
    });
    const embed = new EmbedBuilder()
      .setTitle("Pokémon Screenshot")
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
