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
import {
  speakClip,
  type SpokenFeedbackClips,
} from "@shepherdjerred/streambot/voice/spoken-feedback.ts";
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
import {
  voiceDtxDurationSeconds,
  voiceEndpointOutcomesTotal,
  voiceInputDropsTotal,
  voiceUtteranceDurationSeconds,
  voiceWakeScore,
} from "@shepherdjerred/streambot/observability/voice-diagnostic-metrics.ts";
import { CloudVerificationRateLimiter } from "@shepherdjerred/streambot/voice/cloud-verification-rate-limiter.ts";
import { isQuotaExhaustedError } from "@shepherdjerred/streambot/voice/quota-errors.ts";
import {
  NOOP_VOICE_ATTEMPT_OBSERVER,
  type VoiceAttemptHandle,
} from "@shepherdjerred/streambot/voice/attempt-context.ts";
import type {
  VoiceCaptureManager,
  VoiceDebugCaptureStatus,
  VoiceDebugStartResult,
  VoiceDebugStopResult,
  VoiceSessionIdentity,
} from "@shepherdjerred/streambot/voice/capture-manager.ts";
import { VoiceSessionTelemetry } from "@shepherdjerred/streambot/observability/voice-session.ts";

const log = logger.child("voice-assistant");

export type VoiceAssistantSessionOptions = {
  readonly config: Config;
  readonly models: LocalVoiceModels;
  readonly streamer: StreamerLike;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly commands: PlaybackCommandServiceDeps;
  readonly announce: (message: string) => Promise<void>;
  readonly holdTeardown: () => () => void;
  /** Local pre-rendered feedback; absent in probes/tests, which keep the silent behavior. */
  readonly feedbackClips?: SpokenFeedbackClips;
  readonly createRealtimeTransport?: () => RealtimeTransportLayer;
  readonly createDecoder?: () => Pick<DiscordOpusDecoder, "decode" | "close">;
  readonly captureManager?: VoiceCaptureManager;
};

/** Owns all local and remote voice state for one pooled Streambot playback session. */
export class VoiceAssistantSession {
  private readonly lifecycle: VoiceAudioLifecycle;
  private readonly cloudVerificationLimiter =
    new CloudVerificationRateLimiter();
  private activeTransaction: AbortController | null = null;
  private identity: VoiceSessionIdentity;
  private telemetry: VoiceSessionTelemetry;
  private readonly captureManager: VoiceCaptureManager | undefined;
  private readonly streamer: StreamerLike;

