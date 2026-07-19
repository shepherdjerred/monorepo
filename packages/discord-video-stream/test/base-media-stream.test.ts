import { describe, expect, test } from "bun:test";
import { BaseMediaStream } from "../src/media/BaseMediaStream.ts";
import type { SendStats, StreamObserver } from "../src/media/StreamObserver.ts";

/**
 * Focused pacer tests for the 2026-07-18 stutter fix: the A/V ahead-correction must wait only the
 * precise excess beyond tolerance (not whole-frametime quanta) and report its pacing telemetry
 * (behindMs / syncWaitMs / syncEvent) through the observer seam.
 */

class TestStream extends BaseMediaStream {
  sent: number[] = [];
  protected override async _sendFrame(
    _frame: Buffer,
    _frametime: number,
  ): Promise<void> {
    this.sent.push(performance.now());
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
    const stream = new TestStream("video", true, observer);
    await writeFrame(stream, 0);
    await writeFrame(stream, 100 / 3);
    expect(stats).toHaveLength(2);
    for (const s of stats) {
      expect(s.behindMs).toBeLessThan(5);
      expect(s.syncWaitMs).toBe(0);
      expect(s.syncEvent).toBeUndefined();
    }
    stream.destroy();
  });

  test("ahead correction waits only the excess beyond tolerance and reports it", async () => {
    const { stats, observer } = collectStats();
    const video = new TestStream("video", false, observer);
    const audio = new TestStream("audio", true);
    video.syncStream = audio;
    video.syncTolerance = 60;

    // Anchor both streams.
    await writeFrame(audio, 0);
    await writeFrame(video, 0);

    // Video jumps 150 ms ahead of audio (delta 150 > tolerance 60 → ahead branch, excess 90 ms).
    // Advance audio past the tolerance boundary while video waits so the loop can exit.
    const audioAdvance = (async () => {
      await Bun.sleep(40);
      await writeFrame(audio, 120); // delta becomes 30 < 60 → video may proceed
    })();
    const start = performance.now();
    await writeFrame(video, 150);
    const waited = performance.now() - start;
    await audioAdvance;

    const videoStats = stats.filter((s) => s.kind === "video");
    const aheadStat = videoStats.find((s) => s.syncEvent === "ahead");
    if (!aheadStat) throw new Error("expected an ahead sync event");
    expect(aheadStat.syncWaitMs).toBeGreaterThan(0);
    // The old implementation slept whole 33ms frametimes past the boundary and could not exit
    // before the partner advanced by a full quantum; the precise wait must complete well under
    // the excess (90 ms) plus one frametime of slop.
    expect(waited).toBeLessThan(150);
    video.destroy();
    audio.destroy();
  });
});
