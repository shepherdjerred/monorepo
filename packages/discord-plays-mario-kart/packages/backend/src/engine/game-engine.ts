// What a session needs from the game runtime: the native SpaghettiKart port in
// a child process (SpaghettiEngine). Tests and the web dispatch use the
// interface rather than the class.
import type { PlayerInputState } from "@discord-plays-mario-kart/common";
import type { Mk64Snapshot } from "#src/emulator/mk64-state.ts";
import type { FrameFormat } from "./format.ts";

/** Why a session asked for a restart (a metric label). */
export type EngineRestartReason = "stream_session_ended";

export type EngineFrame = {
  /**
   * The frame's pixels, BGRA despite the name (see FrameFormat). The consumer
   * owns the buffer: overlays draw into it and both encoders may retain it.
   */
  rgba: Buffer;
  height: number;
  seatActivity: boolean[];
  /** Game time of the frame, from 0 at start(), on the audio's timeline. */
  contentTimeMs: number;
  /**
   * Receipt time (epoch ms) of the earliest controller input this frame is the
   * first to reflect; see InputLatencyTracker.
   */
  inputReceivedAtMs?: number;
};

/** A screenshot frame: RGBA, unlike EngineFrame. */
export type EngineScreenshot = { rgba: Buffer; width: number; height: number };

export type GameEngine = {
  readonly format: FrameFormat;
  /** Seat-activity flags of the most recent frame. */
  readonly latestSeatActivity: readonly boolean[];
  /** Boot the game, paused. Rejects (and cleans up) if it cannot boot. */
  init: () => Promise<void>;
  /** Start running in real time; frames and audio flow from here. */
  start: () => void;
  stop: () => Promise<void>;
  /** Soft-reset back to the title screen, keeping the process. */
  restartFromStartMenu: (reason: EngineRestartReason) => void;
  setPlayerInput: (seat: number, state: PlayerInputState) => void;
  clearPlayerInput: (seat: number) => void;
  /** A clean (overlay-free) copy of the current picture. */
  renderFrame: () => Promise<EngineScreenshot>;
  onFrame: (cb: (frame: EngineFrame) => void) => void;
  onAudio: (cb: (pcm: Buffer, contentEndMs: number) => void) => void;
  /** Decoded race state, every snapshotEveryNFrames game frames. */
  onSnapshot: (cb: (snapshot: Mk64Snapshot) => void) => void;
};
