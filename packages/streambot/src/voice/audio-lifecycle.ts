import type { ReceivedVoiceAudio } from "@shepherdjerred/discord-video-stream";
import { DiscordOpusDecoder } from "@shepherdjerred/discord-video-stream";
import type {
  KeywordDetectionEvidence,
  KeywordDetector,
  LocalVoiceModels,
  VoiceActivityDetector,
} from "@shepherdjerred/streambot/voice/local-models.ts";

const SAMPLE_RATE = 16_000;
const DEFAULT_PROVISIONAL_MS = 1250;
const DEFAULT_POST_VERIFICATION_MS = 300;

type SpeakerState = {
  readonly decoder: Pick<DiscordOpusDecoder, "decode" | "close">;
  readonly keyword: KeywordDetector;
  rolling: Float32Array[];
  rollingSamples: number;
};

export type WakeCandidateEvidence = KeywordDetectionEvidence & {
  readonly userId: string;
  readonly detectedAtMs: number;
};

export type LocalWakeVerificationEvidence = {
  readonly accepted: boolean;
  readonly score: number;
  readonly latencyMs: number;
};

type PendingTurn = {
  readonly userId: string;
  readonly candidate: WakeCandidateEvidence;
  readonly vad: VoiceActivityDetector;
  pcm: Float32Array[];
  sampleCount: number;
  postCandidateSamples: number;
  verificationStartedAtSamples: number;
  postVerificationSamples: number;
  sawSpeech: boolean;
  vadCompleted: boolean;
  localVerified: boolean;
  verificationRunning: boolean;
  inputEnded: boolean;
  timer: ReturnType<typeof setTimeout>;
};

export type CompletedVoiceTurn = {
  readonly userId: string;
  readonly pcm16k: Float32Array;
  readonly activatedAtMs: number;
};

