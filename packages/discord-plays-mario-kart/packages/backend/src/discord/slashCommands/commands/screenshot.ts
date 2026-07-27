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
import { encodeScreenshotPng } from "#src/emulator/screenshot.ts";
import { applyStreamOverlays } from "#src/overlay/composite.ts";
import type { MarioKartGameDriver } from "#src/lifecycle/mario-kart-driver.ts";
import { logger } from "#src/logger.ts";

export const screenshotCommand = new SlashCommandBuilder()
  .setName("screenshot")
  .setDescription("Take a screenshot and upload it to the game channel.");

export function makeScreenshot(driver: MarioKartGameDriver, botClient: Client) {
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
          "No Mario Kart session is active in this server. Run `/play` first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    // renderFrame() is a Worker round-trip that now rejects on a worker crash
    // or render failure. handleInteraction runs this handler with `void`, so an
    // uncaught rejection here becomes an unhandled promise rejection and the
    // user sees a timed-out command — catch it and reply ephemerally instead.
    let frame: Awaited<ReturnType<typeof runtime.emulator.renderFrame>>;
    try {
      frame = await runtime.emulator.renderFrame();
    } catch (error) {
      logger.warn("screenshot renderFrame failed", error);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content:
          "Couldn't capture a screenshot right now — the emulator is unavailable. Try again in a moment.",
      });
      return;
    }
    if (frame.height === 0 || frame.width === 0) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "No frame rendered yet, try again in a moment.",
      });
      return;
    }
    const ctx = runtime.overlayContext();
    applyStreamOverlays(frame.rgba, frame.height, ctx);
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
