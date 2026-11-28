import { expect, type Browser, type Locator } from "@playwright/test";
import { z } from "zod";

const timingCategory = "blink.user_timing";
const frameCategory = "disabled-by-default-devtools.timeline.frame";
const windowStart = "scout-compositor-start";
const windowEnd = "scout-compositor-end";
const traceEntry = z.object({ name: z.string(), cat: z.string() });
const eventHeader = z.object({ pid: z.number().int(), ts: z.number() });
const frameEvent = eventHeader.extend({
  name: z.enum(["BeginFrame", "DrawFrame", "DroppedFrame"]),
  args: z.object({
    layerTreeId: z.number().int(),
    frameSeqId: z.number().int(),
  }),
});
const trace = z.object({ traceEvents: z.array(z.unknown()) });
const completedTrace = z.object({
  stream: z.string().min(1),
  dataLossOccurred: z.literal(false),
});
const traceChunk = z.object({
  data: z.string(),
  base64Encoded: z.boolean().optional(),
  eof: z.boolean().optional(),
});

async function recordTrace<Playback>(
  browser: Browser,
  capture: () => Promise<Playback>,
) {
  const client = await browser.newBrowserCDPSession();
  const parts: Buffer[] = [];
  let tracing = false;
  try {
    await client.send("Tracing.start", {
      traceConfig: { includedCategories: [timingCategory, frameCategory] },
      transferMode: "ReturnAsStream",
    });
    tracing = true;
    const playback = await capture();
    const done = new Promise<unknown>((resolve) => {
      client.once("Tracing.tracingComplete", resolve);
    });
    await client.send("Tracing.end");
    tracing = false;
    const { stream } = completedTrace.parse(await done);
    try {
      for (;;) {
        const chunk = traceChunk.parse(
          await client.send("IO.read", { handle: stream, size: 1024 * 1024 }),
        );
        parts.push(
          Buffer.from(
            chunk.data,
            chunk.base64Encoded === true ? "base64" : "utf8",
          ),
        );
        if (chunk.eof === true) break;
      }
    } finally {
      await client.send("IO.close", { handle: stream });
    }
    return { playback, body: Buffer.concat(parts).toString("utf8") };
  } finally {
    try {
      if (tracing) await client.send("Tracing.end");
    } finally {
      await client.detach();
    }
  }
}

function summarizeCompositorTrace(body: string) {
  const { traceEvents } = trace.parse(JSON.parse(body));
  const markers = new Map<string, z.infer<typeof eventHeader>>();
  const frames: z.infer<typeof frameEvent>[] = [];
  for (const event of traceEvents) {
    const entry = traceEntry.safeParse(event);
    if (!entry.success) continue;
    const { name, cat } = entry.data;
    if (
      cat === timingCategory &&
      (name === windowStart || name === windowEnd)
    ) {
      if (markers.has(name))
        throw new Error("Duplicate compositor sample marker.");
      markers.set(name, eventHeader.parse(event));
    } else if (
      cat === frameCategory &&
      (name === "DrawFrame" || name === "BeginFrame" || name === "DroppedFrame")
    ) {
      frames.push(frameEvent.parse(event));
    }
  }
  const start = markers.get(windowStart);
  const end = markers.get(windowEnd);
  if (start === undefined || end === undefined)
    throw new Error("Missing compositor trace markers.");
  if (start.pid !== end.pid || start.ts >= end.ts)
    throw new Error("Missing compositor markers for one renderer process.");
  const window = frames.filter(
    ({ pid, ts }) => pid === start.pid && ts >= start.ts && ts < end.ts,
  );
  const draws = window
    .filter(({ name }) => name === "DrawFrame")
    .sort((a, b) => a.ts - b.ts);
  const tree = draws[0]?.args.layerTreeId;
  if (tree === undefined || draws.some(({ args }) => args.layerTreeId !== tree))
    throw new Error("Expected compositor draws from exactly one layer tree.");
  const uniqueSequences = (kind: "BeginFrame" | "DroppedFrame") =>
    new Set(
      window
        .filter(({ name, args }) => name === kind && args.layerTreeId === tree)
        .map(({ args }) => args.frameSeqId),
    ).size;
  const drawTimes = new Map(
    draws.map(({ ts, args }) => [args.frameSeqId, (ts - start.ts) / 1000]),
  );
  return {
    layerTreeId: tree,
    durationMilliseconds: (end.ts - start.ts) / 1000,
    beginFrames: uniqueSequences("BeginFrame"),
    droppedFrames: uniqueSequences("DroppedFrame"),
    drawTimes: [...drawTimes.values()].sort((a, b) => a - b),
  };
}

export async function captureRecordedCompositor(
  browser: Browser,
  playbackControls: {
    clock: Locator;
    play: Locator;
    pause: Locator;
    sceneTime: number;
    duration: number;
  },
) {
  const { clock, play, pause, sceneTime, duration } = playbackControls;
  const { playback, body } = await recordTrace(browser, async () => {
    await play.click();
    await expect
      .poll(async () => Number(await clock.inputValue()))
      .toBeGreaterThan(sceneTime);
    const times = await clock.evaluate(
      async (element, { sampleDuration, start, end }) => {
        if (!(element instanceof HTMLInputElement))
          throw new TypeError("Missing replay clock input.");
        const initialTime = element.valueAsNumber;
        const initialSubmissions = globalThis.recordedFrameStarts.length;
        const initialParticles = globalThis.recordedPerformanceParticleDraws;
        performance.mark(start);
        await new Promise<void>((resolve) =>
          globalThis.setTimeout(resolve, sampleDuration),
        );
        performance.mark(end);
        return {
          initialTime,
          finalTime: element.valueAsNumber,
          sceneSubmissions:
            globalThis.recordedFrameStarts.length - initialSubmissions,
          particleDraws:
            globalThis.recordedPerformanceParticleDraws - initialParticles,
        };
      },
      { sampleDuration: duration, start: windowStart, end: windowEnd },
    );
    await pause.click();
    return times;
  });
  return { ...playback, ...summarizeCompositorTrace(body) };
}

export function summarizeFrameStarts(starts: number[]) {
  const intervals = starts
    .slice(1)
    .map((start, index) => start - (starts[index] ?? start))
    .sort((left, right) => left - right);
  const minimum = starts[0] ?? 0;
  const span = (starts.at(-1) ?? minimum) - minimum;
  const percentile = (fraction: number) =>
    intervals[Math.ceil(intervals.length * fraction) - 1];
  return {
    frameSubmissions: starts.length,
    submissionsPerSecond: (1000 * intervals.length) / span,
    intervalMilliseconds: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: intervals.at(-1),
    },
    intervalsAbove33ms: intervals.filter((interval) => interval > 33.34).length,
    intervalsAbove50ms: intervals.filter((interval) => interval > 50).length,
  };
}
