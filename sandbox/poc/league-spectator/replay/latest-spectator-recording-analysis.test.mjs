import { expect, test } from "bun:test";
import { LatestSpectatorDiagnostics } from "./latest-spectator-diagnostics.mjs";
import { DIRECT_EFFECT_PROGRAM_VERSION } from "./latest-direct-effect-runtime.mjs";
import { analyzeLatestSpectatorRecording } from "./latest-spectator-recording-analysis.mjs";

function fixture({
  speed = 1,
  enabled = true,
  width = 1920,
  pixelRatio = 1,
  slowClock = false,
  partial = false,
  longFrame = false,
  simulationMs = null,
  preparing = false,
} = {}) {
  const recorder = new LatestSpectatorDiagnostics({
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    runtime: "shared-retained-direct-effects",
    runtimeProgramVersion: DIRECT_EFFECT_PROGRAM_VERSION,
    longTasksSupported: true,
    gpuTimerSupported: false,
    replayHash: "a".repeat(64),
    effectsManifestSha256: "b".repeat(64),
    sceneManifestSha256: "c".repeat(64),
    comparisonWindow: [69, 99],
  });
  let wallTime = 0;
  for (let index = 0; index <= (partial ? 20 : 302); index++) {
    const replayTime =
      68.9 + index * 0.1 + (longFrame && index >= 30 ? 0.1 : 0);
    if (index)
      wallTime +=
        (100 / speed) * (slowClock || (longFrame && index === 30) ? 2 : 1);
    recorder.frame({
      wallTime,
      replayHash: "a".repeat(64),
      replayTime,
      presentedTime: replayTime,
      mode: "shared effects",
      playing: true,
      speed,
      effectsEnabled: enabled,
      effectsVisible: enabled,
      effectPreparationActive: preparing === true || preparing === index,
      width,
      height: 1080,
      pixelRatio,
      worldUpdateAndHudMs: 1,
      effectCommitMs: 0.1,
      renderSubmissionMs: 1,
      cameraPosition: [index, 1, 2],
      cameraQuaternion: [0, 0, 0, 1],
      followEntityId: index < 20 ? 1 : 2,
      directEffectFrame: enabled
        ? {
            requestId: index + 1,
            time: replayTime,
            operation: "advance",
            metrics: {
              simulationMs: simulationMs ?? (speed === 4 ? 4 : 2),
              geometryMs: 1,
              worldQueryMs: 0.5,
              workerOperationMs: simulationMs === null ? 6 : simulationMs + 2,
              bookkeepingMs: 1,
              geometryUploadPreparationMs: 0.1,
              transport: {
                drawBufferBytes: 100,
                requestDeliveryMs: 0,
                workerQueueMs: 0,
                replyDeliveryMs: 0,
                roundTripMs: 6,
                deliveryIncludesScheduling: true,
              },
            },
          }
        : null,
    });
  }
  return recorder.finish();
}

test("recomputes complete 1080p runs, clocks and the explicit 1x/4x worker limits", () => {
  for (const speed of [1, 4]) {
    const result = analyzeLatestSpectatorRecording(fixture({ speed })),
      row = result.measurements[speed === 1 ? "effects1x" : "effects4x"];
    expect(row.completeContinuousWindowObserved).toBe(true);
    expect(row.simulationAndGeometryP95Ms).toBe(speed === 1 ? 3 : 5);
    expect(row.simulationAndGeometryBudgetMet).toBe(true);
    expect(row.clockDiscontinuities).toHaveLength(0);
    expect(row.averageDisplayFps).toBeCloseTo(10 * speed, 8);
    expect(result.scope.fullAcceptanceEstablished).toBe(false);
    expect(result.scope.effectsInducedStallAttribution).toBe(false);
  }
});

test("partial windows, wrong framebuffer and a slow replay clock never establish timing gates", () => {
  for (const options of [
    { partial: true },
    { width: 1280 },
    { pixelRatio: 2 },
    { slowClock: true },
  ]) {
    const row = analyzeLatestSpectatorRecording(fixture(options)).measurements
      .effects1x;
    expect(row.completeContinuousWindowObserved).toBe(false);
    expect(row.simulationAndGeometryBudgetMet).toBeNull();
    expect(row.averageDisplayFps).toBeNull();
  }
  expect(
    analyzeLatestSpectatorRecording(fixture({ slowClock: true })).measurements
      .effects1x.clockDiscontinuities.length,
  ).toBeGreaterThan(100);
});

