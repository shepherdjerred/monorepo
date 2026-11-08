import { expect, test } from "bun:test";
import { LatestSpectatorDiagnostics } from "./latest-spectator-diagnostics.mjs";

const directFrame = (overrides = {}) => ({
  wallTime: 1,
  replayHash: "replay-a",
  replayTime: 70,
  presentedTime: 70,
  mode: "shared effects",
  playing: true,
  effectsEnabled: true,
  effectsVisible: true,
  speed: 1,
  directEffectFrame: {
    requestId: 1,
    time: 70,
    operation: "advance",
    metrics: {
      simulationMs: 2,
      geometryMs: 3,
      worldQueryMs: 1,
      workerOperationMs: 6,
      bookkeepingMs: 1,
      geometryUploadPreparationMs: 4,
      transport: {
        drawBufferBytes: 1234,
        requestDeliveryMs: 0.5,
        workerQueueMs: 0,
        replyDeliveryMs: 0.75,
        roundTripMs: 7.25,
        deliveryIncludesScheduling: true,
      },
    },
  },
  ...overrides,
});

test("navigation and deferred commit timings retain raw values and separate CPU boundaries", () => {
  const recorder = new LatestSpectatorDiagnostics({
      comparisonWindow: [69, 99],
    }),
    row = directFrame();
  row.directEffectFrame.metrics.navPrepassCpuMs = 1.25;
  row.directEffectFrame.metrics.deferredCombatCommitMs = 2.5;
  row.directEffectFrame.metrics.packetSnapshotCpuMs = 0.25;
  recorder.frame(row);
  const r = recorder.finish();
  expect(r.frames[0].directEffectFrame.metrics.navPrepassCpuMs).toBe(1.25);
  expect(r.frames[0].directEffectFrame.metrics.packetSnapshotCpuMs).toBe(0.25);
  expect(r.cohorts.effects1x.directEffects.packetSnapshotCpuMs.maximum).toBe(
    0.25,
  );
  expect(r.cohorts.effects1x.directEffects.deferredCombatCommitMs.maximum).toBe(
    2.5,
  );
  expect(
    r.scope.renderSubmissionIncludesNavigationAndDeferredCombatCommit,
  ).toBe(true);
  expect(r.scope.workerTimingsExcludeMainThreadNavigationAndCommit).toBe(true);
  for (const key of [
    "navPrepassCpuMs",
    "deferredCombatCommitMs",
    "packetSnapshotCpuMs",
  ]) {
    const invalid = directFrame();
    invalid.directEffectFrame.metrics[key] = -1;
    expect(() => new LatestSpectatorDiagnostics({}).frame(invalid)).toThrow();
  }
});

test("committed direct timings retain same-time camera identity and separate worker, geometry and transport measurements", () => {
  const recorder = new LatestSpectatorDiagnostics({
    comparisonWindow: [69, 99],
  });
  const first = directFrame();
  recorder.frame(first);
  first.directEffectFrame.metrics.simulationMs = 999;
  const paused = directFrame({ wallTime: 18, playing: false });
  paused.directEffectFrame.requestId = 2;
  paused.directEffectFrame.operation = "camera";
  paused.directEffectFrame.metrics.simulationMs = 0;
  paused.directEffectFrame.metrics.worldQueryMs = 0;
  recorder.frame(paused);
  recorder.frame(
    directFrame({
      wallTime: 35,
      effectsEnabled: false,
      effectsVisible: false,
      directEffectFrame: null,
    }),
  );
  const result = recorder.finish();
  const one = result.cohorts.effects1x.directEffects;
  expect(one.committedFrames).toBe(1);
  expect(one.simulationAdvances).toBe(1);
  expect(one.cameraRedraws).toBe(0);
  expect(one.simulationMs.maximum).toBe(2);
  expect(one.geometryMs.maximum).toBe(3);
  expect(one.simulationAndGeometryMs.maximum).toBe(5);
  expect(one.worldQueryMs.maximum).toBe(1);
  expect(one.geometryUploadPreparationMs.maximum).toBe(4);
  expect(one.transport.drawBufferBytes.maximum).toBe(1234);
  expect(one.transport.replyDeliveryMs.maximum).toBe(0.75);
  expect(result.cohorts.paused.directEffects.cameraRedraws).toBe(1);
  expect(result.cohorts.paused.directEffects.simulationMs.maximum).toBe(0);
  expect(result.cohorts.worldOnly.directEffects.committedFrames).toBe(0);
  expect(result.cohorts.worldOnly.directEffects.simulationMs.p95).toBeNull();
  expect(result.scope.directTimingsRequireCommittedFrameIdentity).toBe(true);
  expect(result.scope.transportIncludesSerializationAndScheduling).toBe(true);
  expect(result.scope.worldQueryIsIncludedInSimulation).toBe(true);
  expect(result.scope.acceptanceEstablished).toBe(false);
});

