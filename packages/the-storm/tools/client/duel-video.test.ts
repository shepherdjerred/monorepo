import { expect, test } from "vitest";
import { validateDuelClock, validateDuelPrefix } from "./duel-clock.ts";
import { validateDuelFrames } from "./duel-video.ts";
import { verifyDuelOutcome } from "./duel-recording.ts";
import { DuelStateSchema } from "#learning/duels.ts";

function fixture(ending = 20) {
  const expected = {
    seed: 17,
    side: "red",
    mode: "authored",
    opponent: "basic",
  };
  const base = { match: "11111111-2222-4333-8444-555555555555", ...expected };
  const marker = (kind: string, elapsed: number, result: string) => ({
    ...base,
    sequence: kind === "begin" ? 0 : elapsed + (kind === "tick" ? 1 : 2),
    marker: kind,
    tick: elapsed < 0 ? -1 : 9000 + elapsed,
    worldTick: 100 + Math.max(0, elapsed),
    elapsed,
    result,
  });
  const entries = [
    { marker: marker("begin", -1, "waiting"), receivedElapsedNanos: 1000 },
  ];
  const lastTick = ending < 0 ? 599 : ending;
  for (let tick = 0; tick <= lastTick; tick++)
    entries.push({
      marker: marker("tick", tick, "live"),
      receivedElapsedNanos: 2000 + tick * 50_000_000,
    });
  if (ending >= 0)
    entries.push({
      marker: marker("terminal", ending, "loss"),
      receivedElapsedNanos: 2000 + ending * 50_000_000,
    });
  const terminalFrame = ending < 0 ? -1 : Math.ceil((ending * 30) / 20);
  const frames = Array.from({ length: 900 }, (_, index) => {
    const source =
      terminalFrame >= 0 && index >= terminalFrame ? terminalFrame : index;
    return {
      frame: {
        index,
        elapsedNanos: Math.floor((index * 1_000_000_000) / 30),
        worldTick: 100 + Math.floor((source * 20) / 30),
        camera: {
          position: [31.5, 74.62, 22.5],
          yaw: 180,
          pitch: 35,
          fov: 70,
          hud: false,
          nameplates: false,
        },
      },
      file: `${index.toString().padStart(6, "0")}.png`,
      sha256: source.toString(16).padStart(64, "0"),
    };
  });
  const bindings = frames.map(({ frame }) => {
    const elapsed = Math.floor((frame.index * 20) / 30);
    const terminal = ending >= 0 && elapsed >= ending;
    return {
      index: frame.index,
      markerReceivedNanos: (terminal ? ending : elapsed) * 50_000_000,
      marker: terminal
        ? marker("terminal", ending, "loss")
        : marker("tick", elapsed, "live"),
      sourceFrame: terminal ? terminalFrame : frame.index,
      clientWorldTick: 100 + elapsed,
    };
  });
  return {
    schema: 3,
    kind: "rwf-rendered-duel-frames",
    acceptance: "unaccepted",
    source: "minecraft-framebuffer",
    fps: 30,
    requestedFrames: 900,
    complete: true,
    error: "",
    frames,
    duel: {
      window: "first-600-live-ticks-hold-terminal-frame",
      liveTicks: 600,
      frames: 900,
      startedElapsedNanos: 2000,
      terminalFrame,
      clock: {
        schema: 1,
        kind: "rwf-native-duel-clock",
        acceptance: "unaccepted",
        source: "paper-custom-payload",
        expected,
        complete: ending >= 0,
        error: "",
        entries,
      },
      bindings,
    },
  };
}

test("holds only the original terminal render after a native loss", () => {
  const parsed = validateDuelFrames(fixture());
  expect(parsed.duel.terminalFrame).toBe(30);
  expect(parsed.duel.bindings[899]?.sourceFrame).toBe(30);
});

test("retains client clock corrections while requiring exact authoritative Paper frame clocks", () => {
  const raw = fixture();
  const previous = raw.duel.bindings[3];
  const next = raw.duel.bindings[4];
  const frame = raw.frames[4];
  if (previous === undefined || next === undefined || frame === undefined)
    throw new Error("Missing fixture frame");
  previous.clientWorldTick = 1220;
  next.clientWorldTick = 1219;
  expect(validateDuelFrames(raw).duel.bindings[4]?.clientWorldTick).toBe(1219);
  frame.frame.worldTick++;
  expect(() => validateDuelFrames(raw)).toThrow("world clock differs");
});

