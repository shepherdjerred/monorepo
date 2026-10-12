// Pairs each raw frame handed to the driver-feed ffmpeg with the access unit it
// becomes, so the feed's server-side leg has its own latency histograms.
//
// The pairing is a plain FIFO because the encoder is configured for exactly one
// access unit per input frame, in order: `-bf 0` (no reordering), a constant
// input and output frame rate (no duplication or dropping), and a 1:1 pipe. The
// sink only reports frames it actually handed to ffmpeg, so evicted frames never
// enter the queue.
//
// Timestamps share the InputLatencyTracker clock (`performance.timeOrigin +
// performance.now()`), so an input receipt stamped on the main thread is
// comparable to the access-unit time taken here.

export type DriverFeedFrameTiming = {
  /** When the frame was handed to the driver feed (absolute high-res ms). */
  readonly pushedAtMs: number;
  /** Receipt time of the earliest input this frame is the first to reflect. */
  readonly inputReceivedAtMs?: number;
};

export type DriverFeedLatencyObservations = {
  readonly frameToUnit: (delayMs: number) => void;
  readonly inputToUnit: (delayMs: number) => void;
  /** The FIFO outgrew any honest encoder backlog and was discarded. */
  readonly correlationFailure: () => void;
};

/**
 * An honest backlog is a frame or two in ffmpeg plus at most one in the pipe.
 * Anything this deep means the 1:1 assumption broke (e.g. ffmpeg dropped
 * frames), and every later pairing would be wrong, so the queue resets.
 */
export const MAX_PENDING_FRAMES = 30;

export class DriverFeedLatencyTracker {
  private readonly observations: DriverFeedLatencyObservations;
  private readonly now: () => number;
  private readonly pending: DriverFeedFrameTiming[] = [];

  constructor(
    observations: DriverFeedLatencyObservations,
    now: () => number = () => performance.timeOrigin + performance.now(),
  ) {
    this.observations = observations;
    this.now = now;
  }

  get pendingFrames(): number {
    return this.pending.length;
  }

  /** A frame entered ffmpeg's stdin. */
  frameDelivered(timing: DriverFeedFrameTiming): void {
    this.pending.push(timing);
    if (this.pending.length > MAX_PENDING_FRAMES) {
      this.pending.length = 0;
      this.observations.correlationFailure();
    }
  }

  /** ffmpeg produced the next access unit. */
  unitReady(): void {
    const timing = this.pending.shift();
    // Output with no recorded input happens only right after a reset; there is
    // nothing honest to pair it with.
    if (timing === undefined) return;
    const t = this.now();
    this.observations.frameToUnit(t - timing.pushedAtMs);
    if (timing.inputReceivedAtMs !== undefined) {
      this.observations.inputToUnit(t - timing.inputReceivedAtMs);
    }
  }
}
