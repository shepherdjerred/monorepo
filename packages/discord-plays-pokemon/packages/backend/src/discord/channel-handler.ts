import { Events } from "discord.js";
import client from "./client.ts";
import { getConfig } from "#src/config/index.ts";
import { logger } from "#src/logger.ts";

export function handleChannelUpdate(
  updateFn: (participants: number) => Promise<void>,
) {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void (async () => {
      logger.info("voice state update");
      const newChannel = newState.channelId;
      const oldChannel = oldState.channelId;
      const channelId = getConfig().stream.channel_id;

      if (newChannel === channelId || oldChannel === channelId) {
        const channel = await client.channels.fetch(channelId);
        if (channel?.isVoiceBased() === true) {
          logger.info("calling updateFn");
          logger.info(JSON.stringify(channel.members));
          // it seems that the library has an incorrect type here
          await updateFn(
            channel.members.filter(
              (member) => member.id !== getConfig().stream.userbot.id,
            ).size,
          );
        } else {
          logger.error("channel is not voice based");
        }
      }
    })();
  });
}
