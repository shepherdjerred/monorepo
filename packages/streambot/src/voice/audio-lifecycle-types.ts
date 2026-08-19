import type { DiscordOpusDecoder } from "@shepherdjerred/discord-video-stream";
import type {
  KeywordDetectionEvidence,
  LocalVoiceModels,
  VoiceActivityDetector,
} from "@shepherdjerred/streambot/voice/local-models.ts";
import type { VoiceAttemptHandle } from "@shepherdjerred/streambot/voice/attempt-context.ts";

export type WakeCandidateEvidence = KeywordDetectionEvidence & {
  readonly userId: string;
  readonly detectedAtMs: number;
};

export type LocalWakeVerificationEvidence = {
  readonly accepted: boolean;
  readonly score: number;
  readonly latencyMs: number;
};

export type PendingVoiceTurn = {
  readonly userId: string;
  readonly candidate: WakeCandidateEvidence;
  readonly attempt: VoiceAttemptHandle;
  readonly vad: VoiceActivityDetector;
  pcm: Float32Array[];
  sampleCount: number;
  dtxSamples: number;
  postCandidateSamples: number;
  readonly verificationTargetSamples: number;
  verificationStartedAtSamples: number;
  postVerificationSamples: number;
  sawSpeech: boolean;
  vadCompleted: boolean;
  localVerified: boolean;
  verificationRunning: boolean;
  inputEnded: boolean;
  timer: ReturnType<typeof setTimeout>;
  lastPacketAtMs: number;
  stopSilenceTicker: () => void;
};

export type CompletedVoiceTurn = {
  readonly userId: string;
  readonly pcm16k: Float32Array;
  readonly activatedAtMs: number;
  readonly attempt: VoiceAttemptHandle;
};

export type VoiceAudioLifecycleOptions = {
  readonly models: LocalVoiceModels;
  readonly preRollMs: number;
  readonly maxUtteranceMs: number;
  readonly verificationDelayMs?: number;
  readonly postVerificationMs?: number;
  readonly onCandidate?: (evidence: WakeCandidateEvidence) => void;
  readonly beginAttempt?: (
    evidence: WakeCandidateEvidence,
  ) => VoiceAttemptHandle;
  readonly onWake?: () => void;
  readonly onLocalVerificationScheduled?: (settled: Promise<void>) => void;
  readonly onLocalVerification?: (
    evidence: LocalWakeVerificationEvidence,
  ) => void;
  readonly onLocalVerificationError?: (error: unknown) => void;
  readonly onDecodeError?: (error: unknown) => void;
  readonly onDecoded?: (input: {
    readonly userId: string;
    readonly pcm16k: Float32Array;
  }) => void;
  readonly onInputDrop?: (
    reason: "closed" | "transaction-running" | "other-speaker",
  ) => void;
  readonly onEndpoint?: (input: {
    readonly reason: string;
    readonly sampleCount: number;
    readonly dtxSamples: number;
    readonly sawSpeech: boolean;
  }) => void;
  readonly onAbandoned?: (reason: "timeout" | "empty" | "closed") => void;
  readonly onTurn: (turn: CompletedVoiceTurn) => Promise<void>;
  readonly now?: () => number;
  readonly createDecoder?: () => Pick<DiscordOpusDecoder, "decode" | "close">;
  readonly createSilenceTicker?: (
    onTick: () => void,
    intervalMs: number,
  ) => () => void;
  readonly dtxGapMs?: number;
  readonly dtxTickMs?: number;
};
