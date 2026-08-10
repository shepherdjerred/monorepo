import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  PlaybackCommandService,
  type PlaybackCommandServiceDeps,
} from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { VoiceAudioLifecycle } from "@shepherdjerred/streambot/voice/audio-lifecycle.ts";
import type { LocalVoiceModels } from "@shepherdjerred/streambot/voice/local-models.ts";
import { runRealtimeVoiceTurn } from "@shepherdjerred/streambot/voice/realtime-agent.ts";
import type { RealtimeTransportLayer } from "@openai/agents/realtime";
import type { DiscordOpusDecoder } from "@shepherdjerred/discord-video-stream";
import {
  voiceActivationStageLatencySeconds,
  voiceCloudVerificationRateLimitsTotal,
  voiceLocalVerificationsTotal,
  voiceTurnsTotal,
  voiceWakeCandidatesTotal,
  voiceWakeDetectionsTotal,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import { CloudVerificationRateLimiter } from "@shepherdjerred/streambot/voice/cloud-verification-rate-limiter.ts";

const log = logger.child("voice-assistant");

export type VoiceAssistantSessionOptions = {
  readonly config: Config;
  readonly models: LocalVoiceModels;
  readonly streamer: StreamerLike;
  readonly commands: PlaybackCommandServiceDeps;
  readonly announce: (message: string) => Promise<void>;
  readonly holdTeardown: () => () => void;
  readonly createRealtimeTransport?: () => RealtimeTransportLayer;
  readonly createDecoder?: () => Pick<DiscordOpusDecoder, "decode" | "close">;
};

/** Owns all local and remote voice state for one pooled Streambot playback session. */
export class VoiceAssistantSession {
  private readonly lifecycle: VoiceAudioLifecycle;
  private readonly cloudVerificationLimiter =
    new CloudVerificationRateLimiter();
  private activeTransaction: AbortController | null = null;

  constructor(options: VoiceAssistantSessionOptions) {
    const service = new PlaybackCommandService(options.commands);
    this.lifecycle = new VoiceAudioLifecycle({
      models: options.models,
      preRollMs: options.config.voice.preRollMs,
      maxUtteranceMs: options.config.voice.maxUtteranceMs,
      onCandidate: () => {
        voiceWakeCandidatesTotal.inc();
      },
      onWake: () => {
        voiceWakeDetectionsTotal.inc();
      },
      onLocalVerification: (evidence) => {
        voiceLocalVerificationsTotal.inc({
          outcome: evidence.accepted ? "accepted" : "rejected",
        });
        voiceActivationStageLatencySeconds.observe(
          { stage: "local-verifier" },
          evidence.latencyMs / 1000,
        );
      },
      onLocalVerificationError: (error) => {
        voiceLocalVerificationsTotal.inc({ outcome: "error" });
        log.error("local wake verification failed", {
          error: getErrorMessage(error),
        });
      },
      onAbandoned: (reason) => {
        voiceTurnsTotal.inc({ outcome: `abandoned-${reason}` });
      },
      onTurn: async (turn) => {
        const rateLimit = this.cloudVerificationLimiter.tryAcquire();
        if (!rateLimit.allowed) {
          voiceCloudVerificationRateLimitsTotal.inc({
            reason: rateLimit.reason,
          });
          voiceTurnsTotal.inc({ outcome: "cloud-rate-limited" });
          return;
        }
        const userId = UserIdSchema.parse(turn.userId);
        const release = options.holdTeardown();
        const transaction = new AbortController();
        this.activeTransaction = transaction;
        try {
          const result = await runRealtimeVoiceTurn(options.config.voice, {
            ...turn,
            userId,
            service,
            streamer: options.streamer,
            signal: transaction.signal,
            ...(options.createRealtimeTransport === undefined
              ? {}
              : { createTransport: options.createRealtimeTransport }),
          });
          if (!result.wakeVerified) {
            this.cloudVerificationLimiter.recordTranscriptRejection();
          }
        } catch (error) {
          if (transaction.signal.aborted) return;
          log.warn("voice command transaction failed", {
            error: getErrorMessage(error),
          });
          await options.announce(
            "⚠️ Streambot couldn't process that voice command. Playback is still healthy; try “Hey Streambot” again.",
          );
        } finally {
          if (this.activeTransaction === transaction) {
            this.activeTransaction = null;
          }
          release();
        }
      },
      ...(options.createDecoder === undefined
        ? {}
        : { createDecoder: options.createDecoder }),
    });
    options.streamer.setVoiceAudioListener((audio) => {
      this.lifecycle.accept(audio);
    });
  }

  close(): void {
    this.activeTransaction?.abort(new Error("Voice assistant session closed"));
    this.activeTransaction = null;
    this.lifecycle.close();
  }
}
