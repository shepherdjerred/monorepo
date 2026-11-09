import { describe, expect, test } from "vitest";
import { BaseMediaStream } from "../src/media/BaseMediaStream.ts";
import { LiveScheduleGate } from "../src/media/LiveScheduleGate.ts";
import type { SendStats, StreamObserver } from "../src/media/StreamObserver.ts";

/**
 * Focused pacer tests for the 2026-07-18 stutter fix: the A/V ahead-correction must wait only the
 * precise excess beyond tolerance (not whole-frametime quanta) and report its pacing telemetry
 * (behindMs / syncWaitMs / syncEvent) through the observer seam.
 */

class ManualClock {
  private time = 0;

  now(): number {
    return this.time;
  }

  advance(milliseconds: number): void {
    this.time += milliseconds;
  }
}

class TestStream extends BaseMediaStream {
  private readonly clock: ManualClock | undefined;
  onWait: ((milliseconds: number) => Promise<void>) | undefined;
  waits: number[] = [];

  constructor(
    type: SendStats["kind"],
    noSleep = false,
    observer?: StreamObserver,
    clock?: ManualClock,
  ) {
    super(type, noSleep, observer);
    this.clock = clock;
  }

  protected override _sendFrame(
    _frame: Buffer,
    _frametime: number,
  ): Promise<void> {
    return Promise.resolve();
  }

  protected override now(): number {
    return this.clock?.now() ?? super.now();
  }

  protected override wait(milliseconds: number): Promise<void> {
    if (!this.clock) return super.wait(milliseconds);
    this.waits.push(milliseconds);
    this.clock.advance(milliseconds);
    return this.onWait?.(milliseconds) ?? Promise.resolve();
  }
}

/**
 * Minimal structural Packet (33.33ms frames in a 1/1000 timebase). `_write` only touches these
 * five fields; objectMode `Writable.write` accepts unknown chunks, so no assertion is needed.
 */
function fakePacket(ptsMs: number, durationMs = 100 / 3) {
  return {
    data: new Uint8Array([1, 2, 3]),
    pts: BigInt(Math.round(ptsMs)),
    duration: BigInt(Math.round(durationMs)),
    timeBase: { num: 1, den: 1000 },
    free: () => {},
  };
}

