import { describe, expect, it, spyOn } from "bun:test";
import {
  commandUsesHardwareEncode,
  createStreamObserver,
  newSessionStats,
  parseTimemarkSeconds,
} from "./stream-observer.ts";
import { notifyStreamSessionEnded } from "./game-streamer.ts";
import { registry } from "#src/observability/metrics.ts";
import { logger } from "#src/logger.ts";

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

describe("createStreamObserver", () => {
  it("derives the speed ratio from timemark advance vs wall clock", async () => {
    const clock = makeClock();
    const session = newSessionStats();
    const observer = createStreamObserver(session, clock.now);

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
    const observer = createStreamObserver(session, clock.now);

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
      ratio: 1.5,
      sendTime: 50,
      frametime: 33.3,
    });
    observer.onSendStats?.({
      kind: "video",
      ratio: 0.5,
      sendTime: 16,
      frametime: 33.3,
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
    const infoSpy = spyOn(logger, "info").mockImplementation(() => logger);
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
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => logger);
    try {
      const clock = makeClock();
      const observer = createStreamObserver(newSessionStats(), clock.now);

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
