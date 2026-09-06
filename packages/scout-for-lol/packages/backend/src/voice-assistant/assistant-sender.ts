import {
  PacedAssistantSender,
  type AssistantAudioSink,
  type AssistantAudioTransport,
  type DuckObserver,
} from "@shepherdjerred/voice-assistant";
import {
  SCOUT_VOICE_STAGE_PREFIX,
  scoutVoiceReplyMetrics,
} from "#src/voice-assistant/metrics-ports.ts";

/**
 * The voice-connection surface the assistant reply path needs, satisfied
 * structurally by `@discordjs/voice`'s `VoiceConnection` and by test fakes.
 */
export type AssistantVoiceConnection = {
  setSpeaking: (enabled: boolean) => unknown;
  playOpusPacket: (buffer: Buffer) => unknown;
};

/** Adapt one live voice connection to the shared assistant audio transport. */
export function assistantAudioTransport(
  connection: AssistantVoiceConnection,
): AssistantAudioTransport {
  return {
    setAssistantSpeaking: (speaking) => {
      connection.setSpeaking(speaking);
      return Promise.resolve();
    },
    sendAssistantOpus: (opus) => {
      connection.playOpusPacket(
        Buffer.from(opus.buffer, opus.byteOffset, opus.byteLength),
      );
    },
  };
}

/** One paced, ducked reply sink per Realtime turn. */
export function createAssistantSender(
  connection: AssistantVoiceConnection,
  duck: DuckObserver,
): AssistantAudioSink {
  return new PacedAssistantSender(assistantAudioTransport(connection), {
    stagePrefix: SCOUT_VOICE_STAGE_PREFIX,
    metrics: scoutVoiceReplyMetrics,
    duck,
  });
}
