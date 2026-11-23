import {
  FRAME_SCHEDULING_POLICY,
  validateDisplayTickJoins,
} from "./latest-spectator-display-ticks.mjs";

const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const finite = Number.isFinite;
const positive = (value) => finite(value) && value > 0;
const p95 = (values) => {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
};
const fps = (intervals) => {
  const total = intervals.reduce((sum, value) => sum + value, 0);
  return total > 0 ? (1000 * intervals.length) / total : null;
};

export function validateReplayPerformanceSubject(subject) {
  if (
    !subject ||
    !digest(subject.replaySha256) ||
    !(
      subject.renderPackageManifestSha256 === null ||
      digest(subject.renderPackageManifestSha256)
    ) ||
    typeof subject.gameBuild !== "string" ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(subject.gameBuild) ||
    subject.gameBuild
      .split(".")
      .some((part) => String(Number(part)) !== part) ||
    typeof subject.protocol !== "string" ||
    !/^[a-f0-9]{16}$/.test(subject.protocol) ||
    !positive(subject.durationSeconds)
  )
    throw Error(
      "Exact replay/package digests, native build, protocol and duration required",
    );
}

function validateRecording(recording, subject) {
  const contract = recording?.contract;
  if (
    ![1, 2].includes(recording?.schema) ||
    recording.kind !== "browser-spectator-performance-recording" ||
    recording.scope?.browserRecorded !== true ||
    recording.scope?.passive !== true ||
    recording.scope?.acceptanceEstablished !== false ||
    !Array.isArray(recording.frames) ||
    !contract ||
    contract.build !== subject.gameBuild ||
    contract.protocol !== subject.protocol ||
    contract.replayHash !== subject.replaySha256 ||
    (contract.renderPackageManifestSha256 !== undefined &&
      subject.renderPackageManifestSha256 !== null &&
      contract.renderPackageManifestSha256 !==
        subject.renderPackageManifestSha256)
  )
    throw Error(
      "Raw recording identity does not match its replay/package subject",
    );
  if (recording.schema === 2) {
    if (contract.frameScheduling !== FRAME_SCHEDULING_POLICY)
      throw Error("Owned reply scheduling contract required");
    validateDisplayTickJoins(
      recording.displayTicks,
      recording.frames,
      contract,
    );
  }
}

function validateFrame(row, previous, subject) {
  if (
    !row ||
    ![row.wallTime, row.replayTime, row.presentedTime].every(finite) ||
    row.wallTime < 0 ||
    row.replayTime < 0 ||
    row.presentedTime < 0 ||
    row.replayTime > subject.durationSeconds + 0.001 ||
    row.presentedTime !== row.replayTime ||
    row.replayHash !== subject.replaySha256 ||
    !positive(row.speed) ||
    ![
      row.playing,
      row.effectsEnabled,
      row.effectsVisible,
      row.effectPreparationActive,
    ].every((value) => typeof value === "boolean") ||
    ![row.width, row.height].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    !positive(row.pixelRatio) ||
    (previous && row.wallTime < previous.wallTime)
  )
    throw Error(
      "Finite identified raw frame and monotonic browser clock required",
    );
}

function eligible(row, rate) {
  return (
    row.playing &&
    row.speed === rate &&
    row.width === 1920 &&
    row.height === 1080 &&
    row.pixelRatio === 1 &&
    row.mode === "shared effects" &&
    row.effectsEnabled &&
    row.effectsVisible &&
    !row.effectPreparationActive
  );
}

function workerSample(row, seen) {
  const frame = row.directEffectFrame;
  if (frame == null) return null;
  if (
    !Number.isSafeInteger(frame.requestId) ||
    frame.requestId < 1 ||
    seen.has(frame.requestId) ||
    frame.time !== row.presentedTime ||
    !["advance", "camera"].includes(frame.operation) ||
    ![frame.metrics?.simulationMs, frame.metrics?.geometryMs].every(
      (value) => finite(value) && value >= 0,
    ) ||
    (frame.operation === "camera" && frame.metrics.simulationMs !== 0)
  )
    throw Error(
      "Unique committed worker request with original simulation/geometry timings required",
    );
  seen.add(frame.requestId);
  return frame.operation === "advance"
    ? frame.metrics.simulationMs + frame.metrics.geometryMs
    : null;
}

