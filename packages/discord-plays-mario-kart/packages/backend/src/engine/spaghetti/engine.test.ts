import { describe, expect, it } from "vitest";
import { EMPTY_INPUT } from "@discord-plays-mario-kart/common";
import type { MetricSink } from "#src/emulator/metric-sink.ts";
import type { Mk64RawState, Mk64Snapshot } from "#src/emulator/mk64-memory.ts";
import type { EngineFrame } from "#src/engine/game-engine.ts";
import {
  SpaghettiEngine,
  bgraToRgba,
  type BridgeHost,
  type BridgeHostCallbacks,
} from "./engine.ts";
import { N64_BUTTON, type Hello, type Pad } from "./protocol.ts";

const WIDTH = 640;
const HEIGHT = 480;

class FakeHost implements BridgeHost {
  callbacks: BridgeHostCallbacks;
  hello: Hello = {
    protocolVersion: 1,
    audioRate: 26_800,
    outputFps: 30,
    lockstep: true,
  };
  inputs: Pad[][] = [];
  runPacedCalls = 0;
  resets = 0;
  stopped = false;
  private seq = 0;

  constructor(callbacks: BridgeHostCallbacks) {
    this.callbacks = callbacks;
  }

  start(): Promise<Hello> {
    return Promise.resolve(this.hello);
  }

  sendInput(pads: readonly Pad[]): number {
    this.inputs.push(pads.map((pad) => ({ ...pad })));
    this.seq += 1;
    return this.seq;
  }

  runPaced(): void {
    this.runPacedCalls += 1;
  }

  reset(): void {
    this.resets += 1;
  }

  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }

  frame(
    drawSeq: number,
    latchedInputSeq = 0,
    width = WIDTH,
    height = HEIGHT,
  ): void {
    const bgra = Buffer.alloc(width * height * 4);
    // One recognizable BGRA pixel: blue 1, green 2, red 3.
    bgra.set([1, 2, 3, 0], 0);
    this.callbacks.onFrame({
      drawSeq,
      gameFrame: drawSeq,
      latchedInputSeq,
      latchToCaptureUs: 0,
      width,
      height,
      bgra,
    });
  }

  state(gameFrame: number, raw: Partial<Mk64RawState> = {}): void {
    const slots = [0, 1, 2, 3];
    this.callbacks.onState({
      gameFrame,
      raw: {
        gamestate: 4,
        racePhase: 3,
        menuSelection: 14,
        activeScreenMode: 0,
        playerCountSelection: 1,
        modeSelection: 0,
        courseId: 8,
        players: slots.map(() => ({
          type: 0xc0_00,
          currentRank: 0,
          characterId: 0,
        })),
        hud: slots.map(() => ({ timerCs: 0, raceComplete: 0 })),
        ...raw,
      },
    });
  }
}

type Observed = { inputDelays: number[]; ticks: number; restarts: string[] };

function ignore(): void {
  // A metric this suite does not assert on.
}

function metricSink(observed: Observed): MetricSink {
  return {
    observeEmulateMs: ignore,
    observeLateMs: ignore,
    observeCopyMs: ignore,
    observeInputApplyDelayMs: (ms) => observed.inputDelays.push(ms),
    incTicks: (count) => {
      observed.ticks += count;
    },
    incLoopResync: ignore,
    incRestarts: (reason) => observed.restarts.push(reason),
  };
}

async function bootEngine(
  setup: (host: FakeHost) => void = ignore,
  outputFps: 30 | 60 = 30,
): Promise<{
  engine: SpaghettiEngine;
  host: FakeHost;
  frames: EngineFrame[];
  observed: Observed;
}> {
  let host: FakeHost | undefined;
  const observed: Observed = { inputDelays: [], ticks: 0, restarts: [] };
  const engine = new SpaghettiEngine({
    build: { binary: "", engineArchive: "", gameArchive: "" },
    homeDir: "",
    seats: 2,
    outputFps,
    snapshotEveryNFrames: 10,
    metrics: metricSink(observed),
    hostFactory: (callbacks) => {
      host = new FakeHost(callbacks);
      host.hello = { ...host.hello, outputFps };
      setup(host);
      return host;
    },
  });
  const frames: EngineFrame[] = [];
  engine.onFrame((frame) => frames.push(frame));
  await engine.init();
  if (host === undefined) throw new Error("host factory was not called");
  return { engine, host, frames, observed };
}

