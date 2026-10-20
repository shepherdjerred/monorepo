import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commandUsesHardwareEncode,
  createStreamObserver as createObservedStream,
  newSessionStats,
  parseTimemarkSeconds,
  createLatencyObservations,
  type StreamObserverOptions,
  type SessionStats,
} from "./stream-observer.ts";
import { createStreamMetrics, type StreamMetrics } from "./session-metrics.ts";
import { notifyStreamSessionEnded } from "./game-streamer.ts";
import { registry } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import { logger } from "#src/logger.ts";

const scopes: StreamMetrics[] = [];
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.close();
});
function createStreamObserver(
  session: SessionStats,
  options: Omit<StreamObserverOptions, "metrics"> = {},
) {
  const metrics = createStreamMetrics();
  scopes.push(metrics);
  return createObservedStream(session, { ...options, metrics });
}

// The registry is shared across this process's tests — always assert deltas.
async function metricValue(
  name: string,
  metricName?: string,
  labels?: Record<string, string>,
): Promise<number> {
  const metrics = await registry.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === name);
  if (metric === undefined) throw new Error(`metric ${name} not registered`);
  const entry = metric.values.find((v) => {
    if (metricName !== undefined && v.metricName !== metricName) return false;
    if (labels !== undefined) {
      for (const [k, want] of Object.entries(labels)) {
        const got: unknown = Reflect.get(v.labels, k);
        if (got !== want) return false;
      }
    }
    return true;
  });
  return entry?.value ?? 0;
}

