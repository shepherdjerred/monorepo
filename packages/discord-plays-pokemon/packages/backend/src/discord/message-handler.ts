import type { Message } from "discord.js";
import { Events, channelMention, ChannelType } from "discord.js";
import { parseChord, type Chord } from "#src/game/command/chord.ts";
import client from "./client.ts";
import { execute } from "./chord-executor.ts";
import { isValid } from "./chord-validator.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";
import { logger } from "#src/logger.ts";
import { getConfig } from "#src/config/index.ts";

export let lastCommand = new Date();

export function handleMessages(
  fn: (commandInput: CommandInput) => Promise<void>,
) {
  logger.info("ready to handle commands");
  client.on(Events.MessageCreate, (messageEvent) => {
    void (async () => {
      try {
        await handleMessage(messageEvent, fn); return;
      } catch (error) {
        logger.info(error);
      }
    })();
  });
}

async function handleMessage(
  event: Message,
  fn: (commandInput: CommandInput) => Promise<void>,
) {
  if (event.author.bot) {
    return;
  }

  if (event.channelId !== getConfig().game.commands.channel_id) {
    return;
  }

  const channel = client.channels.cache.get(getConfig().stream.channel_id);
  if (channel === undefined) {
    await event.react("💀");
    return;
  }

  if (
    event.member?.voice.channelId !== getConfig().stream.channel_id
  ) {
    await event.reply(
      `You have to be in ${channelMention(getConfig().stream.channel_id)} to play`,
    );
    return;
  }

  if (channel.type !== ChannelType.GuildVoice) {
    await event.react("💀");
    return;
  }

  const memberCount = channel.members.filter((member) => {
    return !member.user.bot;
  }).size;
  if (memberCount < getConfig().stream.minimum_in_channel) {
    const minInChannel = getConfig().stream.minimum_in_channel;
    await event.reply(
      `You can't play unless there are at least ${String(minInChannel)} ${
        minInChannel === 1 ? "person" : "people"
      } in ${channelMention(getConfig().stream.channel_id)} 😕`,
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
