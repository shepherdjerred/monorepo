import { describe, expect, it } from "bun:test";
import {
  buildCalibrationReport,
  detectAudioPulseTimes,
  detectVideoPulseTimes,
  generateCalibrationPcm,
  isCalibrationVideoPulse,
} from "./stream-calibration.ts";

describe("stream calibration marker detection", () => {
  it("detects grouped video flashes at frame precision", () => {
    const frames = [
      ...Array.from({ length: 10 }, () => 10),
      240,
      240,
      240,
      ...Array.from({ length: 16 }, () => 10),
      240,
      240,
    ];
    const decoded = Uint8Array.from(
      frames.flatMap((value) => [value, value, value, value]),
    );
    expect(
      detectVideoPulseTimes({
        grayscale: decoded,
        frameBytes: 4,
        frameRate: 10,
        brightnessThreshold: 180,
      }),
    ).toEqual([1000, 2900]);
  });

  it("detects generated audio sweeps and an injected delay", () => {
    const pcm = generateCalibrationPcm({
      durationMs: 1000,
      pulseTimesMs: [200, 600],
      audioDelayMs: 50,
    });
    const mono = Buffer.alloc(pcm.byteLength / 2);
    for (let source = 0, target = 0; source < pcm.byteLength; source += 4) {
      mono.writeInt16LE(pcm.readInt16LE(source), target);
      target += 2;
    }
    const detected = detectAudioPulseTimes({
      monoS16le: mono,
      sampleRate: 44_100,
      rmsThreshold: 2000,
    });
    expect(detected).toHaveLength(2);
    expect(detected[0]).toBeCloseTo(250, -1);
    expect(detected[1]).toBeCloseTo(650, -1);
  });

  it("selects a three-frame pulse with an intentional video delay", () => {
    const selected = Array.from({ length: 40 }, (_, frameIndex) =>
      isCalibrationVideoPulse({
        frameIndex,
        frameRate: 10,
        pulseTimesMs: [1000],
        videoDelayFrames: 2,
      }),
    );
    expect(
      selected
        .map((active, index) => (active ? index : -1))
        .filter((index) => index >= 0),
    ).toEqual([12, 13, 14]);
  });

  it("reports positive A/V offset when audio lags video", () => {
    const report = buildCalibrationReport({
      sourceTimesMs: [1000, 2000, 3000],
      videoTimesMs: [1000, 2000, 3000],
      audioTimesMs: [1100, 2100, 3100],
    });
    expect(report.avOffset.p50Ms).toBe(100);
    expect(report.avOffset.p95Ms).toBe(100);
    expect(report.avOffset.maxAbsMs).toBe(100);
  });

  it("fails when a marker is missing", () => {
    expect(() =>
      buildCalibrationReport({
        sourceTimesMs: [1000, 2000],
        videoTimesMs: [1000],
        audioTimesMs: [1000, 2000],
      }),
    ).toThrow("marker detection mismatch");
  });
});
