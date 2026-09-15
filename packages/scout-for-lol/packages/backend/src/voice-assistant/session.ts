import {
  CloudVerificationRateLimiter,
  isQuotaExhaustedError,
  VoiceAudioLifecycle,
  type AssistantAudioSink,
  type LocalVoiceModels,
  type SpokenFeedbackClips,
  type VoiceAudioInput,
} from "@shepherdjerred/voice-assistant";
import type { AbilitySlot } from "@scout-for-lol/data";
import {
  VOICE_FRAGMENT_TAIL_MS,
  VOICE_MAX_UTTERANCE_MS,
  VOICE_PRE_ROLL_MS,
  voiceAudioRequestSignal,
} from "#src/voice-assistant/constants.ts";
import {
  scoutVoiceLifecycleMetrics,
  scoutVoiceObservability,
} from "#src/voice-assistant/metrics-ports.ts";
import {
  scoutVoiceActivationStageLatencySeconds,
  scoutVoiceCloudRequestsTotal,
  scoutVoiceConcurrentTurns,
  scoutVoiceLocalVerificationsTotal,
  scoutVoiceOpenAiFailuresTotal,
  scoutVoiceRateLimitedTotal,
  scoutVoiceTranscriptVerificationsTotal,
  scoutVoiceTurnsTotal,
  scoutVoiceWakeCandidatesTotal,
  scoutVoiceWakeDetectionsTotal,
  scoutVoiceWakeToReplySeconds,
} from "#src/metrics/platform/voice.ts";
import { createLogger } from "#src/logger.ts";
import type { VoiceQuestionOutcome } from "#src/analytics/product-analytics.ts";
import {
  startVoiceExplore,
  type StartedVoiceExplore,
  type VoiceExploreCompletion,
} from "#src/voice-assistant/explore-adapter.ts";
import {
  synthesizeVoiceAnswer,
  transcribeVoiceQuestion,
} from "@shepherdjerred/voice-assistant/openai-audio.ts";
import {
  VoiceFollowUpWindow,
  VOICE_FOLLOW_UP_LIMIT,
  type ResolvedVoiceCommand,
} from "#src/voice-assistant/follow-up.ts";
import {
  voiceCompletionObservation,
  voiceCompletionText,
} from "#src/voice-assistant/completion.ts";
import { SerializedAssistantOutput } from "#src/voice-assistant/serialized-output.ts";
import type {
  BackgroundCompletionInput,
  TurnAudioClock,
  VoiceTurn,
} from "#src/voice-assistant/session-types.ts";

const logger = createLogger("voice-assistant-session");
const QUICK_ANSWER_MS = 2000;
const LONG_TURN_ACK = "I'm checking that now.";
const BUSY_REPLY = "I'm still working on your last question.";
export type VoiceQuestionObservation = {
  readonly outcome: VoiceQuestionOutcome;
  readonly wakeToReplySeconds: number | undefined;
  readonly champion: string | undefined;
  readonly abilitySlot: AbilitySlot | undefined;
};
type VoiceUserProfile = { username: string; avatar: string | null };
export type ScoutVoiceSessionOptions = {
  readonly guildId: string;
  readonly models: LocalVoiceModels;
  readonly openAiApiKey: string;
  readonly createAssistantAudio: () => AssistantAudioSink;
  readonly resolveUserProfile: (userId: string) => Promise<VoiceUserProfile>;
  readonly feedbackClips?: SpokenFeedbackClips;
  readonly onWakeAccepted?: () => void;
  readonly onQuestionObserved?: (observation: VoiceQuestionObservation) => void;
  readonly transcribe?: typeof transcribeVoiceQuestion;
  readonly synthesize?: typeof synthesizeVoiceAnswer;
  readonly startExplore?: typeof startVoiceExplore;
  readonly audioRequestTimeoutMs?: number;
  readonly now?: () => number;
  readonly setTimer?: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
};
export class ScoutVoiceSession {
  private readonly lifecycle: VoiceAudioLifecycle;
  private readonly cloudVerificationLimiter: CloudVerificationRateLimiter;
  private readonly followUp: VoiceFollowUpWindow;
  private readonly options: ScoutVoiceSessionOptions;
  private readonly conversations = new Map<string, string>();
  private readonly activeSpeakers = new Set<string>();
  private readonly backgroundAudio = new Set<AbortController>();
  private readonly activeTransactions = new Set<AbortController>();
  private readonly output = new SerializedAssistantOutput();
  private closed = false;

