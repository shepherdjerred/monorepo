import type { ReceivedVoiceAudio } from "@shepherdjerred/discord-video-stream";
import { DiscordOpusDecoder } from "@shepherdjerred/discord-video-stream";
import type { KeywordDetectionEvidence } from "@shepherdjerred/streambot/voice/local-models.ts";
import {
  SpeakerRegistry,
  type SpeakerState,
} from "@shepherdjerred/streambot/voice/speaker-registry.ts";
import { voiceTurnDeliveryFailuresTotal } from "@shepherdjerred/streambot/observability/metrics.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import {
  VOICE_DTX_GAP_MS,
  VOICE_DTX_TICK_MS,
  VOICE_FRAGMENT_TAIL_MARGIN_MS,
  VOICE_FRAGMENT_TAIL_MS,
  VOICE_VERIFICATION_DELAY_MS,
} from "@shepherdjerred/streambot/voice/constants.ts";
import { NOOP_VOICE_ATTEMPT_OBSERVER } from "@shepherdjerred/streambot/voice/attempt-context.ts";
import type {
  CompletedVoiceTurn,
  PendingVoiceTurn,
  VoiceAudioLifecycleOptions,
  WakeCandidateEvidence,
} from "@shepherdjerred/streambot/voice/audio-lifecycle-types.ts";

const log = logger.child("voice-lifecycle");
const SAMPLE_RATE = 16_000;
const DEFAULT_POST_VERIFICATION_MS = 300;

function defaultSilenceTicker(
  onTick: () => void,
  intervalMs: number,
): () => void {
  const timer = setInterval(onTick, intervalMs);
  return () => {
    clearInterval(timer);
  };
}