test("foreign, stale and malformed direct measurements cannot enter a browser frame cohort", () => {
  for (const mutate of [
    (f) => (f.mode = "playback"),
    (f) => (f.effectsEnabled = false),
    (f) => (f.effectsVisible = false),
    (f) => (f.presentedTime = 71),
    (f) => (f.directEffectFrame.time = 69),
    (f) => (f.directEffectFrame.requestId = 0),
    (f) => (f.directEffectFrame.operation = "restore"),
    (f) => (f.directEffectFrame.metrics.simulationMs = NaN),
    (f) => (f.directEffectFrame.metrics.geometryMs = -1),
    (f) => delete f.directEffectFrame.metrics.geometryUploadPreparationMs,
    (f) => (f.directEffectFrame.metrics.transport.drawBufferBytes = 1.5),
    (f) => (f.directEffectFrame.metrics.transport.replyDeliveryMs = Infinity),
    (f) =>
      (f.directEffectFrame.metrics.transport.deliveryIncludesScheduling = false),
    (f) => (f.directEffectFrame.operation = "camera"),
  ]) {
    const recorder = new LatestSpectatorDiagnostics({});
    const frame = directFrame();
    mutate(frame);
    expect(() => recorder.frame(frame)).toThrow();
    expect(recorder.finish().frames).toHaveLength(0);
  }
});

test("separates the world-only baseline, speed, pause and buffering without hiding long frames", () => {
  const recorder = new LatestSpectatorDiagnostics({ build: "16.21.829.8620" });
  const frame = {
    wallTime: 0,
    replayTime: 69,
    effectsEnabled: false,
    effectsVisible: false,
    playing: true,
    speed: 1,
    mode: "playback",
    worldUpdateAndHudMs: 2,
    effectCommitMs: 0,
    renderSubmissionMs: 3,
  };
  recorder.frame(frame);
  recorder.frame({ ...frame, wallTime: 17, replayTime: 69.017 });
  recorder.frame({
    ...frame,
    wallTime: 160,
    effectsEnabled: true,
    mode: "buffering effects",
  });
  recorder.frame({
    ...frame,
    wallTime: 303,
    effectsEnabled: true,
  });
  recorder.frame({
    ...frame,
    wallTime: 320,
    effectsEnabled: true,
    effectsVisible: true,
    speed: 4,
  });
  recorder.frame({ ...frame, wallTime: 337, playing: false });
  recorder.longTask({ startTime: 20, duration: 130 });
  const result = recorder.finish();
  expect(result.cohorts.worldOnly.frames).toBe(2);
  expect(result.cohorts.effects1x.bufferingFrames).toBe(1);
  expect(result.cohorts.effects1x.intervalMs.maximum).toBe(143);
  expect(result.cohorts.effects1x.intervalMs.samples).toBe(1);
  expect(result.cohorts.effects1x.excludedTransitionIntervals).toBe(1);
  expect(result.cohorts.effects1x.intervalsOver100Ms).toBe(1);
  expect(result.frames[2].intervalMs).toBe(143);
  expect(result.cohorts.effects4x.frames).toBe(1);
  expect(result.cohorts.paused.frames).toBe(1);
  expect(result.longTasks[0].duration).toBe(130);
  expect(result.scope.acceptanceEstablished).toBe(false);
  result.frames[0].replayTime = 100;
  expect(recorder.finish().frames[0].replayTime).toBe(69);
});

