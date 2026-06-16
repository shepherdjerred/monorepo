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

// Peer userbot Discord user IDs supplied by the deployment (homelab cdk8s defines the
// canonical list and passes each bot its peers as "all - self" via PEER_USERBOT_IDS).
// Empty when running locally; the Go-Live heuristic then catches peer userbots instead.
function readPeerUserbotIds(): readonly string[] {
  const raw = Bun.env.PEER_USERBOT_IDS;
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}
const PEER_USERBOT_IDS = readPeerUserbotIds();

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
            peerUserbotIds: PEER_USERBOT_IDS,
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