function writeFrame(stream: TestStream, ptsMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(fakePacket(ptsMs), (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

function collectStats(): { stats: SendStats[]; observer: StreamObserver } {
  const stats: SendStats[] = [];
  return { stats, observer: { onSendStats: (s) => stats.push(s) } };
}

describe("BaseMediaStream pacing telemetry", () => {
  test("reports behindMs=0 and no syncEvent for an on-schedule unsynced stream", async () => {
    const { stats, observer } = collectStats();
    const clock = new ManualClock();
    const stream = new TestStream("video", true, observer, clock);
    await writeFrame(stream, 0);
    clock.advance(33);
    await writeFrame(stream, 100 / 3);
    expect(stats).toHaveLength(2);
    for (const s of stats) {
      expect(s.ptsMs).toBeGreaterThanOrEqual(0);
      expect(s.behindMs).toBe(0);
      expect(s.syncWaitMs).toBe(0);
      expect(s.syncEvent).toBeUndefined();
    }
    stream.destroy();
  });

  test("ahead correction waits only the excess beyond tolerance and reports it", async () => {
    const { stats, observer } = collectStats();
    const clock = new ManualClock();
    const video = new TestStream("video", false, observer, clock);
    const audio = new TestStream("audio", true, undefined, clock);
    video.syncStream = audio;
    video.syncTolerance = 60;

    // Anchor both streams.
    await writeFrame(audio, 0);
    await writeFrame(video, 0);
    video.waits.length = 0;

    // Video jumps 70 ms ahead of audio. The excess beyond the 60 ms tolerance
    // is exactly 10 ms, less than one 33 ms frame. Move audio forward during
    // that wait so the correction exits after one precise sleep.
    video.onWait = async () => {
      await writeFrame(audio, 20);
    };
    await writeFrame(video, 70);

    const videoStats = stats.filter((s) => s.kind === "video");
    const aheadStat = videoStats.find((s) => s.syncEvent === "ahead");
    if (!aheadStat) throw new Error("expected an ahead sync event");
    expect(video.waits).toEqual([10]);
    expect(aheadStat.syncWaitMs).toBe(10);
    video.destroy();
    audio.destroy();
  });
});

/**
 * Live input (2026-11-08 Worlds stutter): a Twitch HLS source never runs ahead of realtime, so a
 * pacer that fell behind its anchor stayed behind for the rest of the stream and forwarded every
 * 2 s segment as a burst. A live gate re-anchors the schedule and rebuilds a cushion instead.
 */
describe("BaseMediaStream live schedule gate", () => {
  const FRAME_MS = 100 / 3;

  function liveStream(gate: LiveScheduleGate) {
    const { stats, observer } = collectStats();
    const clock = new ManualClock();
    const stream = new TestStream("video", false, observer, clock);
    stream.liveGate = gate;
    return { stats, clock, stream };
  }

  test("a starved late frame opens one hold, then pacing resumes from a fresh anchor", async () => {
    const { stats, clock, stream } = liveStream(new LiveScheduleGate(4000));
    await writeFrame(stream, 0);
    await writeFrame(stream, FRAME_MS);
    // The next segment arrives a second late: the pacer sat idle for all of it.
    clock.advance(1000);
    stream.waits.length = 0;
    await writeFrame(stream, 2 * FRAME_MS);
    expect(stats.at(-1)?.liveEvent).toBe("rebuffer");
    // The late frame itself goes out at once; the hold applies before the next one.
    expect(stream.waits).toEqual([]);

    await writeFrame(stream, 3 * FRAME_MS);
    const resumed = stats.at(-1);
    expect(resumed?.liveHoldMs).toBe(4000);
    expect(resumed?.behindMs).toBe(0);
    expect(resumed?.liveEvent).toBeUndefined();
    // Waited out the hold, then slept one frame on the new schedule rather than skipping sleeps.
    expect(stream.waits).toEqual([4000, 33]);
    stream.destroy();
  });

  test("lateness with the next frames already queued re-anchors without a hold", async () => {
    const { stats, clock, stream } = liveStream(new LiveScheduleGate(4000));
    await writeFrame(stream, 0);
    stream.onWait = async () => {
      // A slow send or GC pause: the clock jumps while this stream was busy, not idle.
      clock.advance(500);
    };
    await writeFrame(stream, FRAME_MS);
    stream.onWait = undefined;
    stream.waits.length = 0;
    await writeFrame(stream, 2 * FRAME_MS);
    expect(stats.at(-1)?.liveEvent).toBe("reanchor");
    await writeFrame(stream, 3 * FRAME_MS);
    expect(stats.at(-1)?.liveHoldMs).toBeUndefined();
    expect(stream.waits).toEqual([33]);
    stream.destroy();
  });

  test("a forward timestamp jump past the cushion re-anchors instead of freezing for the gap", async () => {
    const { stats, stream } = liveStream(new LiveScheduleGate(4000));
    await writeFrame(stream, 0);
    stream.waits.length = 0;
    // Segments expired from the live playlist: the next frame is 10 s ahead on the media clock.
    await writeFrame(stream, 10_000);
    expect(stats.at(-1)?.liveEvent).toBe("reanchor");
    expect(stream.waits).toEqual([]);
    stream.destroy();
  });

  test("streams that starve together share one hold and resume from it together", async () => {
    const gate = new LiveScheduleGate(3000);
    const { stats, observer } = collectStats();
    const clock = new ManualClock();
    const video = new TestStream("video", false, observer, clock);
    const audio = new TestStream("audio", false, observer, clock);
    video.liveGate = gate;
    audio.liveGate = gate;
    await writeFrame(audio, 0);
    await writeFrame(video, 0);
    clock.advance(1000);
    await writeFrame(audio, 20);
    const holdOpenedAt = clock.now();
    expect(stats.at(-1)).toMatchObject({ kind: "audio", liveEvent: "rebuffer" });
    // Video starved too, but the hold audio opened covers it: video waits it out, re-anchors, and
    // reports no event of its own.
    await writeFrame(video, FRAME_MS);
    const resumed = stats.at(-1);
    expect(resumed).toMatchObject({ kind: "video", liveHoldMs: 3000, behindMs: 0 });
    expect(resumed?.liveEvent).toBeUndefined();
    expect(clock.now()).toBeGreaterThanOrEqual(holdOpenedAt + 3000);
    video.destroy();
    audio.destroy();
  });

  test("a second starved stream joins a running hold instead of extending it", () => {
    const gate = new LiveScheduleGate(3000);
    expect(gate.hold(0)).toBe(true);
    expect(gate.hold(100)).toBe(false);
    expect(gate.remaining(100)).toBe(2900);
    expect(gate.remaining(3000)).toBe(0);
    expect(gate.hold(3000)).toBe(true);
  });

  test("without a gate a starved stream keeps skipping sleeps (seekable catch-up is unchanged)", async () => {
    const { stats, observer } = collectStats();
    const clock = new ManualClock();
    const stream = new TestStream("video", false, observer, clock);
    await writeFrame(stream, 0);
    clock.advance(1000);
    await writeFrame(stream, FRAME_MS);
    stream.waits.length = 0;
    await writeFrame(stream, 2 * FRAME_MS);
    expect(stats.at(-1)?.liveEvent).toBeUndefined();
    expect(stats.at(-1)?.behindMs).toBeGreaterThan(900);
    expect(stream.waits).toEqual([]);
    stream.destroy();
  });

  test("rejects a non-positive cushion", () => {
    expect(() => new LiveScheduleGate(0)).toThrow("positive");
  });
});
