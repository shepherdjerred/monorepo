import type { RealtimeTransportLayer } from "@openai/agents/realtime";
import {
  CloudVerificationRateLimiter,
  isQuotaExhaustedError,
  runRealtimeCommandTurn,
  VoiceAudioLifecycle,
  type AssistantAudioSink,
  type RealtimeTurnOptions,
  type SpokenFeedbackClips,
  type VoiceAudioInput,
} from "@shepherdjerred/voice-assistant";
import type { AbilitySlot } from "@scout-for-lol/data";
import {
  VOICE_ASSISTANT_VOICE,
  VOICE_FRAGMENT_TAIL_MS,
  VOICE_MAX_UTTERANCE_MS,
  VOICE_PRE_ROLL_MS,
  VOICE_REALTIME_MODEL,
  VOICE_TRANSACTION_TIMEOUT_MS,
  VOICE_WAKE_PREFIXES,
} from "#src/voice-assistant/constants.ts";
import { VOICE_INSTRUCTIONS } from "#src/voice-assistant/prompt.ts";
import {
  createLeagueVoiceTools,
  VoiceTurnFactsRecorder,
} from "#src/voice-assistant/league-tools.ts";
import {
  scoutRealtimeTurnMetrics,
  scoutVoiceLifecycleMetrics,
  scoutVoiceObservability,
} from "#src/voice-assistant/metrics-ports.ts";
import {
  scoutVoiceActivationStageLatencySeconds,
  scoutVoiceLocalVerificationsTotal,
  scoutVoiceRateLimitedTotal,
  scoutVoiceTranscriptVerificationsTotal,
  scoutVoiceTurnsTotal,
  scoutVoiceWakeCandidatesTotal,
  scoutVoiceWakeDetectionsTotal,
} from "#src/metrics/voice.ts";
import { createLogger } from "#src/logger.ts";
import type { LocalVoiceModels } from "@shepherdjerred/voice-assistant";
import type { VoiceQuestionOutcome } from "#src/analytics/product-analytics.ts";

const logger = createLogger("voice-assistant-session");

export type VoiceQuestionObservation = {
  readonly outcome: VoiceQuestionOutcome;
  readonly wakeToReplySeconds: number;
  readonly champion: string | undefined;
  readonly abilitySlot: AbilitySlot | undefined;
};

/** The Scout-specific Realtime turn options for one wake. */
export function scoutRealtimeTurnOptions(
  openAiApiKey: string,
  recorder: VoiceTurnFactsRecorder,
): RealtimeTurnOptions {
  return {
    apiKey: openAiApiKey,
    model: VOICE_REALTIME_MODEL,
    assistantVoice: VOICE_ASSISTANT_VOICE,
    agentName: "Scout",
    instructions: VOICE_INSTRUCTIONS,
    transactionTimeoutMs: VOICE_TRANSACTION_TIMEOUT_MS,
    wakePrefixes: VOICE_WAKE_PREFIXES,
    tools: () => createLeagueVoiceTools(recorder),
    metrics: scoutRealtimeTurnMetrics,
    observability: scoutVoiceObservability("voice-realtime"),
  };
}

export type ScoutVoiceSessionOptions = {
  readonly guildId: string;
  readonly models: LocalVoiceModels;
  readonly openAiApiKey: string;
  /** One paced sink per turn, bound to the live voice connection. */
  readonly createAssistantAudio: () => AssistantAudioSink;
  /** Local pre-rendered feedback; absent until the trained assets ship. */
  readonly feedbackClips?: SpokenFeedbackClips;
  /** Called on every locally accepted wake; the manager resets its inactivity timer. */
  readonly onWakeAccepted?: () => void;
  /** Privacy boundary: receives outcome + latency + resolved facts, never audio or text. */
  readonly onQuestionObserved?: (observation: VoiceQuestionObservation) => void;
  /** Test seam; production omits this and gets the official WebSocket transport. */
  readonly createTransport?: () => RealtimeTransportLayer;
  /**
   * Turn-boundary seam: the shared `runRealtimeCommandTurn` unless a test
   * substitutes it. A rate-limited wake never invokes it, which is the "no
   * transport is ever opened" guarantee the tests pin down.
   */
  readonly runTurn?: typeof runRealtimeCommandTurn;
  readonly now?: () => number;
};

function turnOutcome(result: {
  wakeVerified: boolean;
  normalizedCommand: string | null;
}): VoiceQuestionOutcome {
  if (!result.wakeVerified) return "transcript-rejected";
  if (result.normalizedCommand === "") return "bare-wake";
  return "answered";
}

/**
 * Owns all local and remote voice state for one guild's Hey Scout session:
 * the shared audio lifecycle, the per-session cloud rate limiter, and one
 * Realtime turn per accepted wake. Privacy invariants live in the shared
 * pipeline (buffer zero-fill, audio item delete, no history); this class adds
 * only Scout's tools, metrics, and the transcript-free analytics observation.
 */
