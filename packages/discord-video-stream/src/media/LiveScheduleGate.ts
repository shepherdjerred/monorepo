/**
 * A frame sent more than this far behind its pacing schedule on a live input means the schedule
 * no longer matches what the source can deliver. 250 ms sits above per-frame interleave jitter
 * (one video frame plus one audio frame) and below the 1 s receiver playout ceiling streambot
 * advertises, so the pacer reacts before a viewer's jitter buffer runs dry.
 */
export const LIVE_LATE_THRESHOLD_MS = 250;

/**
 * The pacer waited at least this long for the frame it is now sending late, so the lateness came
 * from the source running dry rather than from the sender (a GC pause, a slow send) while frames
 * were queued. Only a starved schedule is worth a rebuffer: waiting does not help a sender that
 * already holds the next frames.
 */
export const LIVE_STARVED_IDLE_MS = LIVE_LATE_THRESHOLD_MS / 2;

/**
 * Shared rebuffer hold for the paced streams of one live pipeline.
 *
 * A live input delivers media at realtime and cannot be read ahead, so the send pacer's normal
 * recovery from lateness — skip sleeps until the schedule is met — never succeeds there: the next
 * frame cannot arrive early to make up the deficit. Without a gate, the first upstream stall puts
 * the pacer permanently behind its anchor, and from then on every HLS segment is forwarded the
 * moment ffmpeg produces it: a burst of a whole segment, then nothing until the next one, which
 * viewers see as steady stutter.
 *
 * When a paced stream finds the source starved, it opens a hold of {@link bufferMs}. Every stream
 * on the gate waits out the hold before its next frame and then re-anchors its schedule, so audio
 * and video resume together with that much media queued behind the live edge to absorb the
 * source's ordinary delivery jitter.
 */
export class LiveScheduleGate {
  private holdUntil = Number.NEGATIVE_INFINITY;

  /** @param bufferMs Cushion to rebuild on each rebuffer; must be positive. */
  constructor(readonly bufferMs: number) {
    if (!Number.isFinite(bufferMs) || bufferMs <= 0) {
      throw new Error(
        `LiveScheduleGate bufferMs must be a positive number of milliseconds, got ${String(bufferMs)}`,
      );
    }
  }

  /**
   * Start a hold at `now`. Returns false when a hold is already running, so the streams of one
   * pipeline that starve together open one hold rather than staggered ones.
   */
  hold(now: number): boolean {
    if (now < this.holdUntil) return false;
    this.holdUntil = now + this.bufferMs;
    return true;
  }

  /** Milliseconds left in the current hold at `now`; 0 when none is running. */
  remaining(now: number): number {
    return Math.max(0, this.holdUntil - now);
  }
}
