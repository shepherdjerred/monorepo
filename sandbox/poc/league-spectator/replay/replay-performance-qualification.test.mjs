import { expect, test } from "bun:test";
import { LatestSpectatorDiagnostics } from "./latest-spectator-diagnostics.mjs";
import { qualifyReplayPerformance } from "./replay-performance-qualification.mjs";
import { runReplayPerformanceQualification } from "./tools/qualify-replay-performance.mjs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const subject = {
  replaySha256: "a".repeat(64),
  renderPackageManifestSha256: "b".repeat(64),
  gameBuild: "16.23.840.6595",
  protocol: "8bbfcd5af2bc92db",
  durationSeconds: 2,
};

function recording(rate, samples = 21) {
  const recorder = new LatestSpectatorDiagnostics({
    build: subject.gameBuild,
    protocol: subject.protocol,
    replayHash: subject.replaySha256,
    renderPackageManifestSha256: subject.renderPackageManifestSha256,
    frameScheduling: "reply-driven-owned-presentations-v2",
  });
  for (let index = 0; index < samples; index++) {
    const time = (index * subject.durationSeconds) / (samples - 1);
    const wallTime = (time * 1000) / rate;
    recorder.frame({
      wallTime,
      drawWallTime: wallTime,
      replayTime: time,
      presentedTime: time,
      desiredTime: time,
      drawId: index + 1,
      drawOrder: index + 1,
      epoch: 0,
      stateKey: String(time),
      worldStateKey: String(time),
      particleStateKey: String(index),
      cameraKey: "camera",
      simulationStepsAdvanced: 1,
      requestToPresentMs: 0,
      presentation: { requestedAt: wallTime, epoch: 0 },
      replayHash: subject.replaySha256,
      playing: true,
      speed: rate,
      width: 1920,
      height: 1080,
      pixelRatio: 1,
      mode: "shared effects",
      effectsEnabled: true,
      effectsVisible: true,
      effectPreparationActive: false,
      directEffectFrame: {
        requestId: index + 1,
        time,
        operation: "advance",
        metrics: {
          simulationSteps: index,
          simulationStepsAdvanced: 1,
          simulationMs: rate === 1 ? 2 : 5,
          geometryMs: 1,
          worldQueryMs: 1,
          workerOperationMs: 7,
          bookkeepingMs: 0,
          geometryUploadPreparationMs: 0,
          transport: {
            drawBufferBytes: 0,
            requestDeliveryMs: 0,
            workerQueueMs: 0,
            replyDeliveryMs: 0,
            roundTripMs: 7,
            deliveryIncludesScheduling: true,
          },
        },
      },
    });
  }
  return recorder.finish();
}
const run = (value, rate = 1, metadata = subject) =>
  qualifyReplayPerformance(metadata, [{ rate, recording: value }]);

test("recomputes both rate budgets without promoting declared summaries or exact60FPS into admission", () => {
  const one = recording(1),
    four = recording(4);
  one.cohorts = { invented: "ignored" };
  const result = qualifyReplayPerformance(subject, [
    { rate: 1, recording: one },
    { rate: 4, recording: four },
  ]);
  expect(result.status).toBe("measured");
  expect(
    result.rates.map((row) => row.worker.simulationAndGeometryP95Ms),
  ).toEqual([3, 6]);
  expect(result.rates.map((row) => row.worker.limitMs)).toEqual([4, 8]);
  expect(result.rates.map((row) => row.display.actualDrawFps)).toEqual([
    10, 40,
  ]);
  expect(result.scope.nativeAcceptanceEstablished).toBe(false);
  expect(result.scope.hostedAnonymousPlaybackEstablished).toBe(false);
});

test("missing rate and unbound historical package identity stay missing while preserving measurements", () => {
  const raw = recording(1);
  delete raw.contract.renderPackageManifestSha256;
  const result = run(raw);
  expect(result.status).toBe("missing");
  expect(result.rates[0].missing).toContain(
    "render_package_identity_not_recorded",
  );
  expect(result.rates[0].worker.simulationAndGeometryP95Ms).toBe(3);
  expect(result.rates[1].missing).toEqual(["rate_recording_missing"]);
});

