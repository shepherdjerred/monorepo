import type { Message, VoiceChannel} from "discord.js";
import { Events, channelMention } from "discord.js";
import { parseChord, type Chord } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/game/command/chord.js";
import client from "./client.ts";
import { execute } from "./chordExecutor.ts";
import { isValid } from "./chordValidator.ts";
import type { CommandInput } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/game/command/commandInput.js";
import { logger } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/logger.js";
import { getConfig } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/config/index.js";

export let lastCommand = new Date();

export function handleMessages(
  fn: (commandInput: CommandInput) => Promise<void>,
) {
  logger.info("ready to handle commands");
  client.on(Events.MessageCreate, (event) => {
    void (async () => {
      try {
        return handleMessage(event, fn);
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
  if (!channel) {
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

  const memberCount = (channel as VoiceChannel).members.filter((member) => {
    return !member.user.bot;
  }).size;
  if (memberCount < getConfig().stream.minimum_in_channel) {
    await event.reply(
      `You can't play unless there are at least ${getConfig().stream.minimum_in_channel} ${
        getConfig().stream.minimum_in_channel === 1 ? "person" : "people"
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

  if (!chord) {
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