test("a full first-600-tick clip does not prove a full match terminal outcome", () => {
  const raw = fixture(-1);
  expect(validateDuelFrames(raw).duel.terminalFrame).toBe(-1);
  expect(validateDuelPrefix(raw.duel.clock).complete).toBe(false);
  expect(() => validateDuelClock(raw.duel.clock)).toThrow("terminal marker");
});

function outcome(ending = 20) {
  return DuelStateSchema.parse({
    protocol: 3,
    contract: "rwf-combat-v1",
    seed: 17,
    side: "red",
    mode: "authored",
    opponent: "basic",
    result: "loss",
    phase: "ENDED",
    match: "11111111-2222-4333-8444-555555555555",
    dealt: 0,
    received: 20,
    sampleDealt: 0,
    sampleReceived: 20,
    sampleTick: 9000 + ending,
    used: [],
    applied: 0,
    fallback: 0,
  });
}

test("rechecks an early terminal hold against its original full clock and outcome", () => {
  const frames = validateDuelFrames(fixture());
  const clock = validateDuelClock(fixture().duel.clock);
  expect(() => verifyDuelOutcome(frames, clock, outcome())).not.toThrow();
  for (const changed of [
    { seed: 18 },
    { side: "blue" },
    { mode: "external" },
    { opponent: "authored" },
    { match: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
    { result: "win" },
    { sampleTick: 9021 },
  ])
    expect(() =>
      verifyDuelOutcome(
        frames,
        clock,
        DuelStateSchema.parse({ ...outcome(), ...changed }),
      ),
    ).toThrow("captured outcome");
});

test("requires the recorded prefix to agree with a later full-match terminal", () => {
  const frames = validateDuelFrames(fixture(-1));
  const full = validateDuelClock(fixture(650).duel.clock);
  expect(() => verifyDuelOutcome(frames, full, outcome(650))).not.toThrow();
  const changed = structuredClone(full);
  const tick = changed.entries[200];
  if (tick === undefined) throw new Error("Missing unit clock tick");
  tick.marker.worldTick++;
  expect(() => verifyDuelOutcome(frames, changed, outcome(650))).toThrow(
    "separate original clock",
  );
});

test("normalizes independent journal origins but rejects a changed receive timestamp", () => {
  const frames = validateDuelFrames(fixture());
  const full = fixture().duel.clock;
  for (const entry of full.entries) entry.receivedElapsedNanos += 5000;
  const clock = validateDuelClock(full);
  expect(() => verifyDuelOutcome(frames, clock, outcome())).not.toThrow();
  const tick = clock.entries[5];
  if (tick === undefined) throw new Error("Missing unit clock tick");
  tick.receivedElapsedNanos++;
  expect(() => verifyDuelOutcome(frames, clock, outcome())).toThrow(
    "separate original clock",
  );
});

test("rejects held live frames and changed terminal pixels", () => {
  const raw = fixture();
  const first = raw.duel.bindings[0];
  const last = raw.frames[899];
  if (first === undefined || last === undefined)
    throw new Error("Missing fixture frame");
  first.sourceFrame = 30;
  expect(() => validateDuelFrames(raw)).toThrow("Live native pixels");
  first.sourceFrame = 0;
  last.sha256 = "f".repeat(64);
  expect(() => validateDuelFrames(raw)).toThrow("Held pixels");
});

test("rejects stale, future and foreign native markers", () => {
  const raw = fixture();
  const frame = raw.duel.bindings[2];
  if (frame === undefined) throw new Error("Missing fixture frame");
  frame.markerReceivedNanos++;
  expect(() => validateDuelFrames(raw)).toThrow("marker or render clock");
  frame.markerReceivedNanos--;
  frame.marker.match = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  expect(() => validateDuelFrames(raw)).toThrow("marker or render clock");
});

test("requires the newest received tick without using a future tick", () => {
  const raw = fixture();
  const frame = raw.duel.bindings[2];
  const first = raw.duel.clock.entries[1];
  const future = raw.duel.clock.entries[3];
  if (frame === undefined || first === undefined || future === undefined)
    throw new Error("Missing fixture marker");
  frame.marker = first.marker;
  frame.markerReceivedNanos = 0;
  expect(() => validateDuelFrames(raw)).toThrow("stale received marker");
  frame.marker = future.marker;
  frame.markerReceivedNanos = 100_000_000;
  expect(() => validateDuelFrames(raw)).toThrow("marker or render clock");
});
