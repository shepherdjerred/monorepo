import {
  type MediaConnectionCloseInfo,
  type ReceivedVoiceAudio,
  type Streamer,
} from "@shepherdjerred/discord-video-stream";
import type { JoinVoiceInput } from "@shepherdjerred/streambot/machine/types.ts";
import type {
  VoiceCloseInfo,
  VoiceCloseTracker,
} from "@shepherdjerred/streambot/streamer/voice-close-source.ts";
import { createVoiceCloseTracker } from "@shepherdjerred/streambot/streamer/voice-close-source.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("streamer");

export async function joinStreamerVoice(options: {
  streamer: Streamer;
  input: JoinVoiceInput;
  receiveAudio: boolean;
  now: () => number;
  onClose: ((info: VoiceCloseInfo) => void) | null;
  onAudio: ((audio: ReceivedVoiceAudio) => void) | null;
}): Promise<VoiceCloseTracker> {
  await options.streamer.joinVoice(
    options.input.guildId,
    options.input.channelId,
    {
      receiveAudio: options.receiveAudio,
    },
  );
  const connection = options.streamer.voiceConnection;
  if (connection === undefined) {
    throw new Error("voice connection missing after joinVoice resolved");
  }
  const activeConnection = connection;
  function detach(): void {
    activeConnection.off("close", onConnectionClose);
  }
  const tracker = createVoiceCloseTracker(detach);
  const onConnectionClose = (info: MediaConnectionCloseInfo) => {
    const close: VoiceCloseInfo = {
      code: info.code,
      deliberate: info.deliberate,
      atMs: options.now(),
    };
    if (!tracker.record(close)) return;
    log.warn("Discord media connection closed", {
      guildId: options.input.guildId,
      channelId: options.input.channelId,
      code: close.code,
      deliberate: close.deliberate,
    });
    options.onClose?.(close);
  };
  activeConnection.on("close", onConnectionClose);
  activeConnection.on("audio", (audio) => options.onAudio?.(audio));
  activeConnection.on("audio_error", (error) => {
    log.warn("Discord voice receive failed", { error: getErrorMessage(error) });
  });
  return tracker;
}