describe("SpaghettiEngine boot", () => {
  it("rejects a game whose media does not match the configured format", async () => {
    let stopped: FakeHost | undefined;
    await expect(
      bootEngine((host) => {
        host.hello = { ...host.hello, audioRate: 32_000, outputFps: 60 };
        stopped = host;
      }),
    ).rejects.toThrow(/audio 32000 Hz, 60 fps/);
    // A failed boot cleans up its process.
    expect(stopped?.stopped).toBe(true);
  });

  it("switches the game to wall-clock pacing once", async () => {
    const { engine, host } = await bootEngine();
    expect(host.runPacedCalls).toBe(0);
    engine.start();
    engine.start();
    expect(host.runPacedCalls).toBe(1);
  });
});

describe("SpaghettiEngine frames", () => {
  it("delivers nothing before start", async () => {
    const { host, frames } = await bootEngine();
    host.frame(1);
    expect(frames).toHaveLength(0);
  });

  it("times frames from the first one after start", async () => {
    const { engine, host, frames, observed } = await bootEngine(undefined, 60);
    engine.start();
    host.frame(100);
    host.frame(101);
    host.frame(103);
    expect(frames.map((f) => f.contentTimeMs)).toEqual([0, 1000 / 60, 50]);
    expect(frames[0]?.height).toBe(HEIGHT);
    expect(observed.ticks).toBe(3);
  });

  it("drops frames of the wrong size, including the pre-resize boot draw", async () => {
    const { engine, host, frames } = await bootEngine();
    engine.start();
    host.frame(0, 0, 478, 382);
    host.frame(1);
    host.frame(2, 0, 320, 240);
    expect(frames).toHaveLength(1);
    // Content time starts at the first frame actually delivered.
    expect(frames[0]?.contentTimeMs).toBe(0);
  });

  it("attributes an input to the first frame that latched it", async () => {
    const { engine, host, frames, observed } = await bootEngine();
    engine.start();
    engine.setPlayerInput(0, { ...EMPTY_INPUT, analogX: 1 }); // seq 1
    engine.setPlayerInput(1, {
      ...EMPTY_INPUT,
      buttons: { ...EMPTY_INPUT.buttons, a: true },
    }); // seq 2
    host.frame(1, 0);
    host.frame(2, 1);
    host.frame(3, 2);
    host.frame(4, 2);

    expect(frames[0]?.inputReceivedAtMs).toBeUndefined();
    expect(frames[1]?.inputReceivedAtMs).toBeTypeOf("number");
    expect(frames[2]?.inputReceivedAtMs).toBeTypeOf("number");
    expect(frames[3]?.inputReceivedAtMs).toBeUndefined();
    // One arrival-to-latch observation per seat.
    expect(observed.inputDelays).toHaveLength(2);

    // Every input carries all four ports.
    expect(host.inputs.at(-1)).toEqual([
      { button: 0, stickX: 80, stickY: 0 },
      { button: N64_BUTTON.a, stickX: 0, stickY: 0 },
      { button: 0, stickX: 0, stickY: 0 },
      { button: 0, stickX: 0, stickY: 0 },
    ]);
  });

  it("reports which seats are holding a control", async () => {
    const { engine, host, frames } = await bootEngine();
    engine.start();
    engine.setPlayerInput(1, { ...EMPTY_INPUT, analogY: -1 });
    host.frame(1, 1);
    expect(frames[0]?.seatActivity).toEqual([false, true]);
    engine.clearPlayerInput(1);
    host.frame(2, 2);
    expect(frames[1]?.seatActivity).toEqual([false, false]);
    expect(engine.latestSeatActivity).toEqual([false, false]);
  });
});

