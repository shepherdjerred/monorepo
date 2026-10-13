import type { Client, Message } from "discord.js";
import { Events, ChannelType } from "discord.js";
import { parseChord, type Chord } from "#src/game/command/chord.ts";
import {
  effectiveChordDelay,
  executeInteractiveChord,
} from "#src/game/command/chord-executor.ts";
import { isValid } from "#src/game/command/chord-validator.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";
import type { PokemonGameDriver } from "#src/lifecycle/pokemon-driver.ts";
import { logger } from "#src/logger.ts";
import type { Config } from "#src/config/schema.ts";

export function handleMessages(
  client: Client,
  driver: PokemonGameDriver,
  config: Config,
  fn: (commandInput: CommandInput) => Promise<void>,
): void {
  logger.info("ready to handle commands");
  client.on(Events.MessageCreate, (messageEvent) => {
    void (async () => {
      try {
        await handleMessage(messageEvent, driver, config, fn);
        return;
      } catch (error) {
        logger.warn(
          `message handler failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  });
}

async function handleMessage(
  event: Message,
  driver: PokemonGameDriver,
  config: Config,
  fn: (commandInput: CommandInput) => Promise<void>,
): Promise<void> {
  if (event.author.bot) {
    return;
  }
  // Text commands are only accepted in the active session's bound text channel.
  const runtime = driver.getActiveRuntime();
  if (
    runtime?.session.guildId !== event.guildId ||
    runtime.session.textChannelId !== event.channelId
  ) {
    return;
  }
  const voiceChannelId = runtime.session.voiceChannelId;

  if (event.member?.voice.channelId !== voiceChannelId) {
    await event.reply(`You have to be in <#${voiceChannelId}> to play`);
    return;
  }

  const voiceChannel = event.guild?.channels.cache.get(voiceChannelId);
  if (voiceChannel?.type !== ChannelType.GuildVoice) {
    await event.react("💀");
    return;
  }

  const memberCount = voiceChannel.members.filter(
    (member) => !member.user.bot,
  ).size;
  const minInChannel = config.stream.minimum_in_channel;
  if (memberCount < minInChannel) {
    await event.reply(
      `You can't play unless there are at least ${String(minInChannel)} ${
        minInChannel === 1 ? "person" : "people"
      } in <#${voiceChannelId}> 😕`,
    );
    return;
  }

  let chord: Chord | undefined;
  try {
    chord = parseChord(event.content);
  } catch {
    await event.react("💀");
    return;
  }

  if (chord === undefined) {
    // Non-chord chat in the play channel is normal — the ❓ react is the signal.
    logger.debug(`not a chord (❓ reacted): ${event.content.slice(0, 80)}`);
    await event.react("❓");
    return;
  }

  const commands = config.game.commands;
  const chatLimits = {
    maxCommands: commands.chord.max_commands,
    maxTotal: commands.chord.max_total,
    maxQuantityPerAction: commands.max_quantity_per_action,
  };
  if (isValid(chord, chatLimits)) {
    const accepted = await executeInteractiveChord(
      chord,
      (input) =>
        driver.getActiveRuntime() === runtime ? fn(input) : Promise.resolve(),
      effectiveChordDelay(
        commands.chord.delay,
        commands.delay_between_actions_in_milliseconds,
      ),
    );
    if (!accepted) {
      await event.reply(
        "Goal mode currently owns game input. Try again after the goal finishes.",
      );
      return;
    }
    if (driver.getActiveRuntime() !== runtime) return;
    driver.inputLog.record({
      user: event.member.displayName,
      source: "discord",
      command: event.content.trim(),
    });
    await event.react(`👍`);
  } else {
    await event.react(`⛔`);
    return;
  }
}