test("a long display interval with the correct replay clock remains in the measured full run", () => {
  const result = analyzeLatestSpectatorRecording(fixture({ longFrame: true }));
  expect(result.measurements.effects1x.completeContinuousWindowObserved).toBe(
    true,
  );
  expect(result.measurements.effects1x.clockDiscontinuities).toHaveLength(0);
  expect(result.measurements.effects1x.averageDisplayFps).toBeLessThan(10);
  expect(result.recomputedCohorts.effects1x.intervalMs.maximum).toBe(200);
  expect(result.recomputedCohorts.effects1x.intervalsOver100Ms).toBe(1);
});

test("preparation windows remain raw evidence and break ordinary timing qualification", () => {
  for (const speed of [1, 4]) {
    for (const preparing of [true, 150]) {
      const recording = fixture({ speed, preparing });
      const result = analyzeLatestSpectatorRecording(recording);
      const row = result.measurements[speed === 1 ? "effects1x" : "effects4x"];
      expect(row.completeContinuousWindowObserved).toBe(false);
      expect(row.simulationAndGeometryBudgetMet).toBeNull();
      expect(row.averageDisplayFps).toBeNull();
      expect(
        recording.frames.some((frame) => frame.effectPreparationActive),
      ).toBe(true);
      expect(result.recomputedCohorts).toEqual(recording.cohorts);
    }
  }
});

test("world-only measurement remains independent of effects simulation and does not synthesize a worker sample", () => {
  const result = analyzeLatestSpectatorRecording(fixture({ enabled: false }));
  expect(result.measurements.worldOnly.completeContinuousWindowObserved).toBe(
    true,
  );
  expect(result.measurements.worldOnly.simulationAdvanceSamples).toBe(0);
  expect(
    result.measurements.worldOnly.simulationAndGeometryBudgetMet,
  ).toBeNull();
  expect(result.measurements.effects1x.samples).toBe(0);
  expect(result.observations.followedEntityIds).toEqual([1, 2]);
  expect(result.observations.cameraChanged).toBe(true);
});

test("declared favorable summaries, interval rewriting and stale capture identities fail", () => {
  for (const change of [
    (r) => (r.cohorts.effects1x.directEffects.simulationAndGeometryMs.p95 = 0),
    (r) => (r.frames[2].intervalMs = 1),
    (r) => delete r.contract.sceneManifestSha256,
    (r) =>
      (r.contract.runtimeProgramVersion = DIRECT_EFFECT_PROGRAM_VERSION - 1),
    (r) => (r.frames[2].directEffectFrame.time = 72),
    (r) => (r.frames[2].width = NaN),
  ]) {
    const recording = fixture();
    change(recording);
    expect(() => analyzeLatestSpectatorRecording(recording)).toThrow();
  }
});

test("long-task numbers remain observations without assigning effects causation", () => {
  const recording = fixture();
  recording.longTasks.push({ startTime: 200, duration: 130 });
  const result = analyzeLatestSpectatorRecording(recording);
  expect(result.observations.longTasksOver100Ms).toBe(1);
  expect(result.observations.maximumLongTaskMs).toBe(130);
  expect(result.scope.effectsInducedStallAttribution).toBe(false);
});

test("complete runs retain failed timing budgets and unavailable long tasks remain unmeasured", () => {
  for (const speed of [1, 4]) {
    const result = analyzeLatestSpectatorRecording(
      fixture({ speed, simulationMs: speed === 1 ? 4 : 8 }),
    );
    expect(
      result.measurements[speed === 1 ? "effects1x" : "effects4x"]
        .simulationAndGeometryBudgetMet,
    ).toBe(false);
  }
  const recording = fixture();
  recording.contract.longTasksSupported = false;
  const result = analyzeLatestSpectatorRecording(recording);
  expect(result.observations.longTasksSupported).toBe(false);
  expect(result.observations.longTasksOver100Ms).toBeNull();
  recording.longTasks.push({ startTime: 200, duration: 130 });
  expect(() => analyzeLatestSpectatorRecording(recording)).toThrow(
    "Unavailable browser timing",
  );
});

