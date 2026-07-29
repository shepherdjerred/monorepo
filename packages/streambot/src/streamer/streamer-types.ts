import type { createSeekablePlayer } from "@shepherdjerred/discord-video-stream";
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

/** Factory for the seekable player — injectable so tests can drive playback without a live stream. */
export type PlayerFactory = typeof createSeekablePlayer;

/** Factory for one segment's observer — injectable so tests can fire lifecycle events exactly. */
export type StreamObserverFactory = typeof createStreamObserver;

/** Optional lifecycle seams used by deterministic streamer tests. */
export type StreamerDependencies = {
  createPlayer?: PlayerFactory;
  createObserver?: StreamObserverFactory;
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
  setVolume: (percent: number) => Promise<boolean>;
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
