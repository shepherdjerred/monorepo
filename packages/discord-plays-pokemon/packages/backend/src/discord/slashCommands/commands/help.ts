import type { ChatInputCommandInteraction } from "discord.js";
import {
  SlashCommandBuilder,
  bold,
  inlineCode,
  MessageFlags,
} from "discord.js";
import {
  a,
  b,
  down,
  left,
  right,
  select,
  start,
  up,
} from "#src/game/command/command.ts";
import { burst, hold, holdB } from "#src/game/command/command-input.ts";
import { getConfig } from "#src/config/index.ts";

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("View Pokébot help");

export async function help(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const modifiers = [
    `Hold a button down: ${hold.join(", ")}`,
    `Burst/rapid-press a button: ${burst.join("\n")}`,
    `Hold the B button while pressing another button: ${holdB.join("\n")}`,
  ];
  const modifiersString = modifiers
    .map((modifier) => `* ${modifier}`)
    .join("\n");
  const commands = [
    `Up: ${up.join(", ")}`,
    `Down: ${down.join(", ")}`,
    `Left: ${left.join(", ")}`,
    `Right: ${right.join(", ")}`,
    `A: ${a.join(", ")}`,
    `B: ${b.join(", ")}`,
    `Start: ${start.join(", ")}`,
    `Select: ${select.join(", ")}`,
  ];
  const commandString = commands.map((command) => `* ${command}`).join("\n");
  const config = getConfig();
  const maxQuantity = String(config.game.commands.max_quantity_per_action);
  const maxCommands = String(config.game.commands.chord.max_commands);
  const maxTotal = String(config.game.commands.chord.max_total);
  const burstQuantity = String(config.game.commands.burst.quantity);
  const holdDuration = String(
    config.game.commands.hold.duration_in_milliseconds,
  );
  const burstTimesTwo = String(config.game.commands.burst.quantity * 2);
  const holdTimesTwo = String(
    config.game.commands.hold.duration_in_milliseconds * 2,
  );
  const lines = [
    bold("Pokébot Help"),
    `Run ${inlineCode("/play")} from a voice channel to start a Pokémon session. The bot will join your voice channel and stream the game live.`,
    `Once a session is active, send commands in the channel where ${inlineCode("/play")} was invoked.`,
    `Run ${inlineCode("/stop")} to end the session.`,
    ``,
    bold("Commands"),
    `The command format is ${inlineCode("[QUANTITY][MODIFIER][ACTION]")}. Quantity is a number from 0-${maxQuantity}. You can perform multiple commands in the same message by putting a space between each command; for example, sending the message ${inlineCode(
      "a b",
    )} will send both ${inlineCode("a")} and ${inlineCode("b")}. This is referred to as a chord.`,
    `Each chord can perform up to ${maxCommands} commands.`,
    `You can perform a maximum of ${maxTotal} actions in a single message. For example, the message ${inlineCode("2a 2b")} results in a total of four actions.`,
    ``,
    bold("Modifiers"),
    `You can add modifiers to commands to change how the button presses occur.`,
    `The burst modifier will rapidly press a button ${burstQuantity} times.`,
    `The hold modifier will hold a button for ${holdDuration} milliseconds`,
    `Modifiers can be combined with the mechanisms described above.`,
    `For example ${inlineCode("2-a 2_b")} will cause A to be pressed ${burstTimesTwo} times and B to be held for ${holdTimesTwo} milliseconds.`,
    ``,
    bold("Action List:"),
    `You can perform the listed action by providing any of the words listed. For example, to press Up you can send ${inlineCode(
      "up",
    )} or ${inlineCode("u")}.`,
    `All words are case insensitive.`,
    commandString,
    ``,
    bold("Modifier List:"),
    modifiersString,
    ``,
    bold("Extras:"),
    config.bot.commands.screenshot.enabled
      ? `The ${inlineCode("/screenshot")} command takes a screenshot of the active game.`
      : "",
    config.game.goal.enabled
      ? `The ${inlineCode(
          "/goal",
        )} command asks Codex to work toward a Pokemon objective for up to ${String(
          config.game.goal.max_runtime_minutes,
        )} minutes.`
      : "",
  ];
  await interaction.reply({
    content: lines.join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}
