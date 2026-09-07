import { computeElapsed } from "@shepherdjerred/streambot/streamer/elapsed.ts";

/**
 * Where playback has reached, and who owns that answer while a seek is in flight.
 *
 * Split out of the streamer because it is a self-contained state machine with four independent
 * writers — segment start, playback attach, live seek, and segment end — and every one of them can
 * race the others: a pooled userbot can begin a new session while a superseded seek's replacement
 * pipeline is still attaching, and the observer that reads the offset can start synchronously
 * inside `player.seek()`. The rules that keep those from corrupting each other belong in one place.
 *
 * Unlike the fork's `Player.position`, which is the offset ffmpeg was started at, this advances with
 * the wall clock, which is what makes it usable as a resume checkpoint.
 */
export class SegmentClock {
  /** Offset (seconds) the current segment started playing at (initial resume seek or last seek). */
  private startOffsetSeconds = 0;
  /** Wall-clock (ms) when the current segment began playing; null when nothing is playing. */
  private startedAtMs: number | null = null;
  /**
   * Seek target visible to the synchronously-starting observer before the replacement attach
   * succeeds. Public position tracking continues from the prior anchor until the seek commits.
   */
  private pendingOffsetSeconds: number | null = null;
  /** Last delivered public position, frozen while a replacement seek pipeline attaches. */
  private pendingPreviousPositionSeconds: number | null = null;
  /** Monotonic owner for overlapping seek completions; only the newest request may update anchors. */
  private generation = 0;

  constructor(private readonly now: () => number) {}

  /**
   * The offset stall accounting resumes from: the in-flight seek target when one is pending, so a
   * stall detected during a seek resumes at where the user asked to be, not where they were.
   */
  get stallOffsetSeconds(): number {
    return this.pendingOffsetSeconds ?? this.startOffsetSeconds;
  }

  /** Current playback position in seconds, or null when nothing is playing. */
  position(): number | null {
    if (this.pendingPreviousPositionSeconds !== null) {
      return this.pendingPreviousPositionSeconds;
    }
    if (this.startedAtMs === null) {
      return null;
    }
    return computeElapsed(
      this.startOffsetSeconds,
      this.startedAtMs,
      this.now(),
    );
  }

  /**
   * Expose a segment's requested media offset without starting the clock. The observer can begin a
   * progress epoch synchronously during player construction, so the offset has to be visible first;
   * the public checkpoint time must not advance until playback is genuinely attached.
   */
  beginSegment(startSeconds: number): void {
    this.startOffsetSeconds = startSeconds;
    this.startedAtMs = null;
  }

  /** Playback attached successfully: start the public elapsed clock. */
  markPlaying(): void {
    this.startedAtMs = this.now();
  }

  /** Nothing is playing any more; `position()` returns null until the next segment attaches. */
  stopClock(): void {
    this.startedAtMs = null;
  }

  /** Revoke ownership from every in-flight seek and clear its shared public-position state. */
  invalidate(): void {
    this.generation += 1;
    this.pendingOffsetSeconds = null;
    this.pendingPreviousPositionSeconds = null;
  }

  /** Open a seek. The returned token is what {@link owns} checks before any anchor is moved. */
  beginSeek(target: number, previousPositionSeconds: number | null): number {
    this.generation += 1;
    this.pendingOffsetSeconds = target;
    this.pendingPreviousPositionSeconds = previousPositionSeconds;
    return this.generation;
  }

  /** Whether `generation` is still the newest seek request. */
  owns(generation: number): boolean {
    return this.generation === generation;
  }

  /** The replacement pipeline attached: adopt the seek target as the new anchor. */
  commitSeek(target: number): void {
    this.startOffsetSeconds = target;
    this.startedAtMs = this.now();
    this.pendingOffsetSeconds = null;
    this.pendingPreviousPositionSeconds = null;
  }

  /**
   * The replacement attach failed. Resume the clock from where playback was, unless the caller has
   * no previous position — a replacement attach failure also rejects `player.finished`, and if the
   * playback owner won that race it has already stopped the clock for dead media, which must not be
   * restarted while the machine prepares recovery.
   */
  abortSeek(previousPositionSeconds: number | null): void {
    this.pendingOffsetSeconds = null;
    this.pendingPreviousPositionSeconds = null;
    if (previousPositionSeconds === null) return;
    this.startOffsetSeconds = previousPositionSeconds;
    this.startedAtMs = this.now();
  }
}