function measureRun(recording, subject, rate) {
  validateRecording(recording, subject);
  const missing = [],
    failures = [],
    runs = [],
    intervals = [],
    diagnosticWorkerSamples = [],
    selectedRows = [];
  const seenWorkers = new Set();
  let previous = null,
    run = null,
    selected = 0,
    clockDiscontinuities = 0,
    skippedDraws = 0;
  const close = () => {
    if (run) runs.push(run);
    run = null;
  };
  for (const [index, row] of recording.frames.entries()) {
    validateFrame(row, previous, subject);
    const sample = workerSample(row, seenWorkers);
    if (sample !== null) diagnosticWorkerSamples.push(sample);
    const wasEligible = previous && eligible(previous, rate);
    if (!eligible(row, rate)) {
      close();
      previous = row;
      continue;
    }
    selected++;
    selectedRows.push({ index, row, sample });
    let continuous = false;
    if (wasEligible) {
      const sameEpoch = recording.schema === 1 || row.epoch === previous.epoch;
      const elapsed = row.wallTime - previous.wallTime;
      const clock = recording.schema === 2 ? "desiredTime" : "replayTime";
      const clockMatches =
        Math.abs(row[clock] - previous[clock] - (elapsed * rate) / 1000) <=
        0.000001;
      const consecutiveDraw =
        recording.schema === 2 && row.drawId === previous.drawId + 1;
      if (sameEpoch && !clockMatches) clockDiscontinuities++;
      if (sameEpoch && recording.schema === 2 && !consecutiveDraw)
        skippedDraws++;
      continuous =
        sameEpoch &&
        clockMatches &&
        consecutiveDraw &&
        elapsed > 0 &&
        row.presentedTime > previous.presentedTime;
      if (continuous)
        intervals.push({
          index,
          milliseconds: row.drawWallTime - previous.drawWallTime,
        });
    }
    if (!continuous) close();
    if (!run)
      run = {
        startSeconds: row.presentedTime,
        endSeconds: row.presentedTime,
        firstFrameIndex: index,
        lastFrameIndex: index,
        frames: 1,
      };
    else {
      run.endSeconds = row.presentedTime;
      run.lastFrameIndex = index;
      run.frames++;
    }
    previous = row;
  }
  close();
  const fullRuns = runs.filter(
    (value) =>
      value.frames > 1 &&
      value.startSeconds <= 0.001 &&
      value.endSeconds >= subject.durationSeconds - 0.001,
  );
  const fullDurationObserved = fullRuns.length > 0;
  const belongsToMeasurement = (index) =>
    !fullDurationObserved ||
    fullRuns.some(
      (value) =>
        index >= value.firstFrameIndex && index <= value.lastFrameIndex,
    );
  const measuredRows = selectedRows.filter(({ index }) =>
    belongsToMeasurement(index),
  );
  const worker = measuredRows.flatMap(({ sample }) =>
    sample === null ? [] : [sample],
  );
  const measuredIntervals = intervals
    .filter(
      ({ index }) =>
        belongsToMeasurement(index) && belongsToMeasurement(index - 1),
    )
    .map((row) => row.milliseconds);
  const measuredDrawIds = new Set(measuredRows.map(({ row }) => row.drawId));
  const ticks =
    recording.schema === 2
      ? recording.displayTicks.filter(
          (row) =>
            eligible(row, rate) &&
            row.desiredPlaying &&
            row.desiredSpeed === rate &&
            measuredDrawIds.has(row.drawId),
        )
      : [];
  let maximumRafGapMs = null;
  for (let index = 1; index < ticks.length; index++) {
    if (ticks[index].desiredEpoch === ticks[index - 1].desiredEpoch)
      maximumRafGapMs = Math.max(
        maximumRafGapMs ?? 0,
        ticks[index].rafTime - ticks[index - 1].rafTime,
      );
  }
  if (!fullDurationObserved)
    missing.push("continuous_full_duration_not_observed");
  if (recording.schema === 1) missing.push("owned_draw_identity_not_recorded");
  if (!selected) missing.push("playing_1080p_effect_frames_missing");
  if (recording.boundary != null) missing.push("recording_stopped_at_boundary");
  if (!worker.length) missing.push("worker_advance_samples_missing");
  if (recording.contract.renderPackageManifestSha256 === undefined)
    missing.push("render_package_identity_not_recorded");
  if (subject.renderPackageManifestSha256 === null)
    missing.push("expected_render_package_identity_missing");
  if (skippedDraws) missing.push("unobserved_draw_gap");
  if (clockDiscontinuities) failures.push("replay_clock_discontinuity");
  const fullSpanMeasurements = fullRuns.map((span) => {
    const samples = measuredRows
      .filter(
        ({ index, sample }) =>
          sample !== null &&
          index >= span.firstFrameIndex &&
          index <= span.lastFrameIndex,
      )
      .map(({ sample }) => sample);
    return {
      firstFrameIndex: span.firstFrameIndex,
      lastFrameIndex: span.lastFrameIndex,
      samples: samples.length,
      p95Ms: p95(samples),
    };
  });
  if (fullSpanMeasurements.some((span) => span.p95Ms === null))
    missing.push("full_duration_span_worker_samples_missing");
  const fullP95s = fullSpanMeasurements.flatMap((span) =>
    span.p95Ms === null ? [] : [span.p95Ms],
  );
  const measuredP95 = fullDurationObserved
      ? fullP95s.reduce((maximum, value) => Math.max(maximum ?? 0, value), null)
      : p95(worker),
    limitMs = rate === 1 ? 4 : 8;
  const budgetMet = measuredP95 === null ? null : measuredP95 <= limitMs;
  if (budgetMet === false) failures.push("worker_p95_budget_exceeded");
  return {
    rate,
    status: failures.length
      ? "failed"
      : missing.length
        ? "missing"
        : "measured",
    missing,
    failures,
    diagnostics: {
      pausedFrames: recording.frames.filter((row) => !row.playing).length,
      allObservedWorkerSamples: diagnosticWorkerSamples.length,
      allObservedSimulationAndGeometryP95Ms: p95(diagnosticWorkerSamples),
      includesSeeksAndOtherRates: true,
      usedForPlaybackBudget: false,
    },
    coverage: {
      fullDurationObserved,
      fullDurationObservedMeans:
        "clock-contiguous observation span, not continuous rendered coverage",
      continuousRenderedCoverageEstablished: false,
      observationRuns: runs,
      clockDiscontinuities,
      skippedDraws,
    },
    worker: {
      measurementScope: fullDurationObserved
        ? "full-duration-clock-spans"
        : "partial-observations-only",
      aggregation: fullDurationObserved
        ? "worst-full-span-p95"
        : "partial-observation-p95",
      fullSpanMeasurements,
      samples: worker.length,
      simulationAndGeometryP95Ms: measuredP95,
      limitMs,
      budgetMet,
    },
    display: {
      framebuffer: { width: 1920, height: 1080, pixelRatio: 1 },
      selectedFrames: selected,
      measuredFrames: measuredRows.length,
      disconnectedDiagnosticFrames: selected - measuredRows.length,
      measuredAdjacentDrawIntervals: measuredIntervals.length,
      recordedFrames: recording.frames.length,
      actualDrawFps: fps(measuredIntervals),
      maximumObservedDrawGapMs: measuredIntervals.length
        ? measuredIntervals.reduce((max, value) => Math.max(max, value), 0)
        : null,
      maximumObservedRafGapMs: maximumRafGapMs,
      targetFps: 60,
      targetIsReportedOnly: true,
      rafObservations: recording.schema === 2 ? ticks.length : null,
    },
  };
}

