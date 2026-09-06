import type {
  RealtimeTurnMetrics,
  ReplyMetrics,
  VoiceLifecycleMetrics,
  VoiceObservability,
} from "@shepherdjerred/voice-assistant/ports.ts";
import {
  voiceActivationStageLatencySeconds,
  voiceAudioTokensTotal,
  voiceConcurrentTurns,
  voiceOpenAiFailuresTotal,
  voiceReplyPacketsTotal,
  voiceReplySendFailuresTotal,
  voiceTranscriptVerificationsTotal,
  voiceTranscriptionUsageTotal,
  voiceTurnDeliveryFailuresTotal,
  voiceTurnsTotal,
  voiceWakeToReplySeconds,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import {
  voiceCloudRequestsTotal,
  voiceReplyBytesTotal,
  voiceReplyDurationSeconds,
} from "@shepherdjerred/streambot/observability/voice-diagnostic-metrics.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

/**
 * Streambot's bindings for the injected @shepherdjerred/voice-assistant ports.
 *
 * Every adapter wraps the SAME prom-client instrument streambot registered before the pipeline
 * was extracted, and the stage prefix is the historical span-name prefix — so metric series and
 * trace names stay byte-identical across the extraction (Grafana dashboards unaffected).
 * Explicit arrow-function adapters, never assertions: the port contracts stay structurally
 * checked against the real instruments.
 */

export const STREAMBOT_VOICE_STAGE_PREFIX = "streambot.voice";

export function streambotVoiceObservability(
  module: string,
): VoiceObservability {
  return {
    logger: logger.child(module),
    stagePrefix: STREAMBOT_VOICE_STAGE_PREFIX,
  };
}

export const streambotVoiceLifecycleMetrics: VoiceLifecycleMetrics = {
  turnDeliveryFailures: {
    inc: (value) => {
      voiceTurnDeliveryFailuresTotal.inc(value);
    },
  },
};

export const streambotRealtimeTurnMetrics: RealtimeTurnMetrics = {
  audioTokens: {
    inc: (labels, value) => {
      voiceAudioTokensTotal.inc(labels, value);
    },
  },
  activationStageLatencySeconds: {
    observe: (labels, value) => {
      voiceActivationStageLatencySeconds.observe(labels, value);
    },
  },
  concurrentTurns: {
    inc: () => {
      voiceConcurrentTurns.inc();
    },
    dec: () => {
      voiceConcurrentTurns.dec();
    },
  },
  openAiFailures: {
    inc: (labels, value) => {
      voiceOpenAiFailuresTotal.inc(labels, value);
    },
  },
  replySendFailures: {
    inc: (value) => {
      voiceReplySendFailuresTotal.inc(value);
    },
  },
  transcriptVerifications: {
    inc: (labels, value) => {
      voiceTranscriptVerificationsTotal.inc(labels, value);
    },
  },
  transcriptionUsage: {
    inc: (labels, value) => {
      voiceTranscriptionUsageTotal.inc(labels, value);
    },
  },
  turns: {
    inc: (labels, value) => {
      voiceTurnsTotal.inc(labels, value);
    },
  },
  wakeToReplySeconds: {
    observe: (value) => {
      voiceWakeToReplySeconds.observe(value);
    },
  },
  cloudRequests: {
    inc: (labels, value) => {
      voiceCloudRequestsTotal.inc(labels, value);
    },
  },
};

export const streambotVoiceReplyMetrics: ReplyMetrics = {
  replyPackets: {
    inc: (value) => {
      voiceReplyPacketsTotal.inc(value);
    },
  },
  replyBytes: {
    inc: (value) => {
      voiceReplyBytesTotal.inc(value);
    },
  },
  replySendFailures: {
    inc: (value) => {
      voiceReplySendFailuresTotal.inc(value);
    },
  },
  replyDurationSeconds: {
    observe: (labels, value) => {
      voiceReplyDurationSeconds.observe(labels, value);
    },
  },
};