function replyFixture() {
  const old = fixture();
  const recorder = new LatestSpectatorDiagnostics({
    ...old.contract,
    frameScheduling: "reply-driven-owned-presentations-v1",
  });
  old.frames.forEach((row, i) => {
    row.wallTime += 10;
    row.directEffectFrame.metrics.simulationSteps = i;
    row.directEffectFrame.metrics.simulationStepsAdvanced = 1;
    recorder.frame({
      ...row,
      drawId: i + 1,
      drawWallTime: row.wallTime,
      epoch: 0,
      stateKey: String(row.replayTime),
      worldStateKey: String(row.replayTime),
      particleStateKey: String(i),
      cameraKey: "camera",
      simulationStepsAdvanced: 1,
      requestToPresentMs: row.wallTime - (row.wallTime - 5),
      desiredTime: row.replayTime + 0.01,
      presentation: {
        epoch: 0,
        requestedAt: row.wallTime - 5,
        operation: "advance",
      },
    });
    for (const offset of [0, 50])
      recorder.displayTick({
        rafTime: row.wallTime + offset,
        wallTime: row.wallTime + offset,
        drawWallTime: row.wallTime,
        desiredTime: row.replayTime + offset / 1000,
        presentedTime: row.replayTime,
        drawId: i + 1,
        stateKey: String(row.replayTime),
        worldStateKey: String(row.replayTime),
        particleStateKey: String(i),
        cameraKey: "camera",
        epoch: 0,
        desiredEpoch: 0,
        desiredPlaying: true,
        desiredSpeed: 1,
        simulationStepsAdvanced: 1,
        requestToPresentMs: row.wallTime - (row.wallTime - 5),
        playing: true,
        speed: 1,
        replayHash: old.contract.replayHash,
        width: 1920,
        height: 1080,
        pixelRatio: 1,
        mode: "shared effects",
        effectsEnabled: true,
        effectsVisible: true,
        effectPreparationActive: false,
      });
  });
  return recorder.finish();
}
test("schema2 distinguishes heartbeat, actual draws and unique new states without reusing worker samples", () => {
  const raw = replyFixture(),
    result = analyzeLatestSpectatorRecording(raw),
    s = result.scheduling.effects1x;
  expect(raw.schema).toBe(2);
  expect(s.rafTickFps).toBeCloseTo(20, 6);
  expect(s.actualDrawFps).toBeCloseTo(10, 6);
  expect(s.uniqueNewStateFps).toBeLessThan(10.1);
  expect(s.repeatedTicks).toBeGreaterThan(290);
  expect(s.cameraOnlyTicks).toBe(0);
  expect(s.presentationLagReplaySeconds.p95).toBeCloseTo(0.05, 6);
  expect(result.measurements.effects1x.completeContinuousWindowObserved).toBe(
    true,
  );
  expect(result.measurements.effects1x.averageDisplayFps).toBeCloseTo(10, 6);
  expect(raw.cohorts.effects1x.directEffects.committedFrames).toBeLessThan(
    raw.displayTicks.length,
  );
});
test("schema2 recomputes heartbeat claims and rejects altered tick order/clock/state identities", () => {
  for (const mutate of [
    (r) => (r.scheduling.effects1x.uniqueNewStateFps = 60),
    (r) => (r.displayTicks[2].wallTime = 0),
    (r) => (r.displayTicks[3].drawId = 0),
    (r) => (r.displayTicks[2].stateKey = "invented"),
    (r) => (r.frames[3].drawId = 1),
    (r) => (r.frames[3].desiredTime = 0),
  ]) {
    const raw = replyFixture();
    mutate(raw);
    expect(() => analyzeLatestSpectatorRecording(raw)).toThrow();
  }
  const raw = replyFixture();
  delete raw.displayTicks;
  expect(() => analyzeLatestSpectatorRecording(raw)).toThrow();
});