export type VoiceAudioLifecycleOptions = {
  readonly models: LocalVoiceModels;
  readonly preRollMs: number;
  readonly maxUtteranceMs: number;
  readonly provisionalMs?: number;
  readonly postVerificationMs?: number;
  readonly onCandidate?: (evidence: WakeCandidateEvidence) => void;
  /** Called only after the phrase-specific verifier accepts the candidate. */
  readonly onWake?: () => void;
  readonly onLocalVerification?: (
    evidence: LocalWakeVerificationEvidence,
  ) => void;
  readonly onLocalVerificationError?: (error: unknown) => void;
  readonly onAbandoned?: (reason: "timeout" | "empty" | "closed") => void;
  readonly onTurn: (turn: CompletedVoiceTurn) => Promise<void>;
  readonly now?: () => number;
  readonly createDecoder?: () => Pick<DiscordOpusDecoder, "decode" | "close">;
};

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
  private readonly speakers = new Map<string, SpeakerState>();
  private pending: PendingTurn | null = null;
  private transactionRunning = false;
  private closed = false;

  constructor(options: VoiceAudioLifecycleOptions) {
    this.options = options;
  }

  accept(audio: ReceivedVoiceAudio): void {
    if (this.closed || this.transactionRunning) {
      audio.opus.fill(0);
      return;
    }
    if (this.pending !== null && this.pending.userId !== audio.userId) {
      audio.opus.fill(0);
      return;
    }
    const speaker = this.speaker(audio.userId);
    let decoded: Float32Array;
    try {
      decoded = speaker.decoder.decode(audio.opus);
    } finally {
      audio.opus.fill(0);
    }
    if (decoded.length === 0) return;
    const samples = Float32Array.from(decoded);
    decoded.fill(0);
    if (this.pending === null) {
      this.pushRolling(speaker, samples);
      const match = speaker.keyword.accept(samples);
      if (match !== null) this.provision(audio.userId, speaker, match);
      return;
    }
    this.acceptPending(samples);
  }

  /** Finalize a bounded non-Discord input source such as the local microphone probe. */
  finishInput(): void {
    if (this.closed || this.transactionRunning || this.pending === null) return;
    this.pending.inputEnded = true;
    const missingProvisionalSamples =
      this.provisionalSamples() - this.pending.postCandidateSamples;
    if (missingProvisionalSamples > 0) {
      this.acceptPending(new Float32Array(missingProvisionalSamples));
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
      this.discardPending(this.pending);
      this.options.onAbandoned?.("closed");
    }
    this.clearSpeakers();
  }

  private speaker(userId: string): SpeakerState {
    const existing = this.speakers.get(userId);
    if (existing !== undefined) return existing;
    const created: SpeakerState = {
      decoder: this.options.createDecoder?.() ?? new DiscordOpusDecoder(),
      keyword: this.options.models.createKeywordDetector(),
      rolling: [],
      rollingSamples: 0,
    };
    this.speakers.set(userId, created);
    return created;
  }

  private pushRolling(speaker: SpeakerState, samples: Float32Array): void {
    speaker.rolling.push(samples);
    speaker.rollingSamples += samples.length;
    const maximum = Math.ceil((this.options.preRollMs / 1000) * SAMPLE_RATE);
    while (speaker.rollingSamples > maximum && speaker.rolling.length > 1) {
      const removed = speaker.rolling.shift();
      if (removed !== undefined) {
        speaker.rollingSamples -= removed.length;
        removed.fill(0);
      }
    }
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
    const vad = this.options.models.createVad();
    const pcm = speaker.rolling;
    const sampleCount = speaker.rollingSamples;
    const candidateBoundary = pcm.at(-1);
    if (candidateBoundary !== undefined) vad.accept(candidateBoundary);
    const sawSpeech = vad.isSpeechActive();
    const vadCompleted = sawSpeech && vad.hasCompletedSpeech();
    speaker.rolling = [];
    speaker.rollingSamples = 0;
    const timer = setTimeout(() => {
      const pending = this.pending;
      if (pending !== null) this.finishPending(pending, "timeout");
    }, this.options.maxUtteranceMs);
    this.pending = {
      userId,
      candidate,
      vad,
      pcm,
      sampleCount,
      postCandidateSamples: 0,
      verificationStartedAtSamples: 0,
      postVerificationSamples: 0,
      sawSpeech,
      vadCompleted,
      localVerified: false,
      verificationRunning: false,
      inputEnded: false,
      timer,
    };
    for (const [otherUserId, state] of this.speakers) {
      if (otherUserId !== userId) {
        this.clearSpeaker(state);
        this.speakers.delete(otherUserId);
      }
    }
  }

  private acceptPending(samples: Float32Array): void {
    const pending = this.pending;
    if (pending === null) {
      samples.fill(0);
      return;
    }
    pending.pcm.push(samples);
    pending.sampleCount += samples.length;
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
    const provisionalSamples = this.provisionalSamples();
    if (
      !pending.localVerified &&
      !pending.verificationRunning &&
      pending.postCandidateSamples >= provisionalSamples
    ) {
      this.startVerification(pending);
    }
    this.maybeFinish(pending, "vad");
  }

  private provisionalSamples(): number {
    return Math.ceil(
      ((this.options.provisionalMs ?? DEFAULT_PROVISIONAL_MS) / 1000) *
        SAMPLE_RATE,
    );
  }

  private startVerification(pending: PendingTurn): void {
    if (this.pending !== pending || pending.verificationRunning) return;
    pending.verificationRunning = true;
    pending.verificationStartedAtSamples = pending.postCandidateSamples;
    const verificationAudio = concatSamples(pending.pcm, pending.sampleCount);
    const startedAtMs = this.options.now?.() ?? Date.now();
    void this.verify(pending, verificationAudio, startedAtMs);
  }

  private async verify(
    pending: PendingTurn,
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
      if (!result.accepted) {
        this.discardPending(pending);
        this.clearSpeakers();
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
        this.discardPending(pending);
        this.clearSpeakers();
      }
    } finally {
      verificationAudio.fill(0);
    }
  }

  private maybeFinish(
    pending: PendingTurn,
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
    pending: PendingTurn,
    reason: "vad" | "timeout" | "input-ended",
  ): void {
    if (this.pending !== pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.vad.flush();
    pending.vad.close();
    if (!pending.localVerified || !pending.sawSpeech) {
      clearParts(pending.pcm);
      this.options.onAbandoned?.(reason === "timeout" ? "timeout" : "empty");
      this.clearSpeakers();
      return;
    }
    const pcm16k = concatSamples(pending.pcm, pending.sampleCount);
    clearParts(pending.pcm);
    const turn: CompletedVoiceTurn = {
      userId: pending.userId,
      pcm16k,
      activatedAtMs: pending.candidate.detectedAtMs,
    };
    this.transactionRunning = true;
    this.clearSpeakers();
    void this.deliver(turn);
  }

  private async deliver(turn: CompletedVoiceTurn): Promise<void> {
    try {
      await this.options.onTurn(turn);
    } finally {
      turn.pcm16k.fill(0);
      this.transactionRunning = false;
      if (!this.closed) this.clearSpeakers();
    }
  }

  private discardPending(pending: PendingTurn): void {
    if (this.pending === pending) this.pending = null;
    clearTimeout(pending.timer);
    pending.vad.close();
    clearParts(pending.pcm);
  }

  private clearSpeaker(speaker: SpeakerState): void {
    speaker.decoder.close();
    speaker.keyword.close();
    clearParts(speaker.rolling);
    speaker.rollingSamples = 0;
  }

  private clearSpeakers(): void {
    for (const speaker of this.speakers.values()) this.clearSpeaker(speaker);
    this.speakers.clear();
  }
}