describe("SpaghettiEngine screenshots", () => {
  it("captures the next frame as RGBA before overlays touch it", async () => {
    const { engine, host } = await bootEngine();
    engine.onFrame((frame) => frame.rgba.fill(0xff));
    engine.start();
    const shot = engine.renderFrame();
    host.frame(1);
    const { rgba, width, height } = await shot;
    expect({ width, height }).toEqual({ width: WIDTH, height: HEIGHT });
    expect([...rgba.subarray(0, 4)]).toEqual([3, 2, 1, 0xff]);
  });

  it("rejects when the game is not running", async () => {
    const { engine } = await bootEngine();
    await expect(engine.renderFrame()).rejects.toThrow(/not running/);
  });

  it("rejects a pending screenshot when the game dies", async () => {
    const { engine, host } = await bootEngine();
    engine.start();
    const shot = engine.renderFrame();
    host.callbacks.onUnexpectedExit(new Error("segfault"));
    await expect(shot).rejects.toThrow("segfault");
  });
});

describe("SpaghettiEngine audio and state", () => {
  it("times audio by samples delivered since start", async () => {
    const { engine, host } = await bootEngine();
    const ends: number[] = [];
    engine.onAudio((_pcm, contentEndMs) => ends.push(contentEndMs));
    host.callbacks.onAudio({ gameFrame: 0, pcm: Buffer.alloc(4 * 100) });
    engine.start();
    host.callbacks.onAudio({ gameFrame: 1, pcm: Buffer.alloc(4 * 268) });
    host.callbacks.onAudio({ gameFrame: 2, pcm: Buffer.alloc(4 * 268) });
    expect(ends).toEqual([10, 20]);
  });

  it("decodes a snapshot every snapshotEveryNFrames game frames", async () => {
    const { engine, host } = await bootEngine();
    const snapshots: Mk64Snapshot[] = [];
    engine.onSnapshot((snapshot) => snapshots.push(snapshot));
    engine.start();
    for (let gameFrame = 1; gameFrame <= 25; gameFrame++) {
      host.state(gameFrame);
    }
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      raceState: "racing",
      screenMode: "1p",
      courseId: 8,
    });
    expect(snapshots[0]?.players[0]).toMatchObject({
      present: true,
      human: true,
      rank: 1,
    });
  });
});

describe("SpaghettiEngine lifecycle", () => {
  it("restarts to the title with neutral input and a fresh timeline", async () => {
    const { engine, host, frames, observed } = await bootEngine();
    engine.start();
    engine.setPlayerInput(0, { ...EMPTY_INPUT, analogX: 1 });
    host.frame(10, 1);
    engine.restartFromStartMenu("stream_session_ended");
    expect(host.resets).toBe(1);
    expect(host.inputs.at(-1)?.every((pad) => pad.stickX === 0)).toBe(true);
    expect(observed.restarts).toEqual(["stream_session_ended"]);
    host.frame(50, 2);
    expect(frames.at(-1)?.contentTimeMs).toBe(0);
  });

  it("ignores input once stopped", async () => {
    const { engine, host } = await bootEngine();
    engine.start();
    await engine.stop();
    expect(host.stopped).toBe(true);
    engine.setPlayerInput(0, { ...EMPTY_INPUT, analogX: 1 });
    expect(host.inputs).toHaveLength(0);
  });
});

describe("bgraToRgba", () => {
  it("swaps red and blue and makes alpha opaque", () => {
    expect([...bgraToRgba(Buffer.from([1, 2, 3, 0, 4, 5, 6, 7]))]).toEqual([
      3, 2, 1, 255, 6, 5, 4, 255,
    ]);
  });
});