/** Offline recomputation of caller-supplied raw observations, never native admission. */
export function qualifyReplayPerformance(subject, inputs) {
  validateReplayPerformanceSubject(subject);
  if (
    !Array.isArray(inputs) ||
    inputs.some((row) => ![1, 4].includes(row.rate)) ||
    new Set(inputs.map((row) => row.rate)).size !== inputs.length
  )
    throw Error("At most one explicit recording per rate (1 and 4) required");
  const rates = [1, 4].map((rate) => {
    const input = inputs.find((row) => row.rate === rate);
    if (!input)
      return {
        rate,
        status: "missing",
        missing: ["rate_recording_missing"],
        failures: [],
      };
    return measureRun(input.recording, subject, rate);
  });
  return {
    schemaVersion: 1,
    kind: "private-replay-performance-qualification",
    subject: structuredClone(subject),
    rates,
    status: rates.some((row) => row.status === "failed")
      ? "failed"
      : rates.some((row) => row.status === "missing")
        ? "missing"
        : "measured",
    scope: {
      rawObservationsRecomputed: true,
      declaredSummariesTrusted: false,
      captureAuthenticityEstablished: false,
      framePacingAcceptanceEstablished: false,
      hostedAnonymousProofRequiredSeparately: true,
      hostedAnonymousPlaybackEstablished: false,
      nativeAcceptanceEstablished: false,
      productionAdmissionChanged: false,
    },
  };
}
