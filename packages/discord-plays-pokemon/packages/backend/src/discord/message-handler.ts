import type { Client, Message } from "discord.js";
import { Events, ChannelType } from "discord.js";
import { parseChord, type Chord } from "#src/game/command/chord.ts";
import { execute } from "./chord-executor.ts";
import { isValid } from "./chord-validator.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";
import type { PokemonGameDriver } from "#src/lifecycle/pokemon-driver.ts";
import { logger } from "#src/logger.ts";
import { getConfig } from "#src/config/index.ts";

export let lastCommand = new Date();

export function handleMessages(
  client: Client,
  driver: PokemonGameDriver,
  fn: (commandInput: CommandInput) => Promise<void>,
): void {
  logger.info("ready to handle commands");
  client.on(Events.MessageCreate, (messageEvent) => {
    void (async () => {
      try {
        await handleMessage(messageEvent, driver, fn);
        return;
      } catch (error) {
        logger.info(error);
      }
    })();
  });
}

async function handleMessage(
  event: Message,
  driver: PokemonGameDriver,
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
  const minInChannel = getConfig().stream.minimum_in_channel;
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
    logger.error(chord);
    await event.react("❓");
    return;
  }

  if (isValid(chord)) {
    await execute(chord, fn);
    await event.react(`👍`);
    lastCommand = new Date();
  } else {
    await event.react(`⛔`);
    return;
  }
}
