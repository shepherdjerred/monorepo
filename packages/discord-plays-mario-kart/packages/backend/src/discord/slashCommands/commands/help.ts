import type { ChatInputCommandInteraction } from "discord.js";
import {
  SlashCommandBuilder,
  bold,
  inlineCode,
  MessageFlags,
} from "discord.js";
import { getConfig } from "#src/config/index.ts";

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("View Discord Plays Mario Kart 64 help");

export async function help(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const config = getConfig();
  const seatCount = String(config.emulator.seats);
  const lines = [
    bold("Discord Plays Mario Kart 64"),
    `Run ${inlineCode("/play")} from a voice channel to start a Mario Kart session. The bot will join your voice channel and stream the game live.`,
    `Run ${inlineCode("/stop")} to end the session.`,
    ``,
    `${bold("Play:")} https://mariokart.sjer.red`,
    `Open the controller, claim one of the ${seatCount} seats (P1–P${seatCount}), and drive your kart in real time.`,
    ``,
    bold("Controls"),
    `* Analog stick X (steer): ${inlineCode("A")} / ${inlineCode("D")}`,
    `* Analog stick Y: ${inlineCode("R")} / ${inlineCode("F")}`,
    `* D-pad (menus): ${inlineCode("←")} / ${inlineCode("↑")} / ${inlineCode("→")} / ${inlineCode("↓")}`,
    `* A (accelerate): ${inlineCode("W")} or ${inlineCode("Space")}`,
    `* B (brake/reverse): ${inlineCode("S")}`,
    `* Z (item): ${inlineCode("E")} or ${inlineCode("Z")}`,
    `* L (left trigger): ${inlineCode("Q")}`,
    `* R (hop/drift): ${inlineCode("Shift")}`,
    `* Start: ${inlineCode("Enter")} or ${inlineCode("P")}`,
    `* C-buttons (camera): ${inlineCode("I")} / ${inlineCode("J")} / ${inlineCode("K")} / ${inlineCode("L")}`,
    ``,
    `Players navigate the menus themselves — pick 1–${seatCount} player VS, characters, and a track using the seats you claim.`,
    config.bot.commands.screenshot.enabled
      ? `\n${inlineCode("/screenshot")} posts a frame to the game channel.`
      : "",
  ];
  await interaction.reply({
    content: lines.join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}
