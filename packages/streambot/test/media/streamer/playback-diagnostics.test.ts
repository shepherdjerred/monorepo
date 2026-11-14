import { describe, expect, test, vi } from "vitest";
import { createStreamObserver } from "@shepherdjerred/streambot/observability/stream-observer.ts";
import {
  ffmpegSpeedRatio,
  pipelineQueueDepth,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import {
  ffmpegFramesTotal,
  sendGapsTotal,
  sendIntervalSeconds,
  sourceStarvationsTotal,
  videoFeedbackTotal,
  videoNackPacketsTotal,
  videoReceiverLastReportTimestampSeconds,
  videoSubmissionsTotal,
} from "@shepherdjerred/streambot/observability/playback-diagnostic-metrics.ts";
import { getTracer } from "@shepherdjerred/streambot/observability/tracing.ts";

const frame = {
  kind: "video" as const,
  ptsMs: 1000,
  ratio: 0.01,
  sendTime: 0.1,
  frametime: 33,
  behindMs: 0,
  syncWaitMs: 0,
  paced: true,
  sendIntervalMs: 350,
  sourceIdleMs: 300,
};

describe("persistent playback diagnostics", () => {
  test("a brief recovered gap persists across scrapes while startup bursts are excluded", async () => {
    sendGapsTotal.reset();
    sourceStarvationsTotal.reset();
    sendIntervalSeconds.reset();
    const handle = createStreamObserver(true);
    handle.observer.onSendStats?.({ ...frame, paced: false });
    handle.observer.onSendStats?.(frame);
    handle.observer.onSendStats?.({
      ...frame,
      sendIntervalMs: 33,
      sourceIdleMs: 0,
    });
    handle.dispose();
    const gaps = await sendGapsTotal.get();
    const starvations = await sourceStarvationsTotal.get();
    expect(gaps.values[0]?.value).toBe(1);
    expect(starvations.values[0]?.value).toBe(1);
    const histogram = await sendIntervalSeconds.get();
    expect(
      histogram.values.find(
        (sample) =>
          sample.metricName === "streambot_send_interval_seconds_count",
      )?.value,
    ).toBe(2);
  });

  test("FFmpeg counters accumulate deltas across command restarts", async () => {
    ffmpegFramesTotal.reset();
    const handle = createStreamObserver(true);
    handle.observer.onCommand?.("ffmpeg");
    handle.observer.onProgress?.({
      frames: 100,
      duplicatedFrames: 8,
      droppedFrames: 2,
    });
    handle.observer.onProgress?.({
      frames: 104,
      duplicatedFrames: 10,
      droppedFrames: 2,
    });
    handle.observer.onCommand?.("ffmpeg -ss 10");
    handle.observer.onProgress?.({
      frames: 3,
      duplicatedFrames: 1,
      droppedFrames: 0,
    });
    handle.dispose();
    const counters = await ffmpegFramesTotal.get();
    expect(
      counters.values.find((sample) => sample.labels.action === "produced")
        ?.value,
    ).toBe(107);
    expect(
      counters.values.find((sample) => sample.labels.action === "duplicated")
        ?.value,
    ).toBe(11);
    expect(
      counters.values.find((sample) => sample.labels.action === "dropped")
        ?.value,
    ).toBe(2);
  });

  test("sanitized anomalies are rate limited and produce short correlated spans", () => {
    let wall = 1000;
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const spans = vi.spyOn(getTracer(), "startActiveSpan");
    const handle = createStreamObserver(true, () => wall, undefined, {
      diagnosticContext: {
        transport: "go-live",
        pipelineMode: "hw",
        offsetSeconds: () => 120,
      },
    });
    try {
      handle.observer.onCommand?.(
        "ffmpeg -headers 'Authorization: sensitive' -i https://private.invalid/token",
      );
      handle.observer.onQueueDepth?.({ video: 4, audio: 2 });
      handle.observer.onSendStats?.(frame);
      wall += 1000;
      handle.observer.onSendStats?.(frame);
      wall += 5000;
      handle.observer.onSendStats?.(frame);
      handle.dispose();
      handle.observer.onSendStats?.(frame);
      const logs = output.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(logs.match(/playback timing anomaly/g)).toHaveLength(2);
      expect(logs).toContain('"positionSeconds":121');
      expect(logs).toContain('"videoQueueDepth":4');
      expect(logs).toContain('"epoch":1');
      expect(logs).not.toContain("sensitive");
      expect(logs).not.toContain("private.invalid");
      expect(spans).toHaveBeenCalledTimes(2);
    } finally {
      handle.dispose();
      output.mockRestore();
      spans.mockRestore();
    }
  });

  test("concurrent owners retain worst speed and queue values after another pipeline ends", async () => {
    let now = 0;
    const first = createStreamObserver(true, () => now);
    const second = createStreamObserver(true, () => now);
    first.observer.onProgress?.({ timemark: "00:00:01" });
    second.observer.onProgress?.({ timemark: "00:00:01" });
    now = 1000;
    first.observer.onProgress?.({ timemark: "00:00:01.5" });
    second.observer.onProgress?.({ timemark: "00:00:02" });
    first.observer.onQueueDepth?.({ video: 7, audio: 3 });
    second.observer.onQueueDepth?.({ video: 2, audio: 5 });
    const during = await pipelineQueueDepth.get();
    const speedDuring = await ffmpegSpeedRatio.get();
    expect(speedDuring.values[0]?.value).toBe(0.5);
    expect(
      during.values.find((sample) => sample.labels.kind === "video")?.value,
    ).toBe(7);
    first.dispose();
    const after = await pipelineQueueDepth.get();
    const speedAfter = await ffmpegSpeedRatio.get();
    expect(speedAfter.values[0]?.value).toBe(1);
    expect(
      after.values.find((sample) => sample.labels.kind === "video")?.value,
    ).toBe(2);
    second.dispose();
    const ended = await pipelineQueueDepth.get();
    const speedEnded = await ffmpegSpeedRatio.get();
    expect(ended.values).toEqual([]);
    expect(speedEnded.values).toEqual([]);
  });

  test("transport feedback preserves counters and removes only its own freshness reading", async () => {
    videoFeedbackTotal.reset();
    videoNackPacketsTotal.reset();
    videoSubmissionsTotal.reset();
    const first = createStreamObserver(true, () => 1000);
    const second = createStreamObserver(true, () => 2000);
    first.observer.onVideoFeedback?.({
      type: "receiver-report",
      fractionLost: 0.1,
      cumulativePacketsLost: 4,
      jitterSeconds: 0.02,
    });
    second.observer.onVideoFeedback?.({
      type: "receiver-report",
      fractionLost: 0,
      cumulativePacketsLost: 0,
      jitterSeconds: 0.01,
    });
    first.observer.onVideoFeedback?.({ type: "nack", requestedPackets: 3 });
    first.observer.onVideoSubmission?.({ outcome: "submitted" });
    first.observer.onVideoSubmission?.({ outcome: "missing-track" });
    second.dispose();
    const remaining = await videoReceiverLastReportTimestampSeconds.get();
    expect(remaining.values[0]?.value).toBe(1);
    first.dispose();
    const ended = await videoReceiverLastReportTimestampSeconds.get();
    const nacks = await videoNackPacketsTotal.get();
    const submissions = await videoSubmissionsTotal.get();
    expect(ended.values[0]?.value).toBe(0);
    expect(nacks.values[0]?.value).toBe(3);
    expect(
      submissions.values.find(
        (sample) => sample.labels.outcome === "missing-track",
      )?.value,
    ).toBe(1);
  });
});
