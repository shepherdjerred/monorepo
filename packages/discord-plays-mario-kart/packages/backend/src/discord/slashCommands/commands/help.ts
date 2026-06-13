import type { CommandInteraction } from "discord.js";
import {
  SlashCommandBuilder,
  bold,
  channelMention,
  inlineCode,
  userMention,
} from "discord.js";
import { getConfig } from "#src/config/index.ts";

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("View Discord Plays Mario Kart 64 help");

export async function help(interaction: CommandInteraction) {
  const config = getConfig();
  const lines = [
    bold("Discord Plays Mario Kart 64"),
    `Watch the live game when ${userMention(
      config.stream.userbot.id,
    )} is streaming in the ${channelMention(config.stream.channel_id)} voice channel (Go-Live).`,
    ``,
    bold("Controls"),
    `Open the web controller, claim one of the ${String(
      config.emulator.seats,
    )} seats (P1–P${String(config.emulator.seats)}), and drive your kart in real time:`,
    `* Steer: ${inlineCode("A")} / ${inlineCode("D")} (or ←/→)`,
    `* Accelerate: ${inlineCode("W")} (A button) · Brake/Reverse: ${inlineCode("S")} (B button)`,
    `* Hop/Drift: ${inlineCode("Shift")} (R) · Item: ${inlineCode("E")} (Z) · Start: ${inlineCode("Enter")}`,
    `* Camera (C-buttons): ${inlineCode("I/J/K/L")}`,
    ``,
    `Players navigate the menus themselves — pick 1–4 player VS, characters, and a track using the seats you claim.`,
    config.bot.commands.screenshot.enabled
      ? `\n${inlineCode("/screenshot")} posts a frame to ${channelMention(
          config.bot.notifications.channel_id,
        )}.`
      : "",
  ];
  await interaction.reply({
    content: lines.join("\n"),
    ephemeral: true,
  });
}
