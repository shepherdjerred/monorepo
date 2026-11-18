import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import type { SessionManagerDeps } from "@shepherdjerred/streambot/session/session-types.ts";
import type { Session } from "@shepherdjerred/streambot/session/session-types.ts";
import type { StationFeeder } from "@shepherdjerred/streambot/station/station-feeder.ts";
import { buildPlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import { VoiceAssistantSession } from "@shepherdjerred/streambot/voice/voice-assistant-session.ts";
import type { VoiceAssistantSessionOptions } from "@shepherdjerred/streambot/voice/voice-assistant-session.ts";

export function createSessionVoiceAssistant(
  deps: SessionManagerDeps,
  session: Session,
  options?: Partial<
    Pick<
      VoiceAssistantSessionOptions,
      "commandsForUser" | "afterTurn" | "holdTeardown" | "peerUserbotIds"
    >
  > & {
    readonly stationFeeder?: StationFeeder | undefined;
    readonly controlStation?: PlaybackCommandServiceDeps["controlStation"];
  },
): VoiceAssistantSession | null {
  const models = deps.voiceModels ?? null;
  if (models === null) return null;
  if (deps.library === undefined || deps.resolvePlaySource === undefined) {
    throw new Error(
      "Voice assistant requires library and play-source services",
    );
  }
  const userbot = session.entry.userbot;
  const { stationFeeder, controlStation, ...assistantOptions } = options ?? {};
  return new VoiceAssistantSession({
    ...assistantOptions,
    config: deps.config,
    models,
    streamer: userbot,
    guildId: session.guildId,
    channelId: session.voiceChannelId,
    commands: {
      config: deps.config,
      dispatch: (event) => {
        stationFeeder?.onBeforeDispatch(session, event);
        session.actor.send(event);
      },
      view: () =>
        buildPlaybackView(session.actor.getSnapshot(), userbot.getPosition()),
      library: deps.library,
      setVolume: (percent) => userbot.setVolume(percent),
      seek: (seconds) => userbot.seek(seconds),
      resolvePlaySource: deps.resolvePlaySource,
      announce: (message) => deps.announce(session.statusChannelId, message),
      guildId: session.guildId,
      channelId: session.voiceChannelId,
      ...(controlStation === undefined ? {} : { controlStation }),
      ...(deps.discovery === undefined ? {} : { discovery: deps.discovery }),
      ...(deps.history === undefined ? {} : { history: deps.history }),
      ...(deps.featureGate === undefined
        ? {}
        : { featureGate: deps.featureGate }),
      ...(deps.sports === undefined ? {} : { sports: deps.sports }),
    },
    announce: (message) => deps.announce(session.statusChannelId, message),
    holdTeardown:
      options?.holdTeardown ?? (() => session.teardownHold.acquire()),
    ...(deps.voiceFeedbackClips == null
      ? {}
      : { feedbackClips: deps.voiceFeedbackClips }),
    ...(deps.voiceCaptureManager === undefined
      ? {}
      : { captureManager: deps.voiceCaptureManager }),
  });
}