function concatSamples(
  parts: readonly Float32Array[],
  length: number,
): Float32Array {
  const result = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function clearParts(parts: Float32Array[]): void {
  for (const part of parts) part.fill(0);
  parts.length = 0;
}

/** Per-session cascaded local wake/VAD state machine. It never owns a network client. */
export class VoiceAudioLifecycle {
  private readonly options: VoiceAudioLifecycleOptions;
  private readonly speakers: SpeakerRegistry;
  private pending: PendingVoiceTurn | null = null;
  private transactionRunning = false;
  private closed = false;

  constructor(options: VoiceAudioLifecycleOptions) {
    this.options = options;
    this.speakers = new SpeakerRegistry(
      options.models,
      options.createDecoder ?? (() => new DiscordOpusDecoder()),
      () => options.now?.() ?? Date.now(),
    );
  }

  accept(audio: ReceivedVoiceAudio): void {
    if (this.closed) {
      this.options.onInputDrop?.("closed");
      audio.opus.fill(0);
      return;
    }
    if (this.transactionRunning) {
      this.options.onInputDrop?.("transaction-running");
      audio.opus.fill(0);
      return;
    }
    if (this.pending !== null && this.pending.userId !== audio.userId) {
      this.options.onInputDrop?.("other-speaker");
      audio.opus.fill(0);
      return;
    }
    const speaker = this.speakers.acquire(audio.userId);
    let decoded: Float32Array;
    try {
      decoded = speaker.decoder.decode(audio.opus);
    } catch (error) {
      // Recovery at a network-input boundary: malformed or undecodable Opus wedges the libav
      // context. Destroy this speaker's state so the next packet rebuilds it, and report loudly.
      this.speakers.destroy(audio.userId);
      this.options.onDecodeError?.(error);
      return;
    } finally {
      audio.opus.fill(0);
    }
    if (decoded.length === 0) return;
    const samples = Float32Array.from(decoded);
    decoded.fill(0);
    this.options.onDecoded?.({ userId: audio.userId, pcm16k: samples });
    if (this.pending === null) {
      this.speakers.pushRolling(
        speaker,
        samples,
        Math.ceil((this.options.preRollMs / 1000) * SAMPLE_RATE),
      );
      speaker.keywordStreamSamples += samples.length;
      const match = speaker.keyword.accept(samples);
      if (match !== null) {
        this.provision(audio.userId, speaker, match);
        // sherpa resets its stream on a match, so its timestamps restart from here.
        speaker.keywordStreamSamples = 0;
      }
      return;
    }
    // Only real packets refresh the DTX clock; injected silence and finishInput padding must not,
    // or a silent stream would keep itself alive.
    this.pending.lastPacketAtMs = this.options.now?.() ?? Date.now();
    this.acceptPending(samples);
  }

  /** Finalize a bounded non-Discord input source such as the local microphone probe. */
  finishInput(): void {
    if (this.closed || this.transactionRunning || this.pending === null) return;
    this.pending.inputEnded = true;
    const missingSamples =
      this.pending.verificationTargetSamples -
      this.pending.postCandidateSamples;
    if (missingSamples > 0) {
      this.acceptPending(new Float32Array(missingSamples));
      return;
    }
    if (!this.pending.verificationRunning && !this.pending.localVerified) {
      this.startVerification(this.pending);
      return;
    }
    this.maybeFinish(this.pending, "input-ended");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pending !== null) {
      this.abandonPending(this.pending, "closed", "closed");
      this.options.onAbandoned?.("closed");
    }
    this.speakers.clearAll();
  }

  private provision(
    userId: string,
    speaker: SpeakerState,
    match: KeywordDetectionEvidence,
  ): void {
    const detectedAtMs = this.options.now?.() ?? Date.now();
    const candidate: WakeCandidateEvidence = {
      ...match,
      userId,
      detectedAtMs,
    };
    this.options.onCandidate?.(candidate);
    // Computed before anything below is allocated or mutated: it throws on a fragment missing
    // from the tail table, and throwing after the VAD exists or the timer is armed would leak
    // both while `this.pending` stays unset.
    const verificationTargetSamples = this.verificationTargetSamples(
      speaker,
      match,
    );
    const attempt =
      this.options.beginAttempt?.(candidate) ??
      NOOP_VOICE_ATTEMPT_OBSERVER.begin();
    const vad = this.options.models.createVad();
    const pcm = speaker.rolling;
    const sampleCount = speaker.rollingSamples;
    const candidateBoundary = pcm.at(-1);
    if (candidateBoundary !== undefined) vad.accept(candidateBoundary);
    const sawSpeech = vad.isSpeechActive();
    const vadCompleted = sawSpeech && vad.hasCompletedSpeech();
    speaker.rolling = [];
    speaker.rollingSamples = 0;
    const pending: PendingVoiceTurn = {
      userId,
      candidate,
      attempt,
      vad,
      pcm,
      sampleCount,
      dtxSamples: 0,
      postCandidateSamples: 0,
      verificationTargetSamples,
      verificationStartedAtSamples: 0,
      postVerificationSamples: 0,
      sawSpeech,
      vadCompleted,
      localVerified: false,
      verificationRunning: false,
      inputEnded: false,
      // The closure captures its own turn rather than re-reading this.pending, so a stray timer
      // can never time out an unrelated later turn; finishPending's identity check then makes a
      // stale firing a no-op.
      timer: setTimeout(() => {
        this.finishPending(pending, "timeout");
      }, this.options.maxUtteranceMs),
      lastPacketAtMs: detectedAtMs,
      stopSilenceTicker: () => {
        /* replaced below once the pending turn is registered */
      },
    };
    this.pending = pending;
    const createTicker =
      this.options.createSilenceTicker ?? defaultSilenceTicker;
    pending.stopSilenceTicker = createTicker(() => {
      this.onSilenceTick(pending);
    }, this.options.dtxTickMs ?? VOICE_DTX_TICK_MS);
    this.speakers.retainOnly(userId);
  }

  /**
   * DTX endpointing: once no real packet has arrived for the gap threshold, the remote client has
   * stopped its RTP stream, so feed wall-clock silence through the normal pending path. That
   * advances the verification window (a wake whose tail fell into DTX silence still verifies) and
   * the Silero VAD (which needs 0.65 s of actual silence input to complete), exactly as trailing
   * packets would. A rejected verifier still discards the turn, so injection can never create
   * cloud traffic that real speech would not have.
   */
  private onSilenceTick(pending: PendingVoiceTurn): void {
    if (this.pending !== pending || this.closed) return;
    const nowMs = this.options.now?.() ?? Date.now();
    const gapMs = this.options.dtxGapMs ?? VOICE_DTX_GAP_MS;
    if (nowMs - pending.lastPacketAtMs < gapMs) return;
    const tickMs = this.options.dtxTickMs ?? VOICE_DTX_TICK_MS;
    this.acceptPending(
      new Float32Array(Math.ceil((tickMs / 1000) * SAMPLE_RATE)),
      true,
    );
  }

  private acceptPending(samples: Float32Array, dtx = false): void {
    const pending = this.pending;
    if (pending === null) {
      samples.fill(0);
      return;
    }
    pending.pcm.push(samples);
    pending.sampleCount += samples.length;
    if (dtx) pending.dtxSamples += samples.length;
    pending.postCandidateSamples += samples.length;
    if (pending.verificationRunning) {
      pending.postVerificationSamples =
        pending.postCandidateSamples - pending.verificationStartedAtSamples;
    }
    pending.vad.accept(samples);
    if (pending.vad.isSpeechActive()) pending.sawSpeech = true;
    if (pending.sawSpeech && pending.vad.hasCompletedSpeech()) {
      pending.vadCompleted = true;
    }
    if (
      !pending.localVerified &&
      !pending.verificationRunning &&
      pending.postCandidateSamples >= pending.verificationTargetSamples
    ) {
      this.startVerification(pending);
    }
    this.maybeFinish(pending, "vad");
  }

  /**
   * How much more audio to collect before scoring the phrase verifier.
   *
   * Anchored to the fragment's own timestamp rather than to sherpa's emission: the decoder can
   * report a match hundreds of milliseconds after the audio, by a margin that varies more than the
   * verifier's whole tolerance. Each fragment also ends at a different point in the phrase, so the
   * remaining tail is per-fragment. A runtime that reports no timestamp falls back to the fixed
   * delay, which is set to the measured zero-false-accept point.
   */
  private verificationTargetSamples(
    speaker: SpeakerState,
    match: KeywordDetectionEvidence,
  ): number {
    if (match.fragmentEndSeconds === null) {
      return Math.ceil(
        ((this.options.verificationDelayMs ?? VOICE_VERIFICATION_DELAY_MS) /
          1000) *
          SAMPLE_RATE,
      );
    }
    const tailMs = VOICE_FRAGMENT_TAIL_MS[match.phrase];
    if (tailMs === undefined) {
      // The keyword file and the tail table are one contract; a fragment in one and not the other
      // is a packaging bug, not a runtime condition to paper over.
      throw new Error(
        `No verification tail is defined for fragment ${match.phrase}`,
      );
    }
    const tailSamples = Math.ceil(
      ((tailMs + VOICE_FRAGMENT_TAIL_MARGIN_MS) / 1000) * SAMPLE_RATE,
    );
    const fragmentEndSamples = Math.round(
      match.fragmentEndSeconds * SAMPLE_RATE,
    );
    const alreadyCollected = Math.max(
      0,
      speaker.keywordStreamSamples - fragmentEndSamples,
    );
    return Math.max(0, tailSamples - alreadyCollected);
  }

  private startVerification(pending: PendingVoiceTurn): void {
    if (this.pending !== pending || pending.verificationRunning) return;
    pending.verificationRunning = true;
    pending.verificationStartedAtSamples = pending.postCandidateSamples;
    const verificationAudio = concatSamples(pending.pcm, pending.sampleCount);
    const startedAtMs = this.options.now?.() ?? Date.now();
    // `verify` handles its own failures, so this settles for every outcome — including a
    // superseded or closed turn, which reports nothing through the evidence callbacks.
    const settled = this.verify(pending, verificationAudio, startedAtMs);
    this.options.onLocalVerificationScheduled?.(settled);
    void settled;
  }

  private async verify(
    pending: PendingVoiceTurn,
    verificationAudio: Float32Array,
    startedAtMs: number,
  ): Promise<void> {
    try {
      const result =
        await this.options.models.verifyWakePhrase(verificationAudio);
      if (this.pending !== pending || this.closed) return;
      const completedAtMs = this.options.now?.() ?? Date.now();
      this.options.onLocalVerification?.({
        ...result,
        latencyMs: Math.max(0, completedAtMs - startedAtMs),
      });
      pending.attempt.localVerification({
        ...result,
        latencyMs: Math.max(0, completedAtMs - startedAtMs),
      });
      if (!result.accepted) {
        const pcm16k = concatSamples(pending.pcm, pending.sampleCount);
        this.recordEndpoint(pending, "local-rejected", pcm16k);
        pending.attempt.finish("local-rejected");
        pcm16k.fill(0);
        this.discardPending(pending);
        this.speakers.clearAll();
        return;
      }
      pending.localVerified = true;
      pending.postVerificationSamples =
        pending.postCandidateSamples - pending.verificationStartedAtSamples;
      this.options.onWake?.();
      this.maybeFinish(pending, pending.inputEnded ? "input-ended" : "vad");
    } catch (error) {
      if (this.pending === pending && !this.closed) {
        this.options.onLocalVerificationError?.(error);
        const pcm16k = concatSamples(pending.pcm, pending.sampleCount);
        pending.attempt.recordStage(
          "streambot.voice.local_verification",
          Math.max(0, (this.options.now?.() ?? Date.now()) - startedAtMs),
          {},
          error,
        );
        this.recordEndpoint(pending, "local-verification-error", pcm16k);
        pending.attempt.finish("local-verification-error", error);
        pcm16k.fill(0);
        this.discardPending(pending);
        this.speakers.clearAll();
      }
    } finally {
      verificationAudio.fill(0);
    }
  }

  private maybeFinish(
    pending: PendingVoiceTurn,
    reason: "vad" | "input-ended",
  ): void {
    if (this.pending !== pending || !pending.localVerified) return;
    const requiredSamples = Math.ceil(
      ((this.options.postVerificationMs ?? DEFAULT_POST_VERIFICATION_MS) /
        1000) *
        SAMPLE_RATE,
    );
    if (
      pending.inputEnded &&
      pending.postVerificationSamples < requiredSamples
    ) {
      const silence = new Float32Array(
        requiredSamples - pending.postVerificationSamples,
      );
      pending.pcm.push(silence);
      pending.sampleCount += silence.length;
      pending.postCandidateSamples += silence.length;
      pending.postVerificationSamples += silence.length;
      pending.vad.accept(silence);
      if (pending.sawSpeech && pending.vad.hasCompletedSpeech()) {
        pending.vadCompleted = true;
      }
    }
    if (pending.postVerificationSamples < requiredSamples) return;
    if (pending.vadCompleted || pending.inputEnded) {
      this.finishPending(pending, reason);
    }
  }

  private finishPending(
    pending: PendingVoiceTurn,
    reason: "vad" | "timeout" | "input-ended",
  ): void {
    if (this.pending !== pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.stopSilenceTicker();
    pending.vad.flush();
    pending.vad.close();
    if (!pending.localVerified || !pending.sawSpeech) {
      const abandoned = reason === "timeout" ? "timeout" : "empty";
      const pcm16k = concatSamples(pending.pcm, pending.sampleCount);
      this.recordEndpoint(pending, abandoned, pcm16k);
      pending.attempt.finish(abandoned);
      pcm16k.fill(0);
      clearParts(pending.pcm);
      this.options.onAbandoned?.(abandoned);
      this.speakers.clearAll();
      return;
    }
    const pcm16k = concatSamples(pending.pcm, pending.sampleCount);
    this.recordEndpoint(pending, reason, pcm16k);
    clearParts(pending.pcm);
    const turn: CompletedVoiceTurn = {
      userId: pending.userId,
      pcm16k,
      activatedAtMs: pending.candidate.detectedAtMs,
      attempt: pending.attempt,
    };
    this.transactionRunning = true;
    this.speakers.clearAll();
    void this.deliver(turn);
  }

  private async deliver(turn: CompletedVoiceTurn): Promise<void> {
    try {
      await this.options.onTurn(turn);
    } catch (error) {
      // Started with `void`, so a rejection here has nowhere to go and becomes
      // an unhandled rejection. Not every onTurn failure is caught by the turn
      // itself: VoiceAssistantSession runs UserIdSchema.parse and holdTeardown
      // *before* its own try/catch, so those throw straight past it. Count and
      // log it (no user or transcript context, by design) and let the finally
      // below still release the transaction.
      voiceTurnDeliveryFailuresTotal.inc();
      log.error("voice turn delivery failed", {
        error: getErrorMessage(error),
      });
      turn.attempt.finish("delivery-error", error);
    } finally {
      turn.pcm16k.fill(0);
      this.transactionRunning = false;
      if (!this.closed) this.speakers.clearAll();
    }
  }

  private discardPending(pending: PendingVoiceTurn): void {
    if (this.pending === pending) this.pending = null;
    clearTimeout(pending.timer);
    pending.stopSilenceTicker();
    pending.vad.close();
    clearParts(pending.pcm);
  }

  private abandonPending(
    pending: PendingVoiceTurn,
    endpointReason: string,
    outcome: string,
  ): void {
    const pcm16k = concatSamples(pending.pcm, pending.sampleCount);
    this.recordEndpoint(pending, endpointReason, pcm16k);
    pending.attempt.finish(outcome);
    pcm16k.fill(0);
    this.discardPending(pending);
  }

  private recordEndpoint(
    pending: PendingVoiceTurn,
    reason: string,
    pcm16k: Float32Array,
  ): void {
    const evidence = {
      reason,
      sampleCount: pending.sampleCount,
      dtxSamples: pending.dtxSamples,
      sawSpeech: pending.sawSpeech,
      pcm16k,
    };
    pending.attempt.endpoint(evidence);
    this.options.onEndpoint?.(evidence);
  }
}
