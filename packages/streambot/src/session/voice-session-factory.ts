import type { SessionManagerDeps } from "@shepherdjerred/streambot/session/session-types.ts";
import type { Session } from "@shepherdjerred/streambot/session/session-types.ts";
import { buildPlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import { VoiceAssistantSession } from "@shepherdjerred/streambot/voice/voice-assistant-session.ts";

export function createSessionVoiceAssistant(
  deps: SessionManagerDeps,
  session: Session,
): VoiceAssistantSession | null {
  const models = deps.voiceModels ?? null;
  if (models === null) return null;
  if (deps.library === undefined || deps.resolvePlaySource === undefined) {
    throw new Error(
      "Voice assistant requires library and play-source services",
    );
  }
  const userbot = session.entry.userbot;
  return new VoiceAssistantSession({
    config: deps.config,
    models,
    streamer: userbot,
    guildId: session.guildId,
    channelId: session.voiceChannelId,
    commands: {
      config: deps.config,
      dispatch: (event) => {
        session.actor.send(event);
      },
      view: () =>
        buildPlaybackView(session.actor.getSnapshot(), userbot.getPosition()),
      library: deps.library,
      setVolume: (percent) => userbot.setVolume(percent),
      seek: (seconds) => userbot.seek(seconds),
      resolvePlaySource: deps.resolvePlaySource,
      announce: (message) => deps.announce(session.statusChannelId, message),
    },
    announce: (message) => deps.announce(session.statusChannelId, message),
    holdTeardown: () => session.teardownHold.acquire(),
    ...(deps.voiceFeedbackClips == null
      ? {}
      : { feedbackClips: deps.voiceFeedbackClips }),
    ...(deps.voiceCaptureManager === undefined
      ? {}
      : { captureManager: deps.voiceCaptureManager }),
  });
}
