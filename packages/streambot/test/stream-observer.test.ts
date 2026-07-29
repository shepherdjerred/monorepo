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
    const { observer, dispose } = createStreamObserver(true, () => wall);
    // First progress establishes the baseline (no ratio yet).
    observer.onProgress?.({ timemark: "00:00:10.00" });
    // 5 media-seconds advance over 10 wall-seconds => ratio 0.5 (behind realtime).
    wall = 11_000;
    observer.onProgress?.({ timemark: "00:00:15.00" });
    const speed = await ffmpegSpeedRatio.get();
    const sample = speed.values.find((v) => v.labels.hardware === "true");
    expect(sample?.value).toBeCloseTo(0.5, 3);
    dispose();
  });

  test("onCommand sets hw-decode engaged", async () => {
    const { observer, dispose } = createStreamObserver(false);
    observer.onCommand?.("ffmpeg -hwaccel vaapi -i in.mkv out");
    const engaged = await hwDecodeEngaged.get();
    expect(engaged.values[0]?.value).toBe(1);
    observer.onCommand?.("ffmpeg -i in.mkv out");
    const disengaged = await hwDecodeEngaged.get();
    expect(disengaged.values[0]?.value).toBe(0);
    dispose();
  });

  test("onSendStats counts late frames only when ratio > 1", async () => {
    const beforeMetric = await sendLateFramesTotal.get();
    const before =
      beforeMetric.values.find((v) => v.labels.kind === "video")?.value ?? 0;
    const { observer, dispose } = createStreamObserver(true);
    observer.onSendStats?.({
      kind: "video",
      ptsMs: 0,
      ratio: 0.5,
      sendTime: 10,
      frametime: 20,
      behindMs: 0,
      syncWaitMs: 0,
    });
    observer.onSendStats?.({
      kind: "video",
      ptsMs: 20,
      ratio: 1.5,
      sendTime: 30,
      frametime: 20,
      behindMs: 0,
      syncWaitMs: 0,
    });
    const afterMetric = await sendLateFramesTotal.get();
    const after =
      afterMetric.values.find((v) => v.labels.kind === "video")?.value ?? 0;
    expect(after - before).toBe(1);
    dispose();
  });

  test("dispose stops the progress-age timer so stale segments don't race on the gauge", async () => {
    let wall = 1000;
    const { observer, dispose } = createStreamObserver(true, () => wall);
    observer.onCommand?.("ffmpeg -i in.mkv out");
    // Advance wall time well past the stall threshold.
    wall += 10_000;
    // dispose before the interval fires.
    dispose();
    // A second call to dispose must be safe (idempotent).
    dispose();
  });
});

/** Let the fast (2ms) watchdog interval fire at least once. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

describe("createStreamObserver stall watchdog", () => {
  test("a wedged ffmpeg emitting the SAME timemark still trips the stall watchdog and reports the last media position", async () => {
    let wall = 0;
    const stalls: (number | undefined)[] = [];
    const { observer, dispose } = createStreamObserver(
      true,
      () => wall,
      (lastMediaSeconds) => stalls.push(lastMediaSeconds),
      2, // fast watchdog tick for a deterministic test
    );
    observer.onCommand?.("ffmpeg -i in.mkv out");
    // First parseable sample arms the watchdog at wall=1000 with media at 5s.
    wall = 1000;
    observer.onProgress?.({ timemark: "00:00:05.00" });
    // A wedged process keeps reporting the SAME media timemark — the watchdog must NOT re-arm.
    wall = 2000;
    observer.onProgress?.({ timemark: "00:00:05.00" });
    // 21s past the last real media advance (wall=1000).
    wall = 22_000;
    await tick();

    expect(stalls.length).toBeGreaterThanOrEqual(1);
    // The reported position is the last DELIVERED media timemark (5s), not a wall-clock figure.
    expect(stalls[0]).toBe(5);
    dispose();
  });

  test("advancing media keeps the watchdog armed (no false stall)", async () => {
    let wall = 0;
    const stalls: (number | undefined)[] = [];
    const { observer, dispose } = createStreamObserver(
      true,
      () => wall,
      (lastMediaSeconds) => stalls.push(lastMediaSeconds),
      2,
    );
    observer.onCommand?.("ffmpeg -i in.mkv out");
    // Media advances in lockstep with wall-clock across a span > STALL_AFTER_SECONDS.
    for (let i = 1; i <= 25; i++) {
      wall = i * 1000;
      observer.onProgress?.({
        timemark: `00:00:${String(i).padStart(2, "0")}.00`,
      });
    }
    await tick();

    expect(stalls).toHaveLength(0);
    dispose();
  });

  test("a seek (new onCommand) starts a fresh epoch — healthy post-seek playback is not a false stall", async () => {
    let wall = 0;
    const stalls: (number | undefined)[] = [];
    const { observer, dispose } = createStreamObserver(
      true,
      () => wall,
      (lastMediaSeconds) => stalls.push(lastMediaSeconds),
      2,
    );
    observer.onCommand?.("ffmpeg -i in.mkv out");
    // Play healthily well past the stall threshold so the pre-seek media baseline is high (25s).
    for (let i = 1; i <= 25; i++) {
      wall = i * 1000;
      observer.onProgress?.({
        timemark: `00:00:${String(i).padStart(2, "0")}.00`,
      });
    }
    // A /seek restarts ffmpeg at a new -ss → new onCommand, and its output timemark restarts near
    // zero. Without an epoch reset the low post-seek timemarks stay < the old 25s baseline, never
    // re-arm the watchdog, and a false stall fires ~20s later despite healthy playback.
    wall = 26_000;
    observer.onCommand?.("ffmpeg -ss 120 -i in.mkv out");
    for (let i = 1; i <= 25; i++) {
      wall = 26_000 + i * 1000;
      observer.onProgress?.({
        timemark: `00:00:${String(i).padStart(2, "0")}.00`,
      });
    }
    await tick();

    expect(stalls).toHaveLength(0);
    dispose();
  });

  test("the stall fires once per silence (not every tick)", async () => {
    let wall = 0;
    const stalls: (number | undefined)[] = [];
    const { observer, dispose } = createStreamObserver(
      true,
      () => wall,
      (lastMediaSeconds) => stalls.push(lastMediaSeconds),
      2,
    );
    observer.onCommand?.("ffmpeg -i in.mkv out");
    wall = 1000;
    observer.onProgress?.({ timemark: "00:00:05.00" });
    wall = 30_000; // deep into the stall; many watchdog ticks will elapse during the wait
    await tick();

    expect(stalls).toHaveLength(1);
    dispose();
  });
});
