import type {
  RealtimeTurnMetrics,
  ReplyMetrics,
  VoiceLifecycleMetrics,
  VoiceObservability,
} from "@shepherdjerred/voice-assistant";
import {
  scoutVoiceActivationStageLatencySeconds,
  scoutVoiceAudioTokensTotal,
  scoutVoiceCloudRequestsTotal,
  scoutVoiceConcurrentTurns,
  scoutVoiceOpenAiFailuresTotal,
  scoutVoiceReplyBytesTotal,
  scoutVoiceReplyDurationSeconds,
  scoutVoiceReplyPacketsTotal,
  scoutVoiceReplySendFailuresTotal,
  scoutVoiceTranscriptVerificationsTotal,
  scoutVoiceTranscriptionUsageTotal,
  scoutVoiceTurnDeliveryFailuresTotal,
  scoutVoiceTurnsTotal,
  scoutVoiceWakeToReplySeconds,
} from "#src/metrics/platform/voice.ts";
import { createLogger } from "#src/logger.ts";

/**
 * Scout's bindings for the injected @shepherdjerred/voice-assistant ports.
 * Every adapter wraps a `scout_voice_*` prom-client instrument, and the stage
 * prefix names every OTel span/attribute the shared pipeline records. Explicit
 * arrow-function adapters, never assertions: the port contracts stay
 * structurally checked against the real instruments.
 */

export const SCOUT_VOICE_STAGE_PREFIX = "scout.voice";

const withMeta =
  (write: (message: string, meta: Record<string, unknown>) => unknown) =>
  (message: string, meta?: Record<string, unknown>) => {
    write(message, meta ?? {});
  };

export function scoutVoiceObservability(module: string): VoiceObservability {
  const logger = createLogger(module);
  return {
    logger: {
      debug: withMeta((message, meta) => logger.debug(message, meta)),
      info: withMeta((message, meta) => logger.info(message, meta)),
      warn: withMeta((message, meta) => logger.warn(message, meta)),
      error: withMeta((message, meta) => logger.error(message, meta)),
    },
    stagePrefix: SCOUT_VOICE_STAGE_PREFIX,
  };
}

export const scoutVoiceLifecycleMetrics: VoiceLifecycleMetrics = {
  turnDeliveryFailures: {
    inc: (value) => {
      scoutVoiceTurnDeliveryFailuresTotal.inc(value);
    },
  },
};

export const scoutRealtimeTurnMetrics: RealtimeTurnMetrics = {
  audioTokens: {
    inc: (labels, value) => {
      scoutVoiceAudioTokensTotal.inc(labels, value);
    },
  },
  activationStageLatencySeconds: {
    observe: (labels, value) => {
      scoutVoiceActivationStageLatencySeconds.observe(labels, value);
    },
  },
  concurrentTurns: {
    inc: () => {
      scoutVoiceConcurrentTurns.inc();
    },
    dec: () => {
      scoutVoiceConcurrentTurns.dec();
    },
  },
  openAiFailures: {
    inc: (labels, value) => {
      scoutVoiceOpenAiFailuresTotal.inc(labels, value);
    },
  },
  replySendFailures: {
    inc: (value) => {
      scoutVoiceReplySendFailuresTotal.inc(value);
    },
  },
  transcriptVerifications: {
    inc: (labels, value) => {
      scoutVoiceTranscriptVerificationsTotal.inc(labels, value);
    },
  },
  transcriptionUsage: {
    inc: (labels, value) => {
      scoutVoiceTranscriptionUsageTotal.inc(labels, value);
    },
  },
  turns: {
    inc: (labels, value) => {
      scoutVoiceTurnsTotal.inc(labels, value);
    },
  },
  wakeToReplySeconds: {
    observe: (value) => {
      scoutVoiceWakeToReplySeconds.observe(value);
    },
  },
  cloudRequests: {
    inc: (labels, value) => {
      scoutVoiceCloudRequestsTotal.inc(labels, value);
    },
  },
};

export const scoutVoiceReplyMetrics: ReplyMetrics = {
  replyPackets: {
    inc: (value) => {
      scoutVoiceReplyPacketsTotal.inc(value);
    },
  },
  replyBytes: {
    inc: (value) => {
      scoutVoiceReplyBytesTotal.inc(value);
    },
  },
  replySendFailures: {
    inc: (value) => {
      scoutVoiceReplySendFailuresTotal.inc(value);
    },
  },
  replyDurationSeconds: {
    observe: (labels, value) => {
      scoutVoiceReplyDurationSeconds.observe(labels, value);
    },
  },
};