test.each([
  "replaySha256",
  "renderPackageManifestSha256",
  "gameBuild",
  "protocol",
])("rejects mismatched %s", (key) => {
  const changed = {
    ...subject,
    [key]:
      key === "gameBuild"
        ? "16.24.840.6595"
        : "f".repeat(key === "protocol" ? 16 : 64),
  };
  expect(() => run(recording(1), 1, changed)).toThrow("identity");
});

test("duration, recording cap, display and preparation gaps cannot establish full duration", () => {
  const raw = recording(1);
  expect(
    run(raw, 1, { ...subject, durationSeconds: 3 }).rates[0].coverage
      .fullDurationObserved,
  ).toBe(false);
  expect(() => run(raw, 1, { ...subject, durationSeconds: 1 })).toThrow(
    "raw frame",
  );
  for (const mutation of [
    (r) => {
      r.boundary = "diagnostic-frame-capacity";
    },
    (r) => {
      r.frames[10].effectPreparationActive = true;
    },
    (r) => {
      r.frames.splice(10, 1);
    },
  ]) {
    const value = recording(1);
    mutation(value);
    expect(run(value).rates[0].status).toBe("missing");
  }
});

test("seeks alone and duplicate draws cannot establish a continuous playback span", () => {
  const raw = recording(1);
  for (const [index, row] of raw.frames.entries()) {
    row.epoch = index;
    row.presentation.epoch = index;
  }
  expect(run(raw).rates[0].coverage.fullDurationObserved).toBe(false);
  const duplicate = recording(1);
  duplicate.frames[10].drawId = duplicate.frames[9].drawId;
  expect(() => run(duplicate)).toThrow();
});

test("duplicate worker responses and nonfinite/negative timings cannot reweight p95", () => {
  for (const mutation of [
    (r) => {
      r.frames[10].directEffectFrame.requestId = 1;
    },
    (r) => {
      r.frames[10].directEffectFrame.metrics.geometryMs = -1;
    },
    (r) => {
      r.frames[10].directEffectFrame.metrics.simulationMs = Infinity;
    },
  ]) {
    const raw = recording(1);
    mutation(raw);
    expect(() => run(raw)).toThrow("worker");
  }
});

test("failed worker budgets differ from absent samples and camera redraws never count as advances", () => {
  const raw = recording(4);
  for (const row of raw.frames) row.directEffectFrame.metrics.simulationMs = 8;
  expect(run(raw, 4).rates[1].status).toBe("failed");
  expect(run(raw, 4).rates[1].worker.simulationAndGeometryP95Ms).toBe(9);
  for (const row of raw.frames) {
    row.directEffectFrame.operation = "camera";
    row.directEffectFrame.metrics.simulationMs = 0;
    row.directEffectFrame.metrics.simulationStepsAdvanced = 0;
    row.simulationStepsAdvanced = 0;
  }
  expect(run(raw, 4).rates[1].worker.samples).toBe(0);
  expect(run(raw, 4).rates[1].missing).toContain(
    "worker_advance_samples_missing",
  );
});

test("whole-match-sized raw arrays exceed historical recorder cap without being truncated", () => {
  const raw = recording(1);
  const template = raw.frames[0];
  raw.frames = Array.from({ length: 10002 }, (_, index) => {
    const time = (index * 2) / 10001;
    return {
      ...template,
      wallTime: time * 1000,
      drawWallTime: time * 1000,
      replayTime: time,
      presentedTime: time,
      desiredTime: time,
      drawId: index + 1,
      drawOrder: index + 1,
      stateKey: String(time),
      worldStateKey: String(time),
      particleStateKey: null,
      simulationStepsAdvanced: 0,
      presentation: { requestedAt: time * 1000, epoch: 0 },
      directEffectFrame: null,
    };
  });
  expect(run(raw).rates[0].display.selectedFrames).toBe(10002);
  expect(run(raw).rates[0].coverage.fullDurationObserved).toBe(true);
});

test("clock failure and wrong framebuffer remain distinct from absent qualification evidence", () => {
  const raw = recording(1);
  raw.frames[10].desiredTime += 0.01;
  expect(run(raw).rates[0].failures).toContain("replay_clock_discontinuity");
  const wrongDisplay = recording(1);
  for (const row of wrongDisplay.frames) row.width = 1280;
  expect(run(wrongDisplay).rates[0].missing).toContain(
    "playing_1080p_effect_frames_missing",
  );
  expect(
    run(recording(1), 1, { ...subject, renderPackageManifestSha256: null })
      .rates[0].missing,
  ).toContain("expected_render_package_identity_missing");
});

