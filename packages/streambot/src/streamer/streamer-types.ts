import type { createSeekablePlayer } from "@shepherdjerred/discord-video-stream";
import type { joinStreamerVoice } from "@shepherdjerred/streambot/streamer/join-voice.ts";
import type { ReceivedVoiceAudio } from "@shepherdjerred/discord-video-stream";
import type { VoiceReceiveObserver } from "@shepherdjerred/discord-video-stream";
import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot";
import type {
  JoinVoiceInput,
  LeaveVoiceInput,
  RunStreamInput,
  VoiceHandle,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { StallInfo } from "@shepherdjerred/streambot/streamer/stream-errors.ts";
import type {
  VoiceCloseInfo,
  VoiceCloseSource,
} from "@shepherdjerred/streambot/streamer/voice-close-source.ts";
import type { createStreamObserver } from "@shepherdjerred/streambot/observability/stream-observer.ts";
import type { AssistantAudioPort } from "@shepherdjerred/streambot/streamer/audio-ports.ts";

/** Factory for the seekable player — injectable so tests can drive playback without a live stream. */
export type PlayerFactory = typeof createSeekablePlayer;

/** Factory for one segment's observer — injectable so tests can fire lifecycle events exactly. */
export type StreamObserverFactory = typeof createStreamObserver;

/** Optional lifecycle seams used by deterministic streamer tests. */
export type StreamerDependencies = {
  createPlayer?: PlayerFactory;
  createObserver?: StreamObserverFactory;
  /** Test seam for the voice-join boundary, where `receiveAudio` mirrors `voice.enabled`. */
  joinStreamerVoice?: typeof joinStreamerVoice;
};

/**
 * The streamer surface the pool/session layer depends on. Extends `PooledUserbot` (the
 * shared lib's minimum) with Streambot's video-streaming methods.
 */
export type StreamerLike = PooledUserbot & {
  joinVoice: (
    input: JoinVoiceInput,
    signal: AbortSignal,
  ) => Promise<VoiceHandle>;
  runStream: (input: RunStreamInput, signal: AbortSignal) => Promise<void>;
  leaveVoice: (input: LeaveVoiceInput, signal: AbortSignal) => Promise<void>;
  /**
   * Apply a playback volume percentage. True when it reached live audio, which is the case for a
   * music segment (the mixer scales the samples) and never for Go Live, whose gain is fixed for
   * the duration of a segment by the `audioVolume` its ffmpeg command was built with.
   */
  setVolume: (percent: number) => Promise<boolean>;
  /**
   * Open the voice assistant's write access to the outbound audio track.
   *
   * This replaced a `sendAssistantOpus` + `setAssistantSpeaking` pair, and the replacement is a
   * NARROWING on purpose. Those two methods let the assistant write Opus straight at the same
   * packetizer, timestamp and SSRC the music pipeline uses, and two Opus streams interleaved on one
   * SSRC is not a mix — it is noise. A port cannot be a second writer: everything behind it goes
   * through the one mixer that owns the connection, which is also what lets the speaking flag be
   * arbitrated between the two sources instead of being clobbered by whichever finished last.
   */
  openAssistantAudio: () => AssistantAudioPort;
  /**
   * The two methods `@shepherdjerred/voice-assistant` calls through its own
   * `AssistantAudioTransport` port. They are an adapter over {@link openAssistantAudio}, not a
   * second way in: both delegate to one long-lived mixer port, so the narrowing above still holds
   * and nothing outside the mixer touches the connection. They exist because the shared voice
   * pipeline is consumed by two bots and owns that interface.
   */
  setAssistantSpeaking: (speaking: boolean) => Promise<void>;
  sendAssistantOpus: (opus: Uint8Array) => void;
  /** Read-only identity used to attribute live assistant reply packets. */
  assistantUserId: () => string;
  /** True only once the normal voice connection's DAVE media session is ready. */
  assistantDaveReady: () => boolean;
  /** Receive identified, DAVE-decrypted Discord Opus packets for local activation. */
  setVoiceAudioListener: (
    listener: ((audio: ReceivedVoiceAudio) => void) | null,
  ) => void;
  /** Receive-path metrics/log hooks applied to the active transport and the next join. */
  setVoiceReceiveObserver: (observer: VoiceReceiveObserver | null) => void;
  seek: (seconds: number) => Promise<boolean>;
  getPosition: () => number | null;
  /** Most recent Discord-side voice ws close observed on this userbot, or null if none yet. */
  lastVoiceCloseInfo: () => VoiceCloseInfo | null;
  /** Retain the current connection's close state for one delayed recovery incident. */
  captureVoiceCloseSource: () => VoiceCloseSource;
  /**
   * Register the callback fired when Discord closes the voice connection out from under us.
   * Locally initiated stops never fire it. Pass null to clear.
   */
  setVoiceCloseListener: (
    listener: ((info: VoiceCloseInfo) => void) | null,
  ) => void;
  /** Register the callback fired when active ffmpeg output stalls. Pass null to clear. */
  setStallListener: (listener: ((info: StallInfo) => void) | null) => void;
};
