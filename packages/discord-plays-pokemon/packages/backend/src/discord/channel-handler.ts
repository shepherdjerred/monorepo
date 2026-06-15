import { Events, type VoiceBasedChannel } from "discord.js";
import {
  countRealViewers,
  type ViewerCandidate,
} from "@shepherdjerred/discord-stream-lifecycle/viewer-presence.ts";
import client from "./client.ts";
import { getConfig } from "#src/config/index.ts";
import { logger } from "#src/logger.ts";

function toViewerCandidates(channel: VoiceBasedChannel): ViewerCandidate[] {
  const voiceStates = channel.guild.voiceStates.cache;
  return channel.members.map((member) => {
    const state = voiceStates.get(member.id);
    return {
      id: member.id,
      isBot: member.user.bot,
      streaming: state?.streaming ?? false,
      selfDeaf: state?.selfDeaf ?? false,
      selfMute: state?.selfMute ?? false,
    };
  });
}

export function handleChannelUpdate(
  updateFn: (participants: number) => Promise<void>,
) {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void (async () => {
      logger.info("voice state update");
      const newChannel = newState.channelId;
      const oldChannel = oldState.channelId;
      const config = getConfig();
      const channelId = config.stream.channel_id;

      if (newChannel === channelId || oldChannel === channelId) {
        const channel = await client.channels.fetch(channelId);
        if (channel?.isVoiceBased() === true) {
          logger.info("calling updateFn");
          const participants = countRealViewers(toViewerCandidates(channel), {
            selfUserId: config.stream.userbot.id,
          });
          logger.info(`real viewers in channel: ${String(participants)}`);
          await updateFn(participants);
        } else {
          logger.error("channel is not voice based");
        }
      }
    })();
  });
}
