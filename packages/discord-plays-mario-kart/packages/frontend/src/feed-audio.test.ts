import { describe, expect, it } from "vitest";
import { decodeFeedAudioPcm, scheduleFeedAudioChunk } from "./feed-audio.ts";

describe("scheduleFeedAudioChunk", () => {
  it("appends at normal speed to a playhead near the target lead", () => {
    expect(scheduleFeedAudioChunk(10.05, 10)).toEqual({
      startS: 10.05,
      playbackRate: 1,
    });
  });

  it("restarts at the target lead after an underrun", () => {
    expect(scheduleFeedAudioChunk(9.9, 10)?.startS).toBeCloseTo(10.05);
    expect(scheduleFeedAudioChunk(0, 10)?.startS).toBeCloseTo(10.05);
    expect(scheduleFeedAudioChunk(0, 10)?.playbackRate).toBe(1);
  });

  it("plays slightly fast to drain a lead above target", () => {
    expect(scheduleFeedAudioChunk(10.18, 10)).toEqual({
      startS: 10.18,
      playbackRate: 1.02,
    });
  });

  it("drops a chunk that would play too late behind a backlog", () => {
    expect(scheduleFeedAudioChunk(10.3, 10)).toBeUndefined();
  });

  it("drains a startup backlog back to the target lead", () => {
    // The clock stood still while six 33 ms chunks queued up behind it.
    const chunkS = 893 / 26_800;
    let now = 0;
    let playhead = 0.05 + 6 * chunkS;
    for (let chunk = 0; chunk < 30 * 10; chunk++) {
      const schedule = scheduleFeedAudioChunk(playhead, now);
      if (schedule === undefined) throw new Error("dropped a chunk");
      playhead = schedule.startS + chunkS / schedule.playbackRate;
      now += chunkS;
    }
    expect(playhead - now).toBeLessThan(0.075);
  });
});

describe("decodeFeedAudioPcm", () => {
  it("de-interleaves s16le stereo into float planes", () => {
    const pcm = new DataView(new ArrayBuffer(8));
    pcm.setInt16(0, 0x40_00, true); // L0
    pcm.setInt16(2, -0x80_00, true); // R0
    pcm.setInt16(4, 0, true); // L1
    pcm.setInt16(6, 0x7f_ff, true); // R1

    const [left, right] = decodeFeedAudioPcm(pcm, 2);

    expect([...(left ?? [])]).toEqual([0.5, 0]);
    expect(right?.[0]).toBe(-1);
    expect(right?.[1]).toBeCloseTo(1, 4);
  });

  it("ignores a trailing partial frame", () => {
    const pcm = new DataView(new ArrayBuffer(6));
    expect(decodeFeedAudioPcm(pcm, 2)[0]).toHaveLength(1);
  });

  it("reads a view that does not start at its buffer's beginning", () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x40, 0x00, 0x40]);
    const pcm = new DataView(bytes.buffer, 1);
    expect([...(decodeFeedAudioPcm(pcm, 2)[0] ?? [])]).toEqual([0.5]);
  });
});
