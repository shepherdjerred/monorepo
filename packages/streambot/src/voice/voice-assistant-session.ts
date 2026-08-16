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
  voiceDecodeErrorsTotal,
  voiceLocalVerificationsTotal,
  voiceTranscriptVerificationsTotal,
  voiceTurnsTotal,
  voiceWakeCandidatesTotal,
  voiceWakeDetectionsTotal,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import { CloudVerificationRateLimiter } from "@shepherdjerred/streambot/voice/cloud-verification-rate-limiter.ts";
import { isQuotaExhaustedError } from "@shepherdjerred/streambot/voice/quota-errors.ts";

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
      onDecodeError: (error) => {
        voiceDecodeErrorsTotal.inc();
        log.error("speaker opus decode failed; speaker state rebuilt", {
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
          if (isQuotaExhaustedError(error)) {
            // Expected once a month: the spend ceiling on the OpenAI project token has been
            // reached. Telling the user to try again would be false — nothing will work until the
            // period rolls over — and repeating it on every wake would be noise.
            const alreadyAnnounced =
              this.cloudVerificationLimiter.isQuotaExhausted();
            this.cloudVerificationLimiter.recordQuotaExhausted();
            voiceTranscriptVerificationsTotal.inc({ outcome: "quota" });
            log.warn("voice cloud verification is out of quota", {
              error: getErrorMessage(error),
            });
            if (!alreadyAnnounced) {
              await options.announce(
                "⚠️ Streambot's voice budget for this period is used up, so voice commands are paused until it resets. Playback and slash commands are unaffected.",
              );
            }
            return;
          }
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
    // Peer userbots (other in-house bots sharing the channel) are real user accounts whose
    // audio would otherwise reach the wake detector and could trigger commands attributed to
    // their IDs. Zero-and-drop preserves the erase-everything invariant.
    const peerUserbotIds = new Set<string>(
      options.config.discord.peerUserbotIds,
    );
    options.streamer.setVoiceAudioListener((audio) => {
      if (peerUserbotIds.has(audio.userId)) {
        audio.opus.fill(0);
        return;
      }
      this.lifecycle.accept(audio);
    });
  }

  /**
   * Cancel the in-flight turn. The transaction's `finally` releases its teardown hold, so a
   * session whose voice connection died cannot stay registered past the reconnect window.
   */
  abortActiveTransaction(reason: string): void {
    this.activeTransaction?.abort(new Error(reason));
    this.activeTransaction = null;
  }

  close(): void {
    this.abortActiveTransaction("Voice assistant session closed");
    this.lifecycle.close();
  }
}