  constructor(options: VoiceAssistantSessionOptions) {
    this.identity = {
      guildId: options.guildId ?? "offline-guild",
      channelId: options.channelId ?? "offline-channel",
    };
    this.telemetry = new VoiceSessionTelemetry(this.identity);
    this.captureManager = options.captureManager;
    this.streamer = options.streamer;
    const service = new PlaybackCommandService(options.commands);
    this.lifecycle = new VoiceAudioLifecycle({
      models: options.models,
      preRollMs: options.config.voice.preRollMs,
      maxUtteranceMs: options.config.voice.maxUtteranceMs,
      onCandidate: (candidate) => {
        voiceWakeCandidatesTotal.inc();
        if (candidate.score !== null) {
          voiceWakeScore.observe(
            { fragment: candidate.phrase },
            candidate.score,
          );
        }
      },
      beginAttempt: (candidate): VoiceAttemptHandle =>
        options.captureManager?.begin({
          guildId: this.identity.guildId,
          channelId: this.identity.channelId,
          ...candidate,
        }) ?? NOOP_VOICE_ATTEMPT_OBSERVER.begin(),
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
      onLocalVerificationError: () => {
        voiceLocalVerificationsTotal.inc({ outcome: "error" });
      },
      onDecodeError: (error) => {
        voiceDecodeErrorsTotal.inc();
        log.error("speaker opus decode failed; speaker state rebuilt", {
          error: getErrorMessage(error),
        });
      },
      onDecoded: ({ userId, pcm16k }) => {
        this.telemetry.decoded(pcm16k.length);
        options.captureManager?.acceptDecoded(this.identity, userId, pcm16k);
      },
      onInputDrop: (reason) => {
        voiceInputDropsTotal.inc({ reason });
      },
      onEndpoint: ({ reason, sampleCount, dtxSamples }) => {
        voiceEndpointOutcomesTotal.inc({ reason });
        voiceUtteranceDurationSeconds.observe(
          { outcome: reason },
          sampleCount / 16_000,
        );
        voiceDtxDurationSeconds.observe(dtxSamples / 16_000);
      },
      onAbandoned: (reason) => {
        voiceTurnsTotal.inc({ outcome: `abandoned-${reason}` });
      },
      onTurn: async (turn) => {
        await turn.attempt.run(async () => {
          this.telemetry.turnStarted();
          try {
            const rateLimit = this.cloudVerificationLimiter.tryAcquire();
            if (!rateLimit.allowed) {
              voiceCloudVerificationRateLimitsTotal.inc({
                reason: rateLimit.reason,
              });
              voiceTurnsTotal.inc({ outcome: "cloud-rate-limited" });
              turn.attempt.cloudOutcome(`rate-limited-${rateLimit.reason}`);
              // The quota reason stays silent because its public announcement has already
              // explained the pause. Other bounded backoffs get one local retry prompt.
              if (
                options.feedbackClips !== undefined &&
                rateLimit.reason !== "quota"
              ) {
                const release = options.holdTeardown();
                try {
                  await speakClip(
                    options.streamer,
                    options.feedbackClips.retry,
                  );
                  turn.attempt.reply({
                    outcome: "local-retry-clip",
                    packets: 0,
                    bytes: options.feedbackClips.retry.byteLength,
                    durationMs: 0,
                  });
                } finally {
                  release();
                }
              }
              turn.attempt.finish("cloud-rate-limited");
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
                telemetry: this.telemetry,
                ...(options.feedbackClips === undefined
                  ? {}
                  : { feedbackClips: options.feedbackClips }),
                ...(options.createRealtimeTransport === undefined
                  ? {}
                  : { createTransport: options.createRealtimeTransport }),
              });
              if (!result.wakeVerified) {
                this.cloudVerificationLimiter.recordTranscriptRejection();
              }
              const outcome = result.wakeVerified
                ? result.normalizedCommand === ""
                  ? "bare-wake"
                  : result.mutated
                    ? "command"
                    : "no-command"
                : "transcript-rejected";
              turn.attempt.finish(outcome);
            } catch (error) {
              if (transaction.signal.aborted) {
                turn.attempt.cloudOutcome("interrupted");
                turn.attempt.finish("interrupted");
                return;
              }
              if (isQuotaExhaustedError(error)) {
                const alreadyAnnounced =
                  this.cloudVerificationLimiter.isQuotaExhausted();
                this.cloudVerificationLimiter.recordQuotaExhausted();
                voiceTranscriptVerificationsTotal.inc({ outcome: "quota" });
                turn.attempt.cloudOutcome("quota");
                turn.attempt.finish("quota", error);
                log.warn("voice cloud verification is out of quota", {
                  error: getErrorMessage(error),
                  captureId: turn.attempt.captureId,
                });
                if (!alreadyAnnounced) {
                  await options.announce(
                    "⚠️ Streambot's voice budget for this period is used up, so voice commands are paused until it resets. Playback and slash commands are unaffected.",
                  );
                }
                return;
              }
              turn.attempt.cloudOutcome("error");
              turn.attempt.finish("error", error);
              log.warn("voice command transaction failed", {
                error: getErrorMessage(error),
                captureId: turn.attempt.captureId,
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
          } finally {
            this.telemetry.turnFinished();
          }
        });
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
    options.streamer.setVoiceReceiveObserver(this.telemetry.receiveObserver);
  }

  startDebugCapture(durationSeconds: number): VoiceDebugStartResult {
    return (
      this.captureManager?.startDebug(this.identity, durationSeconds) ?? {
        outcome: "disabled",
      }
    );
  }

  stopDebugCapture(): VoiceDebugStopResult {
    return this.captureManager?.stopDebug(this.identity) ?? { outcome: "none" };
  }

  debugCaptureStatus(): VoiceDebugCaptureStatus | null {
    return this.captureManager?.debugStatus(this.identity) ?? null;
  }

  /** Rebind active-only telemetry and debug capture ownership after Discord moves the session. */
  moveChannel(channelId: string): void {
    const previousIdentity = this.identity;
    this.captureManager?.closeSession(previousIdentity);
    this.telemetry.close();
    this.identity = { guildId: previousIdentity.guildId, channelId };
    this.telemetry = new VoiceSessionTelemetry(this.identity);
    this.streamer.setVoiceReceiveObserver(this.telemetry.receiveObserver);
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
    this.captureManager?.closeSession(this.identity);
    this.streamer.setVoiceReceiveObserver(null);
    this.telemetry.close();
  }
}
