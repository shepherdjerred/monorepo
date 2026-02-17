import {
  SlashCommandBuilder,
  CommandInteraction,
  AttachmentBuilder,
  EmbedBuilder,
  TextChannel,
  channelMention,
  userMention,
  time,
} from "discord.js";
import { WebDriver } from "selenium-webdriver";
import { Buffer } from "buffer";
import client from "../../client.js";
import { getConfig } from "../../../config/index.js";

export const screenshotCommand = new SlashCommandBuilder()
  .setName("screenshot")
  .setDescription("Take a screenshot and upload it to the chat");

export function makeScreenshot(driver: WebDriver) {
  return async function screenshot(interaction: CommandInteraction) {
    const screenshot = await driver.takeScreenshot();
    const buffer = Buffer.from(screenshot, "base64");
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
    if (channel) {
      await (channel as TextChannel).send({
        content: `Screenshot taken by ${userMention(interaction.user.id)} at ${time(date)}`,
        embeds: [embed],
        files: [attachment],
      });
    } else {
      await interaction.reply({
        ephemeral: true,
        content: "There was an error",
      });
    }
  };
}
