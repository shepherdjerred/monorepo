import { describe, expect, test } from "bun:test";
import { BaseMediaStream } from "../src/media/BaseMediaStream.ts";
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