function makeClock(start = 10_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

it("keeps a slow game's encoder metrics separate from a healthy game", async () => {
  const mk64 = createStreamMetrics("mk64");
  const brawl = createStreamMetrics("brawl");
  scopes.push(mk64, brawl);
  mk64.speedRatio.set(0.5);
  brawl.speedRatio.set(1);
  mk64.fps.set(15);
  brawl.fps.set(30);
  expect(
    await metricValue("stream_ffmpeg_speed_ratio", undefined, {
      runtime: "mk64",
    }),
  ).toBe(0.5);
  expect(
    await metricValue("stream_ffmpeg_speed_ratio", undefined, {
      runtime: "brawl",
    }),
  ).toBe(1);
  const before = await metricValue(
    "stream_packet_ready_delay_ms",
    "stream_packet_ready_delay_ms_count",
    { runtime: "brawl", kind: "video" },
  );
  createLatencyObservations(brawl).observePacketReady("video", 5);
  expect(
    await metricValue(
      "stream_packet_ready_delay_ms",
      "stream_packet_ready_delay_ms_count",
      { runtime: "brawl", kind: "video" },
    ),
  ).toBe(before + 1);
  mk64.close();
  expect(
    await metricValue("stream_ffmpeg_fps", undefined, { runtime: "mk64" }),
  ).toBe(0);
  expect(
    await metricValue("stream_ffmpeg_fps", undefined, { runtime: "brawl" }),
  ).toBe(30);
});

describe("parseTimemarkSeconds", () => {
  it("parses HH:MM:SS.ss", () => {
    expect(parseTimemarkSeconds("00:01:30.50")).toBe(90.5);
    expect(parseTimemarkSeconds("01:00:00.00")).toBe(3600);
  });
  it("parses negative timemarks", () => {
    expect(parseTimemarkSeconds("-00:00:01.00")).toBe(-1);
  });
  it("returns undefined for garbage", () => {
    expect(parseTimemarkSeconds()).toBeUndefined();
    expect(parseTimemarkSeconds("garbage")).toBeUndefined();
    expect(parseTimemarkSeconds("1:2")).toBeUndefined();
    expect(parseTimemarkSeconds("aa:bb:cc")).toBeUndefined();
  });
});

describe("commandUsesHardwareEncode", () => {
  it("detects the VAAPI encode pipeline", () => {
    expect(
      commandUsesHardwareEncode(
        "ffmpeg -f rawvideo -i pipe:0 -vf scale=960:720,format=nv12,hwupload -c:v h264_vaapi -rc_mode VBR out",
      ),
    ).toBe(true);
  });
  it("does not flag the software pipeline", () => {
    expect(
      commandUsesHardwareEncode(
        "ffmpeg -f rawvideo -i pipe:0 -c:v libx264 -preset ultrafast -tune zerolatency out",
      ),
    ).toBe(false);
  });
});

describe("notifyStreamSessionEnded", () => {
  it("notifies when a real Go-Live session ended", async () => {
    let calls = 0;
    await notifyStreamSessionEnded(true, () => {
      calls++;
    });
    expect(calls).toBe(1);
  });

  it("awaits async restart hooks", async () => {
    const events: string[] = [];
    await notifyStreamSessionEnded(true, async () => {
      await Promise.resolve();
      events.push("done");
    });
    expect(events).toEqual(["done"]);
  });

  it("does not notify when leave runs before a session starts", async () => {
    let calls = 0;
    await notifyStreamSessionEnded(false, () => {
      calls++;
    });
    await notifyStreamSessionEnded(true);
    expect(calls).toBe(0);
  });
});

describe("stream metric ownership", () => {
  it("preserves the other stream's measurements through teardown and late callbacks", async () => {
    const first = createStreamMetrics();
    const second = createStreamMetrics();
    scopes.push(first, second);
    const firstLatency = createLatencyObservations(first);
    const secondLatency = createLatencyObservations(second);
    firstLatency.observeAvContentOffset(-198.5);
    secondLatency.observeAvContentOffset(50);
    first.fps.set(30);
    second.fps.set(60);
    first.speedRatio.set(0.8);
    second.speedRatio.set(1);
    expect(await metricValue("stream_av_content_offset_ms")).toBe(-198.5);
    expect(await metricValue("stream_ffmpeg_fps")).toBe(90);
    expect(await metricValue("stream_ffmpeg_speed_ratio")).toBe(0.8);
    first.close();
    firstLatency.observeAvContentOffset(999);
    expect(await metricValue("stream_av_content_offset_ms")).toBe(50);
    expect(await metricValue("stream_ffmpeg_fps")).toBe(60);
    expect(await metricValue("stream_ffmpeg_speed_ratio")).toBe(1);
    second.close();
    expect(await metricValue("stream_av_content_offset_ms")).toBe(0);
    expect(await metricValue("stream_ffmpeg_fps")).toBe(0);
    expect(await metricValue("stream_ffmpeg_speed_ratio")).toBe(0);
  });
});

describe("createStreamObserver", () => {
  it("derives the speed ratio from timemark advance vs wall clock", async () => {
    const clock = makeClock();
    const session = newSessionStats();
    const observer = createStreamObserver(session, { now: clock.now });

    observer.onProgress?.({ timemark: "00:00:01.00" });
    clock.advance(2000);
    observer.onProgress?.({ timemark: "00:00:03.00", currentFps: 30 });

    expect(await metricValue("stream_ffmpeg_speed_ratio")).toBe(1);
    expect(await metricValue("stream_ffmpeg_fps")).toBe(30);
    expect(session.lastSpeedRatio).toBe(1);
  });

  it("does not write a ratio when the timemark has not advanced", async () => {
    const clock = makeClock();
    const session = newSessionStats();
    const observer = createStreamObserver(session, { now: clock.now });

    observer.onProgress?.({ timemark: "00:00:05.00" });
    clock.advance(1000);
    observer.onProgress?.({ timemark: "00:00:07.00" });
    const ratioAfterAdvance = await metricValue("stream_ffmpeg_speed_ratio");

    clock.advance(1000);
    observer.onProgress?.({ timemark: "00:00:07.00" }); // stalled
    expect(await metricValue("stream_ffmpeg_speed_ratio")).toBe(
      ratioAfterAdvance,
    );
  });

  it("observes send stats and counts late video frames", async () => {
    const session = newSessionStats();
    const observer = createStreamObserver(session);
    const lateBefore = await metricValue(
      "stream_send_late_frames_total",
      undefined,
      { kind: "video" },
    );
    const countBefore = await metricValue(
      "stream_send_frametime_ratio",
      "stream_send_frametime_ratio_count",
      { kind: "video" },
    );

    observer.onSendStats?.({
      kind: "video",
      ptsMs: 0,
      ratio: 1.5,
      sendTime: 50,
      frametime: 33.3,
      behindMs: 0,
      syncWaitMs: 0,
    });
    observer.onSendStats?.({
      kind: "video",
      ptsMs: 33.3,
      ratio: 0.5,
      sendTime: 16,
      frametime: 33.3,
      behindMs: 0,
      syncWaitMs: 0,
    });

    expect(
      await metricValue("stream_send_late_frames_total", undefined, {
        kind: "video",
      }),
    ).toBe(lateBefore + 1);
    expect(
      await metricValue(
        "stream_send_frametime_ratio",
        "stream_send_frametime_ratio_count",
        { kind: "video" },
      ),
    ).toBe(countBefore + 2);
    expect(session.videoFramesSent).toBe(2);
    expect(session.lateVideoFrames).toBe(1);
  });

  it("sets the hw-encode gauge and logs the command once", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    try {
      const observer = createStreamObserver(newSessionStats());
      observer.onCommand?.("ffmpeg ... hwupload -c:v h264_vaapi ...");
      expect(await metricValue("stream_hw_encode_engaged")).toBe(1);
      observer.onCommand?.("ffmpeg ... -c:v libx264 ...");
      expect(await metricValue("stream_hw_encode_engaged")).toBe(0);
      expect(infoSpy).toHaveBeenCalledTimes(2);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("warns on sustained sub-realtime encode, rate-limited to once a minute", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    try {
      const clock = makeClock();
      const observer = createStreamObserver(newSessionStats(), {
        now: clock.now,
      });

      // Prime, then deliver slow samples: media advances 0.5s per 1s of wall
      // clock (ratio 0.5). Warn fires on the 5th consecutive slow sample.
      let mediaTenths = 10;
      const step = () => {
        clock.advance(1000);
        mediaTenths += 5;
        const s = (mediaTenths / 10).toFixed(2).padStart(5, "0");
        observer.onProgress?.({ timemark: `00:00:${s}` });
      };
      observer.onProgress?.({ timemark: "00:00:01.00" });
      for (let i = 0; i < 5; i++) step();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // More slow samples inside the same minute: no second warning.
      for (let i = 0; i < 10; i++) step();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Past the rate-limit window: warns again.
      clock.advance(61_000);
      for (let i = 0; i < 2; i++) step();
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