test("cohort intervals require adjacent matching window, replay and framebuffer states while CPU and GPU work retain ending-frame attribution", () => {
  const recorder = new LatestSpectatorDiagnostics({
    comparisonWindow: [69, 99],
  });
  const frame = {
    replayHash: "replay-a",
    mode: "playback",
    replayTime: 70,
    playing: true,
    effectsEnabled: false,
    effectsVisible: false,
    speed: 1,
    width: 1920,
    height: 1080,
    pixelRatio: 1,
    worldUpdateAndHudMs: 2,
    effectCommitMs: 3,
    renderSubmissionMs: 4,
  };
  const rows = [
    { wallTime: 0, replayTime: 68 },
    { wallTime: 10, replayTime: 69 },
    { wallTime: 30, replayTime: 69.01 },
    { wallTime: 200, effectsEnabled: true },
    { wallTime: 360, effectsEnabled: true },
    { wallTime: 500, effectsEnabled: true, speed: 4 },
    { wallTime: 520, effectsEnabled: true, speed: 4 },
    { wallTime: 800, replayTime: 100, effectsEnabled: true, speed: 4 },
    { wallTime: 900, replayTime: 99, effectsEnabled: true, speed: 4 },
    { wallTime: 940, effectsEnabled: true, speed: 4, width: 1280 },
    { wallTime: 970, effectsEnabled: true, speed: 4, width: 1280 },
    {
      wallTime: 990,
      effectsEnabled: true,
      speed: 4,
      width: 1280,
      pixelRatio: 2,
    },
    {
      wallTime: 1005,
      effectsEnabled: true,
      speed: 4,
      width: 1280,
      pixelRatio: 2,
    },
    {
      wallTime: 1025,
      effectsEnabled: true,
      speed: 4,
      width: 1280,
      pixelRatio: 2,
      replayHash: "replay-b",
    },
    {
      wallTime: 1040,
      effectsEnabled: true,
      speed: 4,
      width: 1280,
      pixelRatio: 2,
      replayHash: "replay-b",
    },
  ].map((row) => ({ ...frame, ...row }));
  for (const row of rows) recorder.frame(row);
  const result = recorder.finish({
    gpuTimings: {
      samples: rows.map((row) => ({ ...row, gpuMs: 5 })),
      scope: { wholeScene: true },
    },
  });
  expect(result.cohorts.worldOnly.intervalMs).toEqual({
    samples: 1,
    p50: 20,
    p95: 20,
    maximum: 20,
  });
  expect(result.cohorts.worldOnly.excludedTransitionIntervals).toBe(1);
  expect(result.cohorts.effects1x.intervalMs).toEqual({
    samples: 1,
    p50: 160,
    p95: 160,
    maximum: 160,
  });
  expect(result.cohorts.effects1x.excludedTransitionIntervals).toBe(1);
  expect(result.cohorts.effects1x.intervalsOver100Ms).toBe(1);
  expect(result.cohorts.effects4x.intervalMs).toEqual({
    samples: 4,
    p50: 15,
    p95: 30,
    maximum: 30,
  });
  expect(result.cohorts.effects4x.excludedTransitionIntervals).toBe(5);
  expect(result.cohorts.effects4x.intervalsOver100Ms).toBe(0);
  for (const cohort of Object.values(result.cohorts)) {
    expect(cohort.worldUpdateAndHudMs.samples).toBe(cohort.frames);
    expect(cohort.effectCommitMs.samples).toBe(cohort.frames);
    expect(cohort.renderSubmissionMs.samples).toBe(cohort.frames);
    expect(cohort.gpuMs.samples).toBe(cohort.frames);
  }
  expect(result.frames.find((row) => row.wallTime === 900).intervalMs).toBe(
    100,
  );
  expect(result.frames.find((row) => row.wallTime === 200).intervalMs).toBe(
    170,
  );
  expect(result.scope.frameIntervalsRequireAdjacentMatchingFrames).toBe(true);
  expect(result.scope.acceptanceEstablished).toBe(false);
});

test("capacity exhaustion is reported and never masquerades as a complete sample", () => {
  const recorder = new LatestSpectatorDiagnostics({});
  for (let i = 0; i <= 10000; i++)
    recorder.frame({ wallTime: i, replayTime: i });
  expect(recorder.finish().boundary).toBe("diagnostic-frame-capacity");
  expect(recorder.finish().frames).toHaveLength(10000);
});

test("GPU durations join only recorded frames in their comparison-window cohorts", () => {
  const recorder = new LatestSpectatorDiagnostics({
    comparisonWindow: [69, 99],
  });
  const frame = {
    playing: true,
    effectsEnabled: true,
    effectsVisible: true,
    speed: 1,
  };
  for (const row of [
    { wallTime: 1, replayTime: 68 },
    { wallTime: 2, replayTime: 69 },
    { wallTime: 3, replayTime: 80, speed: 4 },
    { wallTime: 4, replayTime: 85, playing: false },
    {
      wallTime: 5,
      replayTime: 90,
      effectsEnabled: false,
      effectsVisible: false,
    },
    { wallTime: 6, replayTime: 99 },
    { wallTime: 7, replayTime: 100 },
  ])
    recorder.frame({ ...frame, ...row });
  const gpuTimings = {
    supported: true,
    samples: [
      { wallTime: 999, replayTime: 69, gpuMs: 1000 },
      { wallTime: 1, replayTime: 80, gpuMs: 900 },
      { wallTime: 2, replayTime: -1, gpuMs: 2 },
      { wallTime: 3, replayTime: 80, gpuMs: 4 },
      { wallTime: 4, replayTime: 85, gpuMs: 8 },
      { wallTime: 5, replayTime: 90, gpuMs: 16 },
      { wallTime: 6, replayTime: 99, gpuMs: 32 },
      { wallTime: 7, replayTime: 100, gpuMs: 800 },
    ],
  };
  const result = recorder.finish({ gpuTimings });
  expect(result.cohorts.effects1x.gpuMs).toEqual({
    samples: 1,
    p50: 32,
    p95: 32,
    maximum: 32,
  });
  expect(result.cohorts.effects4x.gpuMs.maximum).toBe(4);
  expect(result.cohorts.paused.gpuMs.maximum).toBe(8);
  expect(result.cohorts.worldOnly.gpuMs.maximum).toBe(16);
  expect(result.gpuTimings.samples).toHaveLength(8);
  expect(result.gpuSampleJoins).toEqual({
    matchedSamples: 5,
    unrecordedSamples: 1,
    metadataMismatchSamples: 2,
    invalidDurationSamples: 0,
    duplicateSamples: 0,
  });
  expect(result.scope.gpuDurationMeasured).toBe(true);
  expect(result.scope.effectsInducedStallAttribution).toBe(false);
  expect(result.scope.acceptanceEstablished).toBe(false);
  gpuTimings.samples[0].gpuMs = 0;
  expect(result.gpuTimings.samples[0].gpuMs).toBe(1000);
});