export class ScoutVoiceSession {
  private readonly lifecycle: VoiceAudioLifecycle;
  private readonly cloudVerificationLimiter =
    new CloudVerificationRateLimiter();
  private activeTransaction: AbortController | null = null;
  private readonly options: ScoutVoiceSessionOptions;

  constructor(options: ScoutVoiceSessionOptions) {
    this.options = options;
    const now = options.now ?? (() => Date.now());
    this.lifecycle = new VoiceAudioLifecycle({
      models: options.models,
      preRollMs: VOICE_PRE_ROLL_MS,
      maxUtteranceMs: VOICE_MAX_UTTERANCE_MS,
      fragmentTailMs: VOICE_FRAGMENT_TAIL_MS,
      metrics: scoutVoiceLifecycleMetrics,
      observability: scoutVoiceObservability("voice-lifecycle"),
      now,
      onCandidate: () => {
        scoutVoiceWakeCandidatesTotal.inc();
      },
      onWake: () => {
        scoutVoiceWakeDetectionsTotal.inc();
        options.onWakeAccepted?.();
      },
      onLocalVerification: (evidence) => {
        scoutVoiceLocalVerificationsTotal.inc({
          outcome: evidence.accepted ? "accepted" : "rejected",
        });
        scoutVoiceActivationStageLatencySeconds.observe(
          { stage: "local-verifier" },
          evidence.latencyMs / 1000,
        );
      },
      onLocalVerificationError: () => {
        scoutVoiceLocalVerificationsTotal.inc({ outcome: "error" });
      },
      onAbandoned: (reason) => {
        scoutVoiceTurnsTotal.inc({ outcome: `abandoned-${reason}` });
      },
      onTurn: async (turn) => {
        await this.handleCompletedTurn(turn.pcm16k, turn.activatedAtMs);
      },
    });
  }

  private observe(
    outcome: VoiceQuestionOutcome,
    activatedAtMs: number,
    recorder: VoiceTurnFactsRecorder | undefined,
  ): void {
    const now = this.options.now ?? (() => Date.now());
    this.options.onQuestionObserved?.({
      outcome,
      wakeToReplySeconds: (now() - activatedAtMs) / 1000,
      champion: recorder?.champion,
      abilitySlot: recorder?.slot,
    });
  }

  /** One accepted wake. Invoked by the audio lifecycle; exposed for tests. */
  async handleCompletedTurn(
    pcm16k: Float32Array,
    activatedAtMs: number,
  ): Promise<void> {
    const rateLimit = this.cloudVerificationLimiter.tryAcquire();
    if (!rateLimit.allowed) {
      scoutVoiceRateLimitedTotal.inc({ reason: rateLimit.reason });
      scoutVoiceTurnsTotal.inc({ outcome: "cloud-rate-limited" });
      this.observe("rate-limited", activatedAtMs, undefined);
      return;
    }
    const recorder = new VoiceTurnFactsRecorder();
    const transaction = new AbortController();
    this.activeTransaction = transaction;
    const runTurn = this.options.runTurn ?? runRealtimeCommandTurn;
    try {
      const result = await runTurn(
        scoutRealtimeTurnOptions(this.options.openAiApiKey, recorder),
        {
          pcm16k,
          activatedAtMs,
          assistantAudio: this.options.createAssistantAudio(),
          signal: transaction.signal,
          ...(this.options.feedbackClips === undefined
            ? {}
            : { feedbackClips: this.options.feedbackClips }),
          ...(this.options.createTransport === undefined
            ? {}
            : { createTransport: this.options.createTransport }),
        },
      );
      if (!result.wakeVerified) {
        this.cloudVerificationLimiter.recordTranscriptRejection();
      }
      this.observe(turnOutcome(result), activatedAtMs, recorder);
    } catch (error) {
      if (transaction.signal.aborted) {
        this.observe("interrupted", activatedAtMs, recorder);
        return;
      }
      if (isQuotaExhaustedError(error)) {
        this.cloudVerificationLimiter.recordQuotaExhausted();
        scoutVoiceTranscriptVerificationsTotal.inc({ outcome: "quota" });
        logger.warn("voice cloud verification is out of quota", {
          guildId: this.options.guildId,
        });
        this.observe("error", activatedAtMs, recorder);
        return;
      }
      logger.warn("voice question turn failed", {
        guildId: this.options.guildId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.observe("error", activatedAtMs, recorder);
    } finally {
      if (this.activeTransaction === transaction) {
        this.activeTransaction = null;
      }
    }
  }

  accept(audio: VoiceAudioInput): void {
    this.lifecycle.accept(audio);
  }

  /** Cancel the in-flight turn so teardown never waits on OpenAI. */
  abortActiveTransaction(reason: string): void {
    this.activeTransaction?.abort(new Error(reason));
    this.activeTransaction = null;
  }

  close(): void {
    this.abortActiveTransaction("Voice assistant session closed");
    this.lifecycle.close();
  }
}
