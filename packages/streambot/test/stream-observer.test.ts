import { describe, expect, test } from "bun:test";
import {
  commandUsesHardwareDecode,
  createStreamObserver,
  parseTimemarkSeconds,
} from "@shepherdjerred/streambot/observability/stream-observer.ts";
import {
  ffmpegSpeedRatio,
  hwDecodeEngaged,
  sendLateFramesTotal,
} from "@shepherdjerred/streambot/observability/metrics.ts";

describe("parseTimemarkSeconds", () => {
  test("parses HH:MM:SS.ss", () => {
    expect(parseTimemarkSeconds("00:00:00.00")).toBe(0);
    expect(parseTimemarkSeconds("01:02:03.50")).toBeCloseTo(3723.5, 3);
    expect(parseTimemarkSeconds("-00:00:01.00")).toBe(-1);
  });
  test("returns undefined for junk", () => {
    expect(parseTimemarkSeconds()).toBeUndefined();
    expect(parseTimemarkSeconds("nope")).toBeUndefined();
    expect(parseTimemarkSeconds("1:2")).toBeUndefined();
  });
});

describe("commandUsesHardwareDecode", () => {
  test("detects the VAAPI decode flags / scale filter", () => {
    expect(
      commandUsesHardwareDecode(
        "ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.mkv -vf scale_vaapi=w=1920:h=1080 out",
      ),
    ).toBe(true);
    expect(
      commandUsesHardwareDecode("ffmpeg -i in.mkv -vf scale=1920:1080 out"),
    ).toBe(false);
  });
});

describe("createStreamObserver", () => {
  test("derives the realtime ratio from timemark advance vs wall-clock", async () => {
    let wall = 1000;
    const observer = createStreamObserver(true, () => wall);
    // First progress establishes the baseline (no ratio yet).
    observer.onProgress?.({ timemark: "00:00:10.00" });
    // 5 media-seconds advance over 10 wall-seconds => ratio 0.5 (behind realtime).
    wall = 11_000;
    observer.onProgress?.({ timemark: "00:00:15.00" });
    const speed = await ffmpegSpeedRatio.get();
    const sample = speed.values.find((v) => v.labels.hardware === "true");
    expect(sample?.value).toBeCloseTo(0.5, 3);
  });

  test("onCommand sets hw-decode engaged", async () => {
    const observer = createStreamObserver(false);
    observer.onCommand?.("ffmpeg -hwaccel vaapi -i in.mkv out");
    const engaged = await hwDecodeEngaged.get();
    expect(engaged.values[0]?.value).toBe(1);
    observer.onCommand?.("ffmpeg -i in.mkv out");
    const disengaged = await hwDecodeEngaged.get();
    expect(disengaged.values[0]?.value).toBe(0);
  });

  test("onSendStats counts late frames only when ratio > 1", async () => {
    const beforeMetric = await sendLateFramesTotal.get();
    const before =
      beforeMetric.values.find((v) => v.labels.kind === "video")?.value ?? 0;
    const observer = createStreamObserver(true);
    observer.onSendStats?.({
      kind: "video",
      ratio: 0.5,
      sendTime: 10,
      frametime: 20,
    });
    observer.onSendStats?.({
      kind: "video",
      ratio: 1.5,
      sendTime: 30,
      frametime: 20,
    });
    const afterMetric = await sendLateFramesTotal.get();
    const after =
      afterMetric.values.find((v) => v.labels.kind === "video")?.value ?? 0;
    expect(after - before).toBe(1);
  });
});