test("GPU summary rejects foreign metadata, ambiguous duplicates and invalid durations without discarding raw evidence", () => {
  const recorder = new LatestSpectatorDiagnostics({ replayHash: "replay-a" });
  const frame = {
    replayHash: "replay-a",
    replayTime: 70,
    mode: "playback",
    playing: true,
    effectsEnabled: true,
    speed: 1,
  };
  for (const wallTime of [1, 2, 3, 4]) recorder.frame({ ...frame, wallTime });
  const sample = { ...frame, wallTime: 1, gpuMs: 2 };
  const samples = [
    sample,
    { ...sample, replayHash: "replay-b", gpuMs: 0 },
    { ...sample, replayTime: 71, gpuMs: 0 },
    { ...sample, mode: "direct effect diagnostic", gpuMs: 0 },
    { ...sample, wallTime: 2, gpuMs: 1 },
    { ...sample, wallTime: 2, gpuMs: 100 },
    { ...sample, wallTime: 3, gpuMs: -1 },
    { ...sample, wallTime: 4, gpuMs: NaN },
  ];
  const result = recorder.finish({
    gpuTimings: { supported: true, samples, scope: { wholeScene: true } },
  });
  expect(result.cohorts.effects1x.gpuMs).toEqual({
    samples: 1,
    p50: 2,
    p95: 2,
    maximum: 2,
  });
  expect(result.gpuSampleJoins).toEqual({
    matchedSamples: 1,
    unrecordedSamples: 0,
    metadataMismatchSamples: 3,
    invalidDurationSamples: 2,
    duplicateSamples: 2,
  });
  expect(result.gpuTimings.samples).toHaveLength(samples.length);
  expect(result.scope.gpuDurationMeasured).toBe(true);
  expect(result.scope.gpuTimingsCoverWholeScene).toBe(true);
  expect(result.scope.effectsInducedStallAttribution).toBe(false);
  expect(result.scope.acceptanceEstablished).toBe(false);
});

test("unsupported and pending GPU measurements retain empty timing summaries and independent exports", () => {
  const contract = { comparisonWindow: [69, 99] };
  const recorder = new LatestSpectatorDiagnostics(contract);
  contract.comparisonWindow[0] = 100;
  recorder.frame({
    wallTime: 1,
    replayTime: 69,
    playing: true,
    effectsEnabled: true,
    speed: 1,
  });
  const gpuTimings = {
    supported: false,
    boundary: "gpu-timer-extension-unavailable",
    samples: [],
    pendingWhenStopped: 0,
  };
  const result = recorder.finish({ gpuTimings });
  expect(result.cohorts.effects1x.frames).toBe(1);
  expect(result.cohorts.effects1x.gpuMs).toEqual({
    samples: 0,
    p50: null,
    p95: null,
    maximum: null,
  });
  expect(result.scope.gpuDurationMeasured).toBe(false);
  expect(result.scope.gpuTimingsCoverWholeScene).toBe(false);
  expect(result.scope.acceptanceEstablished).toBe(false);
  result.gpuTimings.boundary = "caller mutation";
  result.contract.comparisonWindow[0] = 100;
  const repeated = recorder.finish({ gpuTimings });
  expect(repeated.gpuTimings.boundary).toBe("gpu-timer-extension-unavailable");
  expect(repeated.contract.comparisonWindow[0]).toBe(69);
  expect(repeated.cohorts.effects1x.frames).toBe(1);
});