  constructor(options: ScoutVoiceSessionOptions) {
    this.options = options;
    const now = options.now ?? Date.now;
    this.cloudVerificationLimiter = new CloudVerificationRateLimiter(
      now,
      VOICE_FOLLOW_UP_LIMIT + 1,
    );
    this.followUp = new VoiceFollowUpWindow(now);
    this.lifecycle = new VoiceAudioLifecycle({
      models: options.models,
      preRollMs: VOICE_PRE_ROLL_MS,
      maxUtteranceMs: VOICE_MAX_UTTERANCE_MS,
      fragmentTailMs: VOICE_FRAGMENT_TAIL_MS,
      metrics: scoutVoiceLifecycleMetrics,
      observability: scoutVoiceObservability("voice-lifecycle"),
      now,
      isFollowUpAllowed: (userId) => this.followUp.isAllowed(userId),
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
        if (turn.followUp) options.onWakeAccepted?.();
        await this.handleCompletedTurn(turn);
      },
    });
  }

  private observe(
    outcome: VoiceQuestionOutcome,
    activatedAtMs: number,
    firstAudioAtMs: number | undefined,
  ): void {
    scoutVoiceTurnsTotal.inc({ outcome });
    if (firstAudioAtMs !== undefined) {
      scoutVoiceWakeToReplySeconds.observe(
        (firstAudioAtMs - activatedAtMs) / 1000,
      );
    }
    this.options.onQuestionObserved?.({
      outcome,
      wakeToReplySeconds:
        firstAudioAtMs === undefined
          ? undefined
          : (firstAudioAtMs - activatedAtMs) / 1000,
      champion: undefined,
      abilitySlot: undefined,
    });
  }

  private async speakText(
    text: string,
    signal: AbortSignal,
    firstAudio: () => void,
  ): Promise<void> {
    scoutVoiceCloudRequestsTotal.inc({
      stage: "synthesis",
      outcome: "request",
    });
    let pcm: Uint8Array;
    try {
      pcm = await (this.options.synthesize ?? synthesizeVoiceAnswer)({
        apiKey: this.options.openAiApiKey,
        text,
        signal: voiceAudioRequestSignal(
          signal,
          this.options.audioRequestTimeoutMs,
        ),
      });
      scoutVoiceCloudRequestsTotal.inc({
        stage: "synthesis",
        outcome: "success",
      });
    } catch (error) {
      scoutVoiceOpenAiFailuresTotal.inc({ stage: "synthesis" });
      scoutVoiceCloudRequestsTotal.inc({
        stage: "synthesis",
        outcome: "failure",
      });
      throw error;
    }
    await this.output.send(this.options.createAssistantAudio, pcm, firstAudio);
  }

  private finishInBackground(input: BackgroundCompletionInput): void {
    const controller = new AbortController();
    this.backgroundAudio.add(controller);
    void this.completeInBackground(input, controller);
  }

  private async completeInBackground(
    input: BackgroundCompletionInput,
    controller: AbortController,
  ): Promise<void> {
    try {
      const started = await input.started;
      const completion = await started.completion;
      if (!this.closed) {
        await this.speakText(
          voiceCompletionText(completion),
          controller.signal,
          input.markFirstAudio,
        );
      }
      if (completion.outcome === "succeeded") {
        this.followUp.arm(input.userId, input.usedFollowUp);
      }
      this.observe(
        voiceCompletionObservation(completion),
        input.activatedAtMs,
        input.firstAudioAtMs(),
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        logger.warn("voice Explore answer delivery failed", {
          guildId: this.options.guildId,
          error: error instanceof Error ? error.message : String(error),
        });
        if (this.options.feedbackClips !== undefined) {
          await this.output.trySend(
            this.options.createAssistantAudio,
            this.options.feedbackClips.retry,
            input.markFirstAudio,
          );
        }
        this.observe("error", input.activatedAtMs, input.firstAudioAtMs());
      }
    } finally {
      this.backgroundAudio.delete(controller);
      this.activeSpeakers.delete(input.userId);
    }
  }

  private async transcribeCommand(input: {
    turn: VoiceTurn;
    transaction: AbortController;
    audio: TurnAudioClock;
  }): Promise<ResolvedVoiceCommand | null> {
    scoutVoiceCloudRequestsTotal.inc({
      stage: "transcription",
      outcome: "request",
    });
    let transcript: string;
    try {
      transcript = await (this.options.transcribe ?? transcribeVoiceQuestion)({
        apiKey: this.options.openAiApiKey,
        pcm16k: input.turn.pcm16k,
        signal: voiceAudioRequestSignal(
          input.transaction.signal,
          this.options.audioRequestTimeoutMs,
        ),
      });
      scoutVoiceCloudRequestsTotal.inc({
        stage: "transcription",
        outcome: "success",
      });
    } catch (error) {
      scoutVoiceOpenAiFailuresTotal.inc({ stage: "transcription" });
      scoutVoiceCloudRequestsTotal.inc({
        stage: "transcription",
        outcome: "failure",
      });
      throw error;
    }
    const resolved = this.followUp.resolveTranscript(
      transcript,
      input.turn.followUp,
      input.turn.userId,
    );
    if (resolved === null) {
      this.cloudVerificationLimiter.recordTranscriptRejection();
      scoutVoiceTranscriptVerificationsTotal.inc({ outcome: "rejected" });
      if (this.options.feedbackClips !== undefined) {
        await this.output.send(
          this.options.createAssistantAudio,
          this.options.feedbackClips.retry,
          input.audio.markFirstAudio,
        );
      }
      this.observe(
        "transcript-rejected",
        input.turn.activatedAtMs,
        input.audio.firstAudioAtMs(),
      );
      return null;
    }
    scoutVoiceTranscriptVerificationsTotal.inc({ outcome: "accepted" });
    if (resolved.command.length > 0) return resolved;
    if (this.options.feedbackClips !== undefined) {
      await this.output.send(
        this.options.createAssistantAudio,
        this.options.feedbackClips.prompt,
        input.audio.markFirstAudio,
      );
    }
    this.observe(
      "bare-wake",
      input.turn.activatedAtMs,
      input.audio.firstAudioAtMs(),
    );
    return null;
  }

  private async completionBeforeAck(
    started: Promise<StartedVoiceExplore>,
    acknowledgement: Promise<{ kind: "ack" }>,
  ): Promise<
    { kind: "complete"; completion: VoiceExploreCompletion } | { kind: "ack" }
  > {
    const completed = async (): Promise<{
      kind: "complete";
      completion: VoiceExploreCompletion;
    }> => {
      const value = await started;
      const completion = await value.completion;
      return { kind: "complete", completion };
    };
    return await Promise.race([completed(), acknowledgement]);
  }

  private acknowledgementDeadline(): Promise<{ kind: "ack" }> {
    const setTimer = this.options.setTimer ?? setTimeout;
    return new Promise((resolve) => {
      setTimer(() => {
        resolve({ kind: "ack" });
      }, QUICK_ANSWER_MS);
    });
  }

  private async runExploreCommand(input: {
    turn: VoiceTurn;
    resolved: ResolvedVoiceCommand;
    transaction: AbortController;
    audio: TurnAudioClock;
  }): Promise<void> {
    if (this.activeSpeakers.has(input.turn.userId)) {
      await this.speakText(
        BUSY_REPLY,
        input.transaction.signal,
        input.audio.markFirstAudio,
      );
      this.observe(
        "busy",
        input.turn.activatedAtMs,
        input.audio.firstAudioAtMs(),
      );
      return;
    }
    this.followUp.consume(input.turn.userId, input.resolved.usedFollowUp);
    this.activeSpeakers.add(input.turn.userId);
    const acknowledgement = this.acknowledgementDeadline();
    const started = (async () => {
      const profile = await this.options.resolveUserProfile(input.turn.userId);
      const value = await (this.options.startExplore ?? startVoiceExplore)({
        userId: input.turn.userId,
        guildId: this.options.guildId,
        question: input.resolved.command,
        conversationId: this.conversations.get(input.turn.userId) ?? null,
        username: profile.username,
        avatar: profile.avatar,
      });
      this.conversations.set(input.turn.userId, value.conversationId);
      return value;
    })();
    const quick = await this.completionBeforeAck(started, acknowledgement);
    if (quick.kind === "complete") {
      await this.speakText(
        voiceCompletionText(quick.completion),
        input.transaction.signal,
        input.audio.markFirstAudio,
      );
      if (quick.completion.outcome === "succeeded") {
        this.followUp.arm(input.turn.userId, input.resolved.usedFollowUp);
      }
      this.observe(
        voiceCompletionObservation(quick.completion),
        input.turn.activatedAtMs,
        input.audio.firstAudioAtMs(),
      );
      this.activeSpeakers.delete(input.turn.userId);
      return;
    }
    await this.speakText(
      LONG_TURN_ACK,
      input.transaction.signal,
      input.audio.markFirstAudio,
    );
    this.finishInBackground({
      started,
      userId: input.turn.userId,
      usedFollowUp: input.resolved.usedFollowUp,
      activatedAtMs: input.turn.activatedAtMs,
      firstAudioAtMs: input.audio.firstAudioAtMs,
      markFirstAudio: input.audio.markFirstAudio,
    });
  }

  /** One endpointed utterance. Returns after a quick answer or spoken ack. */
  async handleCompletedTurn(turn: VoiceTurn): Promise<void> {
    const rateLimit = this.cloudVerificationLimiter.tryAcquire();
    if (!rateLimit.allowed) {
      scoutVoiceRateLimitedTotal.inc({ reason: rateLimit.reason });
      this.observe("rate-limited", turn.activatedAtMs, undefined);
      return;
    }
    const transaction = new AbortController();
    this.activeTransactions.add(transaction);
    scoutVoiceConcurrentTurns.inc();
    const now = this.options.now ?? Date.now;
    let firstAudioAtMs: number | undefined;
    const markFirstAudio = (): void => {
      firstAudioAtMs ??= now();
    };
    const audio: TurnAudioClock = {
      firstAudioAtMs: () => firstAudioAtMs,
      markFirstAudio,
    };
    try {
      const resolved = await this.transcribeCommand({
        turn,
        transaction,
        audio,
      });
      if (resolved === null) return;
      await this.runExploreCommand({ turn, resolved, transaction, audio });
    } catch (error) {
      if (transaction.signal.aborted) {
        this.observe("interrupted", turn.activatedAtMs, firstAudioAtMs);
        return;
      }
      if (isQuotaExhaustedError(error)) {
        this.cloudVerificationLimiter.recordQuotaExhausted();
        scoutVoiceTranscriptVerificationsTotal.inc({ outcome: "quota" });
      }
      logger.warn("voice question turn failed", {
        guildId: this.options.guildId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (this.options.feedbackClips !== undefined) {
        await this.output.trySend(
          this.options.createAssistantAudio,
          this.options.feedbackClips.retry,
          markFirstAudio,
        );
      }
      this.activeSpeakers.delete(turn.userId);
      this.observe("error", turn.activatedAtMs, firstAudioAtMs);
    } finally {
      this.activeTransactions.delete(transaction);
      scoutVoiceConcurrentTurns.dec();
    }
  }

  accept(audio: VoiceAudioInput): void {
    this.lifecycle.accept(audio);
  }

  abortActiveTransaction(reason: string): void {
    for (const transaction of this.activeTransactions) {
      transaction.abort(new Error(reason));
    }
    this.activeTransactions.clear();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abortActiveTransaction("Voice assistant session closed");
    for (const controller of this.backgroundAudio) {
      controller.abort(new Error("Voice assistant session closed"));
    }
    this.backgroundAudio.clear();
    this.lifecycle.close();
  }
}