test.each([false, true])(
  "fast secondary observations cannot dilute a failing full-duration pass (second pass full: %s)",
  (complete) => {
    const raw = recording(1);
    for (const row of raw.frames)
      row.directEffectFrame.metrics.simulationMs = 5;
    const partial = recording(1, 501);
    if (!complete) partial.frames.pop();
    for (const row of partial.frames) {
      row.wallTime += 3000;
      row.drawWallTime += 3000;
      row.presentation.requestedAt += 3000;
      row.epoch = 1;
      row.presentation.epoch = 1;
      row.drawId += 21;
      row.drawOrder += 21;
      row.directEffectFrame.requestId += 21;
      row.directEffectFrame.metrics.simulationMs = 0;
      row.directEffectFrame.metrics.geometryMs = 0;
    }
    raw.frames.push(...partial.frames);
    const result = run(raw).rates[0];
    expect(result.worker.simulationAndGeometryP95Ms).toBe(6);
    expect(result.worker.samples).toBe(complete ? 522 : 21);
    expect(result.worker.measurementScope).toBe("full-duration-clock-spans");
    expect(result.display.disconnectedDiagnosticFrames).toBe(
      complete ? 0 : 500,
    );
    expect(result.diagnostics.allObservedSimulationAndGeometryP95Ms).toBe(0);
    expect(result.worker.fullSpanMeasurements).toHaveLength(complete ? 2 : 1);
    expect(result.status).toBe("failed");
  },
);

test("cadence uses draw timestamps and distant clock endpoints establish no rendered-coverage claim", () => {
  const raw = recording(1, 2);
  const result = run(raw).rates[0];
  expect(result.display.maximumObservedDrawGapMs).toBe(2000);
  expect(result.display.actualDrawFps).toBe(0.5);
  expect(result.coverage.continuousRenderedCoverageEstablished).toBe(false);
  const uneven = recording(1);
  for (let index = 0; index < uneven.frames.length; index++) {
    const row = uneven.frames[index];
    row.drawWallTime += index;
    row.requestToPresentMs = index;
  }
  expect(run(uneven).rates[0].display.actualDrawFps).toBeCloseTo(
    1000 / 101,
    10,
  );
  for (const row of uneven.frames) {
    row.drawWallTime = 2000;
    row.requestToPresentMs = 2000 - row.presentation.requestedAt;
  }
  expect(run(uneven).rates[0].display.actualDrawFps).toBeNull();
});

test("private CLI binds original recording bytes and creates only a new local result", async () => {
  const root = await realpath(tmpdir());
  const directory = await mkdtemp(join(root, "replay-performance-test-"));
  try {
    const rawFile = join(directory, "raw.json");
    const input = join(directory, "request.json");
    const output = join(directory, "result.json");
    const rawBytes = new TextEncoder().encode(JSON.stringify(recording(1)));
    const sha256 = new Bun.CryptoHasher("sha256")
      .update(rawBytes)
      .digest("hex");
    await Bun.write(rawFile, rawBytes);
    const request = {
      schemaVersion: 1,
      kind: "private-replay-performance-request",
      subject,
      runs: [{ rate: 1, file: "raw.json", sha256 }],
    };
    await Bun.write(input, JSON.stringify(request));
    const result = await runReplayPerformanceQualification(input, output);
    expect(result.rates[0].worker.simulationAndGeometryP95Ms).toBe(3);
    const saved = await Bun.file(output).json();
    expect(saved.inputs[rawFile]).toBe(sha256);
    expect(await Bun.file(rawFile).bytes()).toEqual(rawBytes);
    await expect(
      runReplayPerformanceQualification(input, output),
    ).rejects.toThrow("exist");
    await expect(
      runReplayPerformanceQualification(input, rawFile),
    ).rejects.toThrow("preserve");
    request.runs[0].sha256 = "f".repeat(64);
    await Bun.write(input, JSON.stringify(request));
    await expect(
      runReplayPerformanceQualification(input, join(directory, "bad.json")),
    ).rejects.toThrow("SHA-256");
    expect(await Bun.file(join(directory, "bad.json")).exists()).toBe(false);
  } finally {
    if (dirname(await realpath(directory)) !== root)
      throw Error("Temporary evidence escaped its owned root");
    await rm(directory, { recursive: true, force: true });
  }
});
