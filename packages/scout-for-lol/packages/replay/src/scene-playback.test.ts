import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createReplaySceneSession,
  parseReplaySceneTrace,
} from "./scene-playback.ts";

const trace = parseReplaySceneTrace({
  durationSeconds: 2,
  width: 100,
  height: 100,
  participants: [
    { participantId: 1, name: "Teal", championName: "Scout", teamId: 100 },
    { participantId: 2, name: "Coral", championName: "Runner", teamId: 200 },
  ],
  frames: [
    {
      timeSeconds: 0,
      actors: [
        { participantId: 1, x: 20, y: 30, visibleTo: ["blue"] },
        { participantId: 2, x: 80, y: 70, visibleTo: ["red"] },
      ],
      directedParticipantId: 2,
    },
    {
      timeSeconds: 2,
      actors: [
        { participantId: 1, x: 40, y: 50, visibleTo: ["blue"] },
        { participantId: 2, x: 60, y: 50, visibleTo: ["red"] },
      ],
      directedParticipantId: 1,
    },
  ],
});

function canvasFixture() {
  const context = {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
  };
  const canvas = z.custom<HTMLCanvasElement>().parse(
    Object.assign(new EventTarget(), {
      width: 100,
      height: 100,
      getContext: () => context,
      getBoundingClientRect: () => ({ width: 100, height: 100 }),
    }),
  );
  return { canvas, context };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("draws a background in the same viewport as exact observations and preserves it in gaps", async () => {
  const { canvas, context } = canvasFixture();
  const background = canvasFixture().canvas;
  const session = createReplaySceneSession({
    canvas,
    trace,
    background,
    sampling: "exact",
  });
  expect(context.drawImage).toHaveBeenLastCalledWith(background, 5, 5, 90, 90);
  expect(context.drawImage.mock.invocationCallOrder[0]).toBeLessThan(
    context.arc.mock.invocationCallOrder[0]!,
  );

  session.setCamera({ mode: "follow", participantId: 1 });
  expect(context.drawImage).toHaveBeenLastCalledWith(
    background,
    21,
    6.5,
    145,
    145,
  );
  expect(context.arc).toHaveBeenCalledWith(50, 50, 3, 0, 2 * Math.PI);

  context.arc.mockClear();
  await session.seek(1);
  expect(context.arc).not.toHaveBeenCalled();
  expect(context.drawImage).toHaveBeenLastCalledWith(background, 5, 5, 90, 90);
  session.dispose();
});

it("uses recorded positions and applies team visibility before choosing the camera target", async () => {
  const { canvas, context } = canvasFixture();
  const session = createReplaySceneSession({ canvas, trace });
  expect(context.drawImage).not.toHaveBeenCalled();
  expect(context.arc).toHaveBeenNthCalledWith(1, 23, 32, 3, 0, 2 * Math.PI);
  expect(context.arc).toHaveBeenNthCalledWith(2, 77, 68, 3, 0, 2 * Math.PI);

  session.setCamera({ mode: "directed" });
  expect(context.arc).toHaveBeenLastCalledWith(50, 50, 3, 0, 2 * Math.PI);
  context.arc.mockClear();
  context.fillText.mockClear();
  session.setPerspective("blue");
  expect(context.arc).toHaveBeenCalledExactlyOnceWith(
    23,
    32,
    3,
    0,
    2 * Math.PI,
  );
  expect(context.fillText).toHaveBeenCalledExactlyOnceWith("Teal", 23, 26, 100);

  await session.seek(1.99);
  expect(context.arc).toHaveBeenLastCalledWith(23, 32, 3, 0, 2 * Math.PI);
  await session.seek(2);
  expect(context.arc).toHaveBeenLastCalledWith(50, 50, 3, 0, 2 * Math.PI);
  session.setCamera({ mode: "follow", participantId: 2 });
  expect(context.arc).toHaveBeenLastCalledWith(41, 50, 3, 0, 2 * Math.PI);
  session.focusParticipant(2);
  expect(session.getState().camera).toEqual({ mode: "free" });
  expect(context.arc).toHaveBeenLastCalledWith(41, 50, 3, 0, 2 * Math.PI);
  session.setPerspective("all");
  await session.seek(0);
  session.focusParticipant(2);
  await session.seek(2);
  session.setPerspective("red");
  expect(context.arc).toHaveBeenLastCalledWith(59, 50, 3, 0, 2 * Math.PI);
  session.dispose();
});

it("draws exact observed positions, clears gaps, and restores markers on rewind", async () => {
  const { canvas, context } = canvasFixture();
  const captureTime = 0.123456;
  const observation = {
    ...trace.frames[0],
    timeSeconds: captureTime,
    directedParticipantId: null,
  };
  const sparseTrace = parseReplaySceneTrace({
    ...trace,
    frames: [
      { timeSeconds: 0, actors: [], directedParticipantId: null },
      observation,
      { timeSeconds: 2, actors: [], directedParticipantId: null },
    ],
  });
  const session = createReplaySceneSession({
    canvas,
    trace: sparseTrace,
    sampling: "exact",
  });
  expect(session.getState()).toMatchObject({
    timeSeconds: 0,
    durationSeconds: 2,
  });
  expect(context.arc).not.toHaveBeenCalled();
  await session.seek(captureTime);
  expect(context.arc).toHaveBeenCalledTimes(2);
  context.arc.mockClear();
  context.fillRect.mockClear();
  await session.seek(captureTime + 0.000001);
  expect(context.arc).not.toHaveBeenCalled();
  expect(context.fillRect).toHaveBeenNthCalledWith(1, 0, 0, 100, 100);
  await session.seek(captureTime);
  expect(context.arc).toHaveBeenCalledTimes(2);
  context.arc.mockClear();
  await session.seek(captureTime - 0.000001);
  expect(context.arc).not.toHaveBeenCalled();
  session.dispose();

  const defaultSession = createReplaySceneSession({
    canvas,
    trace: sparseTrace,
  });
  await defaultSession.seek(captureTime + 0.000001);
  expect(context.arc).toHaveBeenCalledTimes(2);
  defaultSession.dispose();
});

it("uses custom time samples for presentation and applies visibility before follow", async () => {
  const { canvas } = canvasFixture();
  const draw = vi.fn();
  const actors = [
    { participantId: 1, x: 25, y: 35, visibleTo: ["blue" as const] },
  ];
  const session = createReplaySceneSession({
    canvas,
    trace,
    sampling: "exact",
    sampleFrame: (timeSeconds) => ({
      timeSeconds,
      directedParticipantId: null,
      actors: timeSeconds === 0.25 ? actors : [],
    }),
    presentation: { draw, resize: () => false, dispose: vi.fn() },
  });
  session.setCamera({ mode: "follow", participantId: 1 });
  await session.seek(0.25);
  expect(draw).toHaveBeenLastCalledWith(
    { timeSeconds: 0.25, actors, directedParticipantId: null },
    1,
  );
  session.setPerspective("red");
  expect(draw).toHaveBeenLastCalledWith(
    { timeSeconds: 0.25, actors: [], directedParticipantId: null },
    null,
  );
  session.setPerspective("all");
  await session.seek(0.5);
  expect(draw).toHaveBeenLastCalledWith(
    { timeSeconds: 0.5, actors: [], directedParticipantId: null },
    null,
  );
  await session.seek(0.25);
  expect(draw).toHaveBeenLastCalledWith(
    { timeSeconds: 0.25, actors, directedParticipantId: null },
    1,
  );
  session.dispose();
});

it("advances at the selected rate, stops at the end, and releases playback on abort", async () => {
  const { canvas } = canvasFixture();
  const frames = new Map<number, FrameRequestCallback>();
  let handle = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    handle += 1;
    frames.set(handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const clock = vi.spyOn(performance, "now");
  function step(now: number) {
    clock.mockReturnValue(now);
    const [frame] = frames;
    if (frame === undefined) throw new Error("Expected a pending frame");
    frames.delete(frame[0]);
    frame[1](now);
  }
  clock.mockReturnValue(0);
  const controller = new AbortController();
  const session = createReplaySceneSession({
    canvas,
    trace,
    signal: controller.signal,
  });
  const listener = vi.fn();
  session.subscribe(listener);
  session.resize(200, 100, 2);
  expect(canvas.width).toBe(400);
  expect(canvas.height).toBe(200);
  session.play();
  step(500);
  expect(session.getState().timeSeconds).toBe(0.5);
  session.pause();
  expect(frames.size).toBe(0);
  session.setRate(2);
  session.play();
  step(1250);
  expect(session.getState()).toMatchObject({ playing: false, timeSeconds: 2 });
  expect(frames.size).toBe(0);
  session.play();
  expect(session.getState()).toMatchObject({ playing: true, timeSeconds: 0 });
  session.pause();
  await session.seek(-1);
  session.play();
  controller.abort();
  expect(frames.size).toBe(0);
  expect(() => session.getState()).toThrow("Replay scene disposed");
  session.dispose();
  expect(listener).toHaveBeenLastCalledWith(
    expect.objectContaining({ playing: true, timeSeconds: 0 }),
  );
});

it("retains the first runtime failure and releases the Canvas 2D context listener", () => {
  const { canvas } = canvasFixture();
  const session = createReplaySceneSession({ canvas, trace });
  canvas.dispatchEvent(new Event("contextlost"));
  const listener = vi.fn();
  session.subscribeErrors(listener);
  expect(listener).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      message: "Canvas 2D context was lost",
      code: "engine-failed",
    }),
  );
  canvas.dispatchEvent(new Event("contextlost"));
  expect(listener).toHaveBeenCalledOnce();
});

it("presents the shared exact clock and visible focus through an owned renderer", async () => {
  const { canvas, context } = canvasFixture();
  const draw = vi.fn();
  const resize = vi.fn(() => true);
  const dispose = vi.fn();
  const abort = new AbortController();
  const session = createReplaySceneSession({
    canvas,
    trace,
    sampling: "exact",
    signal: abort.signal,
    presentation: { draw, resize, dispose },
  });

  expect(context.arc).not.toHaveBeenCalled();
  expect(draw).toHaveBeenLastCalledWith(trace.frames[0], null);
  session.setCamera({ mode: "follow", participantId: 2 });
  expect(draw).toHaveBeenLastCalledWith(trace.frames[0], 2);
  await session.seek(1);
  expect(draw).toHaveBeenLastCalledWith(
    { timeSeconds: 1, actors: [], directedParticipantId: null },
    null,
  );
  await session.seek(0);
  session.setPerspective("blue");
  expect(draw).toHaveBeenLastCalledWith(
    expect.objectContaining({ actors: [trace.frames[0].actors[0]] }),
    null,
  );
  session.resize(120, 100, 2);
  expect(resize).toHaveBeenLastCalledWith(120, 100, 2);
  abort.abort();
  session.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});
