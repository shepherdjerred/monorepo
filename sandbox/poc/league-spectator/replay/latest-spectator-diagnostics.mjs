import {
  validateDisplayTick,
  validateDisplayTickJoins,
  summarizeDisplayTicks,
  FRAME_SCHEDULING_POLICY,
} from "./latest-spectator-display-ticks.mjs";
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const ordered = values.toSorted((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
};
const timings = (rows, key) => {
  const values = rows.map((row) => row[key]).filter(Number.isFinite);
  return {
    samples: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    maximum: values.length ? Math.max(...values) : null,
  };
};

// These measurements belong to one committed worker response. Do not reuse a
// renderer's retained metrics on world-only frames or join by replay time alone:
// a paused camera redraw can have the same time as a simulation advance.
function validateDirectFrame(row) {
  const frame = row.directEffectFrame;
  if (frame == null) return;
  if (
    row.mode !== "shared effects" ||
    !row.effectsEnabled ||
    !row.effectsVisible ||
    frame.time !== row.replayTime ||
    frame.time !== row.presentedTime ||
    !Number.isSafeInteger(frame.requestId) ||
    frame.requestId < 1 ||
    !["advance", "camera"].includes(frame.operation)
  )
    throw Error("Committed direct timings must identify their presented frame");
  for (const key of [
    "simulationMs",
    "geometryMs",
    "worldQueryMs",
    "workerOperationMs",
    "bookkeepingMs",
    "geometryUploadPreparationMs",
  ])
    if (!Number.isFinite(frame.metrics?.[key]) || frame.metrics[key] < 0)
      throw Error(`Invalid committed direct timing: ${key}`);
  const transport = frame.metrics.transport;
  for (const key of [
    "navPrepassCpuMs",
    "deferredCombatCommitMs",
    "packetSnapshotCpuMs",
  ])
    if (
      Object.hasOwn(frame.metrics, key) &&
      (!Number.isFinite(frame.metrics[key]) || frame.metrics[key] < 0)
    )
      throw Error(`Invalid committed direct timing: ${key}`);
  if (
    !Number.isSafeInteger(transport?.drawBufferBytes) ||
    transport.drawBufferBytes < 0 ||
    ![
      "requestDeliveryMs",
      "workerQueueMs",
      "replyDeliveryMs",
      "roundTripMs",
    ].every((key) => Number.isFinite(transport[key])) ||
    transport.deliveryIncludesScheduling !== true ||
    (frame.operation === "camera" && frame.metrics.simulationMs !== 0)
  )
    throw Error("Invalid committed direct transport or camera measurement");
}

function directTimings(rows) {
  const frames = rows.flatMap((row) =>
    row.directEffectFrame ? [row.directEffectFrame] : [],
  );
  const metrics = frames.map(({ metrics }) => ({
    ...metrics,
    simulationAndGeometryMs: metrics.simulationMs + metrics.geometryMs,
  }));
  return {
    committedFrames: frames.length,
    simulationAdvances: frames.filter((frame) => frame.operation === "advance")
      .length,
    cameraRedraws: frames.filter((frame) => frame.operation === "camera")
      .length,
    ...Object.fromEntries(
      [
        "simulationMs",
        "geometryMs",
        "simulationAndGeometryMs",
        "worldQueryMs",
        "workerOperationMs",
        "bookkeepingMs",
        "geometryUploadPreparationMs",
        "navPrepassCpuMs",
        "deferredCombatCommitMs",
        "packetSnapshotCpuMs",
      ].map((key) => [key, timings(metrics, key)]),
    ),
    transport: Object.fromEntries(
      [
        "requestDeliveryMs",
        "workerQueueMs",
        "replyDeliveryMs",
        "roundTripMs",
        "drawBufferBytes",
      ].map((key) => [
        key,
        timings(
          metrics.map((m) => m.transport),
          key,
        ),
      ]),
    ),
  };
}

// Passive browser evidence. Starting a recording never seeks, changes speed,
// disables effects, alters resolution or asks a worker to prepare a frame.
export class LatestSpectatorDiagnostics {
  constructor(contract) {
    this.contract = structuredClone(contract);
    this.frames = [];
    this.displayTicks = [];
    this.longTasks = [];
    this.boundary = null;
    this.closed = false;
  }
  frame(row) {
    if (this.closed) return;
    if (
      this.contract.replayHash &&
      row.replayHash !== this.contract.replayHash
    ) {
      this.boundary = "diagnostic-replay-changed";
      this.closed = true;
      return;
    }
    if (this.frames.length >= 10000) {
      this.boundary = "diagnostic-frame-capacity";
      this.closed = true;
      return;
    }
    const previous = this.frames.at(-1);
    if (
      !Number.isFinite(row.wallTime) ||
      !Number.isFinite(row.replayTime) ||
      (previous && row.wallTime <= previous.wallTime)
    )
      throw Error("Invalid spectator diagnostic frame clock");
    if (
      this.contract.frameScheduling === FRAME_SCHEDULING_POLICY &&
      (!Number.isFinite(row.desiredTime) ||
        row.desiredTime < row.presentedTime ||
        !Number.isSafeInteger(row.epoch) ||
        row.epoch < 0 ||
        !Number.isSafeInteger(row.drawId) ||
        row.drawId < 1 ||
        (previous && row.drawId <= previous.drawId) ||
        (row.directEffectFrame &&
          (!Number.isFinite(row.presentation?.requestedAt) ||
            row.presentation.requestedAt > row.wallTime ||
            row.presentation.epoch !== row.epoch)))
    )
      throw Error("Owned reply scheduling draw identity required");
    validateDirectFrame(row);
    const intervalMs = previous ? row.wallTime - previous.wallTime : null;
    const replayDelta = previous ? row.replayTime - previous.replayTime : null;
    this.frames.push(structuredClone({ ...row, intervalMs, replayDelta }));
  }
  displayTick(row) {
    if (this.closed) return;
    if (this.contract.frameScheduling !== FRAME_SCHEDULING_POLICY)
      throw Error("Display ticks require reply-driven scheduling contract");
    if (this.displayTicks.length >= 20000) {
      this.boundary = "diagnostic-display-capacity";
      this.closed = true;
      return;
    }
    validateDisplayTick(row, this.displayTicks.at(-1), this.contract);
    this.displayTicks.push(structuredClone(row));
  }
  longTask(row) {
    if (this.closed) return;
    if (this.longTasks.length >= 10000) {
      this.boundary = "diagnostic-long-task-capacity";
      this.closed = true;
      return;
    }
    this.longTasks.push({ startTime: row.startTime, duration: row.duration });
  }
  finish({ gpuTimings = null } = {}) {
    this.closed = true;
    if (this.contract.frameScheduling === FRAME_SCHEDULING_POLICY)
      validateDisplayTickJoins(this.displayTicks, this.frames, this.contract);
    const recordedFrames = new Map(
      this.frames.map((row) => [row.wallTime, row]),
    );
    const previousFrames = new Map(
      this.frames.map((row, index) => [row.wallTime, this.frames[index - 1]]),
    );
    const gpuByFrame = new Map();
    const gpuSampleJoins = {
      matchedSamples: 0,
      unrecordedSamples: 0,
      metadataMismatchSamples: 0,
      invalidDurationSamples: 0,
      duplicateSamples: 0,
    };
    for (const sample of gpuTimings?.samples ?? []) {
      const frame = recordedFrames.get(sample.wallTime);
      if (!frame) gpuSampleJoins.unrecordedSamples++;
      else if (
        !["replayHash", "replayTime", "mode"].every(
          (key) => sample[key] === frame[key],
        )
      )
        gpuSampleJoins.metadataMismatchSamples++;
      else if (!Number.isFinite(sample.gpuMs) || sample.gpuMs < 0)
        gpuSampleJoins.invalidDurationSamples++;
      else {
        const group = gpuByFrame.get(sample.wallTime) ?? [];
        group.push(sample);
        gpuByFrame.set(sample.wallTime, group);
      }
    }
    // A frame owns one whole-scene timer query. Ambiguous duplicate records
    // cannot establish its GPU duration; preserve them only in the raw export.
    const matchedGpuSamples = [...gpuByFrame.values()].flatMap((group) => {
      if (group.length === 1) return group;
      gpuSampleJoins.duplicateSamples += group.length;
      return [];
    });
    gpuSampleJoins.matchedSamples = matchedGpuSamples.length;
    const cohorts = {};
    for (const [name, predicate] of [
      [
        "worldOnly",
        (f) =>
          f.playing &&
          !f.effectsEnabled &&
          !f.effectsVisible &&
          !f.effectPreparationActive,
      ],
      ["effects1x", (f) => f.effectsEnabled && f.playing && f.speed === 1],
      ["effects4x", (f) => f.effectsEnabled && f.playing && f.speed === 4],
      ["paused", (f) => !f.playing],
    ]) {
      const window = this.contract.comparisonWindow;
      const rows = this.frames.filter(
        (row) =>
          predicate(row) &&
          (!window ||
            (row.replayTime >= window[0] && row.replayTime <= window[1])),
      );
      const wallTimes = new Set(rows.map((row) => row.wallTime));
      // A display interval spans two recorded frames. CPU/GPU work belongs to
      // its ending frame, but the interval cannot represent one cohort when
      // its start belongs to another cohort/window or render configuration.
      const intervalRows = rows.filter((row) => {
        const previous = previousFrames.get(row.wallTime);
        return (
          previous &&
          wallTimes.has(previous.wallTime) &&
          ["replayHash", "width", "height", "pixelRatio"].every(
            (key) => row[key] === previous[key],
          )
        );
      });
      cohorts[name] = {
        frames: rows.length,
        intervalMs: timings(intervalRows, "intervalMs"),
        excludedTransitionIntervals:
          rows.filter((row) => Number.isFinite(row.intervalMs)).length -
          intervalRows.length,
        worldUpdateAndHudMs: timings(rows, "worldUpdateAndHudMs"),
        effectCommitMs: timings(rows, "effectCommitMs"),
        renderSubmissionMs: timings(rows, "renderSubmissionMs"),
        directEffects: directTimings(rows),
        gpuMs: timings(
          matchedGpuSamples.filter((sample) => wallTimes.has(sample.wallTime)),
          "gpuMs",
        ),
        bufferingFrames: rows.filter((r) => r.mode === "buffering effects")
          .length,
        intervalsOver100Ms: intervalRows.filter((r) => r.intervalMs > 100)
          .length,
      };
    }
    return {
      schema: this.contract.frameScheduling === FRAME_SCHEDULING_POLICY ? 2 : 1,
      kind: "browser-spectator-performance-recording",
      contract: structuredClone(this.contract),
      boundary: this.boundary,
      cohorts,
      frames: structuredClone(this.frames),
      ...(this.contract.frameScheduling === FRAME_SCHEDULING_POLICY
        ? {
            displayTicks: structuredClone(this.displayTicks),
            scheduling: summarizeDisplayTicks(
              this.displayTicks,
              this.frames,
              this.contract,
            ),
          }
        : {}),
      longTasks: structuredClone(this.longTasks),
      gpuTimings: structuredClone(gpuTimings),
      gpuSampleJoins,
      scope: {
        browserRecorded: true,
        passive: true,
        gpuDurationMeasured: matchedGpuSamples.length > 0,
        gpuTimingsCoverWholeScene:
          matchedGpuSamples.length > 0 &&
          gpuTimings?.scope?.wholeScene === true,
        renderSubmissionIsCpuTime: true,
        effectCommitIsInitialStagingCpuTime: true,
        renderSubmissionIncludesNavigationAndDeferredCombatCommit: true,
        workerTimingsExcludeMainThreadNavigationAndCommit: true,
        worldUpdateIncludesHud: true,
        frameIntervalsRequireAdjacentMatchingFrames: true,
        directTimingsRequireCommittedFrameIdentity: true,
        transportIncludesSerializationAndScheduling: true,
        worldQueryIsIncludedInSimulation: true,
        effectsInducedStallAttribution: false,
        acceptanceEstablished: false,
      },
    };
  }
}
