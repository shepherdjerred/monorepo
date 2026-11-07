import { test, expect } from "bun:test";
import {
  validateDisplayTick,
  validateDisplayTickJoins,
  summarizeDisplayTicks,
} from "./latest-spectator-display-ticks.mjs";
const contract = {
  replayHash: "replay",
  comparisonWindow: [69, 99],
  initialDisplayBoundary: null,
};
function draw(id, wallTime, time = 70 + wallTime / 1000, patch = {}) {
  const steps = patch.steps ?? id - 1;
  const advanced = patch.advanced ?? 1;
  return {
    drawId: id,
    wallTime,
    drawWallTime: wallTime,
    epoch: 0,
    stateKey: String(time),
    worldStateKey: String(time),
    particleStateKey: String(steps),
    cameraKey: "camera",
    replayTime: time,
    presentedTime: time,
    desiredTime: time,
    mode: "shared effects",
    replayHash: "replay",
    width: 1920,
    height: 1080,
    pixelRatio: 1,
    playing: true,
    speed: 1,
    effectsEnabled: true,
    effectsVisible: true,
    effectPreparationActive: false,
    simulationStepsAdvanced: advanced,
    requestToPresentMs: 0,
    presentation: { requestedAt: wallTime, epoch: 0 },
    directEffectFrame: {
      operation: "advance",
      time,
      metrics: { simulationSteps: steps, simulationStepsAdvanced: advanced },
    },
    ...patch,
  };
}
function tick(d, wallTime = d.drawWallTime, patch = {}) {
  const row = {
    ...d,
    wallTime,
    rafTime: wallTime,
    desiredTime: 70 + wallTime / 1000,
    desiredEpoch: d.epoch,
    desiredPlaying: d.playing,
    desiredSpeed: d.speed,
    ...patch,
  };
  delete row.directEffectFrame;
  delete row.presentation;
  return row;
}
function changeTime(d, time) {
  return {
    ...d,
    replayTime: time,
    presentedTime: time,
    stateKey: String(time),
    worldStateKey: String(time),
    directEffectFrame: { ...d.directEffectFrame, time },
  };
}
test("61 RAF observations distinguish 30 submitted updates from 60 heartbeats", () => {
  const frames = Array.from({ length: 31 }, (_, i) =>
    draw(i + 1, (i * 1000) / 30),
  );
  const ticks = Array.from({ length: 61 }, (_, i) =>
    tick(frames[Math.floor(i / 2)], (i * 1000) / 60),
  );
  const s = summarizeDisplayTicks(ticks, frames, contract).effects1x;
  expect(s.rafTickFps).toBeCloseTo(60, 9);
  expect(s.actualDrawFps).toBeCloseTo(30, 9);
  expect(s.observedWorldTimeChangeFps).toBeCloseTo(30, 9);
  expect(s.observedParticleStepChangeFps).toBeCloseTo(30, 9);
  expect(s.repeatedTicks).toBe(30);
  expect(s.actualDraws).toBe(31);
  expect(s.simulationStepsAdvanced).toBe(31);
  expect(s.observedWorldTimeStates).toBe(31);
  expect(s.drawsNotObservedAtRaf).toBe(0);
});
test("every draw-stamp field must join exactly; unknown and foreign draw identities reject", () => {
  const d = draw(1, 0);
  const mutations = {
    presentedTime: 71,
    stateKey: "71",
    worldStateKey: "71",
    particleStateKey: "8",
    cameraKey: "other",
    epoch: 1,
    mode: "diagnostic",
    replayHash: "foreign",
    width: 1280,
    height: 720,
    pixelRatio: 2,
    playing: false,
    speed: 4,
    effectsEnabled: false,
    effectsVisible: false,
    effectPreparationActive: true,
    simulationStepsAdvanced: 0,
    requestToPresentMs: 5,
    drawWallTime: 1,
  };
  for (const [key, value] of Object.entries(mutations))
    expect(() =>
      validateDisplayTickJoins([tick(d, 2, { [key]: value })], [d], contract),
    ).toThrow();
  expect(() =>
    validateDisplayTickJoins([tick({ ...d, drawId: 2 })], [d], contract),
  ).toThrow("recorded draw");
  expect(() =>
    validateDisplayTick(tick(d, 2, { rafTime: NaN }), null, contract),
  ).toThrow();
  expect(() =>
    validateDisplayTick(
      tick(d, 3, { cameraKey: "mutated" }),
      tick(d, 2),
      contract,
    ),
  ).toThrow();
});
test("a pre-recording canvas is allowed only through the explicit initial boundary", () => {
  const boundary = draw(4, 5),
    d = draw(5, 10);
  const ticks = [tick(boundary, 6), tick(d, 10)];
  expect(() => validateDisplayTickJoins(ticks, [d], contract)).toThrow();
  const c = { ...contract, initialDisplayBoundary: boundary };
  expect(validateDisplayTickJoins(ticks, [d], c)).toEqual({
    recordedDraws: 1,
    matchedTicks: 2,
    initialBoundaryTicks: 1,
  });
  expect(() => validateDisplayTickJoins(ticks, [boundary, d], c)).toThrow(
    "boundary",
  );
  expect(() =>
    validateDisplayTickJoins([tick(boundary, 11)], [d], c),
  ).toThrow();
});
test("request latency, retained canvas age and unobserved submissions remain distinct", () => {
  const a = draw(1, 0),
    b = draw(2, 10),
    c = draw(3, 20, 70.02, {
      wallTime: 15,
      requestToPresentMs: 15,
      presentation: { requestedAt: 5, epoch: 0 },
    });
  const ticks = [tick(a), tick(c, 25)];
  const s = summarizeDisplayTicks(ticks, [a, b, c], contract).effects1x;
  expect(s.drawsNotObservedAtRaf).toBe(1);
  expect(s.requestToPresentMs.maximum).toBe(15);
  expect(s.retainedDrawAgeMs.maximum).toBe(5);
  expect(s.presentationLagReplaySeconds.maximum).toBeCloseTo(0.005, 9);
  expect(() =>
    validateDisplayTickJoins(
      ticks,
      [a, b, { ...c, requestToPresentMs: 5 }],
      contract,
    ),
  ).toThrow("latency");
});
test("new zero-step world time is distinct from camera-only and particle revisions", () => {
  const a = draw(1, 0);
  const b = draw(2, 10, a.presentedTime, {
    steps: 0,
    advanced: 0,
    cameraKey: "orbit",
    directEffectFrame: {
      operation: "camera",
      time: a.presentedTime,
      metrics: { simulationSteps: 0, simulationStepsAdvanced: 0 },
    },
  });
  const c = draw(3, 20, 70.02, { steps: 0, advanced: 0, cameraKey: "orbit" });
  const d = draw(4, 30, 70.02, { steps: 1, cameraKey: "orbit" });
  const s = summarizeDisplayTicks(
    [a, b, c, d].map((r) => tick(r)),
    [a, b, c, d],
    contract,
  ).effects1x;
  expect(s.cameraOnlyTicks).toBe(1);
  expect(s.observedWorldTimeChanges).toBe(1);
  expect(s.observedParticleStepChanges).toBe(1);
  expect(s.sameStateNewDrawTicks).toBe(0);
});
test("pause, seek epochs, rate changes and ineligible observations cannot bridge FPS intervals", () => {
  const rows = [
    draw(1, 0),
    draw(2, 10),
    draw(3, 1000, 71, { playing: false }),
    draw(4, 2000, 72),
    draw(5, 2010, 72.01),
    draw(6, 3000, 71, {
      epoch: 1,
      presentation: { epoch: 1, requestedAt: 3000 },
    }),
    draw(7, 3010, 71.01, {
      epoch: 1,
      presentation: { epoch: 1, requestedAt: 3010 },
    }),
    draw(8, 4000, 74, {
      speed: 4,
      epoch: 2,
      presentation: { epoch: 2, requestedAt: 4000 },
    }),
    draw(9, 4010, 74.04, {
      speed: 4,
      epoch: 2,
      presentation: { epoch: 2, requestedAt: 4010 },
    }),
  ];
  const ticks = rows.map((r) =>
    tick(r, r.drawWallTime, { desiredTime: r.presentedTime }),
  );
  const s = summarizeDisplayTicks(ticks, rows, contract);
  expect(s.effects1x.contiguousTickRuns).toHaveLength(3);
  expect(s.effects1x.measuredTickDurationMs).toBe(30);
  expect(s.effects1x.rafTickFps).toBe(100);
  expect(s.effects4x.rafTickFps).toBe(100);
  expect(s.paused.rafTickFps).toBeNull();
  const prep = rows.map((r) => ({ ...r }));
  prep[1].effectPreparationActive = true;
  const excluded = prep.map((r) =>
    tick(r, r.drawWallTime, { desiredTime: r.presentedTime }),
  );
  expect(
    summarizeDisplayTicks(excluded, prep, contract).effects1x
      .measuredTickDurationMs,
  ).toBe(20);
});
test("stale desired controls, viewport and preparation are excluded with raw evidence retained", () => {
  const frames = [draw(1, 0), draw(2, 10)];
  const variants = [
    { desiredEpoch: 1 },
    { desiredPlaying: false },
    { desiredSpeed: 4 },
  ];
  for (const patch of variants) {
    const s = summarizeDisplayTicks(
      [tick(frames[0]), tick(frames[1], 10, patch)],
      frames,
      contract,
    ).effects1x;
    expect(s.displayTicks).toBe(1);
    expect(s.actualDraws).toBe(2);
    expect(s.rafTickFps).toBeNull();
  }
  for (const patch of [
    { width: 1280 },
    { height: 720 },
    { pixelRatio: 2 },
    { effectPreparationActive: true },
    { mode: "diagnostic" },
  ]) {
    const f = frames.map((r) => ({ ...r, ...patch }));
    expect(
      summarizeDisplayTicks(
        f.map((r) => tick(r)),
        f,
        contract,
      ).effects1x.actualDraws,
    ).toBe(0);
  }
});
test("contradictory committed step counters and camera simulation are rejected", () => {
  const d = draw(1, 0);
  for (const patch of [
    { particleStateKey: "2" },
    { simulationStepsAdvanced: 5 },
    { directEffectFrame: { ...d.directEffectFrame, operation: "camera" } },
  ])
    expect(() =>
      validateDisplayTickJoins([], [{ ...d, ...patch }], contract),
    ).toThrow();
  const world = {
    ...d,
    directEffectFrame: null,
    particleStateKey: null,
    simulationStepsAdvanced: 0,
    presentation: null,
    requestToPresentMs: null,
    effectsEnabled: false,
    effectsVisible: false,
  };
  expect(
    summarizeDisplayTicks([tick(world)], [world], contract).worldOnly
      .actualDraws,
  ).toBe(1);
  expect(() =>
    validateDisplayTickJoins(
      [],
      [{ ...world, particleStateKey: "0" }],
      contract,
    ),
  ).toThrow();
});
test("a missing desired-clock interval splits rates rather than counting the seek/pause gap", () => {
  const frames = [
    draw(1, 0),
    draw(2, 10),
    draw(3, 5000, 71),
    draw(4, 5010, 71.01),
  ];
  const ticks = frames.map((r) =>
    tick(r, r.drawWallTime, { desiredTime: r.presentedTime }),
  );
  const s = summarizeDisplayTicks(ticks, frames, contract).effects1x;
  expect(s.contiguousTickRuns).toHaveLength(2);
  expect(s.contiguousDrawRuns).toHaveLength(2);
  expect(s.measuredTickDurationMs).toBe(20);
  expect(s.rafTickFps).toBe(100);
  expect(s.actualDrawFps).toBe(100);
});
