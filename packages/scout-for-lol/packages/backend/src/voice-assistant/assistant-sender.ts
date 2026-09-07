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

/**
 * Adapt one live voice connection to the shared assistant audio transport.
 *
 * `PacedAssistantSender.run()` always awaits `setAssistantSpeaking(true)`
 * before sending its first packet, which makes it the one hook available to
 * reserve the connection: `reserveForAssistant` (the output arbiter's
 * bidirectional reservation) blocks here until any in-flight sound-engine
 * alert has released the connection, so the two producers are never
 * concurrent on it.
 */
export function assistantAudioTransport(
  connection: AssistantVoiceConnection,
  reserveForAssistant: () => Promise<void>,
): AssistantAudioTransport {
  return {
    setAssistantSpeaking: async (speaking) => {
      if (speaking) {
        await reserveForAssistant();
      }
      connection.setSpeaking(speaking);
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
  reserveForAssistant: () => Promise<void>,
): AssistantAudioSink {
  return new PacedAssistantSender(
    assistantAudioTransport(connection, reserveForAssistant),
    {
      stagePrefix: SCOUT_VOICE_STAGE_PREFIX,
      metrics: scoutVoiceReplyMetrics,
      duck,
    },
  );
}
