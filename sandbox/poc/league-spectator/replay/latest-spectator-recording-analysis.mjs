import { FRAME_SCHEDULING_POLICY } from "./latest-spectator-display-ticks.mjs";
import { LatestSpectatorDiagnostics } from "./latest-spectator-diagnostics.mjs";
import { DIRECT_EFFECT_PROGRAM_VERSION } from "./latest-direct-effect-runtime.mjs";
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";

const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const inWindow = (row) => row.replayTime >= 69 && row.replayTime <= 99;
const cohorts = {
  worldOnly: (row) =>
    row.playing &&
    row.speed === 1 &&
    !row.effectsEnabled &&
    !row.effectsVisible &&
    !row.effectPreparationActive,
  effects1x: (row) => row.playing && row.speed === 1 && row.effectsEnabled,
  effects4x: (row) => row.playing && row.speed === 4 && row.effectsEnabled,
};
const matchingDisplay = (a, b) =>
  ["width", "height", "pixelRatio", "replayHash"].every(
    (key) => a[key] === b[key],
  );
const referenceDisplay = (row) =>
  row.width === 1920 && row.height === 1080 && row.pixelRatio === 1;
const ordinary = (row) =>
  row.mode === "shared effects" &&
  !row.effectPreparationActive &&
  row.replayTime === row.presentedTime &&
  (!row.effectsEnabled ||
    (row.effectsVisible &&
      row.directEffectFrame !== null &&
      row.directEffectFrame !== undefined));
const vector = (value, size) =>
  Array.isArray(value) && value.length === size && value.every(finite);

// Exported browser data is evidence supplied by the caller, not an authenticated
// recording. Recompute its summaries; never promote declared counts into proof.
export function analyzeLatestSpectatorRecording(recording) {
  assertDirectCompiledDataGraph(recording);
  const contract = recording?.contract;
  if (
    ![1, 2].includes(recording?.schema) ||
    (recording.schema === 2
      ? contract?.frameScheduling !== FRAME_SCHEDULING_POLICY
      : contract?.frameScheduling !== undefined) ||
    recording.kind !== "browser-spectator-performance-recording" ||
    recording.scope?.browserRecorded !== true ||
    recording.scope?.passive !== true ||
    recording.scope?.acceptanceEstablished !== false ||
    contract?.build !== "16.21.829.8620" ||
    contract.protocol !== "20e09df23c66b85e" ||
    contract.runtime !== "shared-retained-direct-effects" ||
    contract.runtimeProgramVersion !== DIRECT_EFFECT_PROGRAM_VERSION ||
    typeof contract.longTasksSupported !== "boolean" ||
    typeof contract.gpuTimerSupported !== "boolean" ||
    ![
      contract.replayHash,
      contract.effectsManifestSha256,
      contract.sceneManifestSha256,
    ].every(digest) ||
    !sameDirectCompiledData(contract.comparisonWindow, [69, 99]) ||
    !Array.isArray(recording.frames) ||
    recording.frames.length > 10000 ||
    !Array.isArray(recording.longTasks) ||
    recording.longTasks.length > 10000
  )
    throw Error(
      "Identified current-build passive browser recording required; re-record missing runtime/scene identity",
    );
  if (
    (!contract.longTasksSupported && recording.longTasks.length) ||
    (!contract.gpuTimerSupported && recording.gpuTimings?.samples?.length)
  )
    throw Error(
      "Unavailable browser timing source cannot contain measured observations",
    );
  const recorder = new LatestSpectatorDiagnostics(contract);
  for (const row of recording.frames) {
    if (
      !finite(row.presentedTime) ||
      row.presentedTime < 0 ||
      !finite(row.speed) ||
      row.speed <= 0 ||
      ![
        row.playing,
        row.effectsEnabled,
        row.effectsVisible,
        row.effectPreparationActive,
      ].every((value) => typeof value === "boolean") ||
      !Number.isInteger(row.width) ||
      row.width < 1 ||
      row.width > 16384 ||
      !Number.isInteger(row.height) ||
      row.height < 1 ||
      row.height > 16384 ||
      !finite(row.pixelRatio) ||
      row.pixelRatio <= 0 ||
      row.pixelRatio > 8 ||
      !vector(row.cameraPosition, 3) ||
      !vector(row.cameraQuaternion, 4) ||
      !(
        row.followEntityId === null ||
        (Number.isInteger(row.followEntityId) &&
          row.followEntityId > 0 &&
          row.followEntityId <= 0xffffffff)
      ) ||
      typeof row.mode !== "string" ||
      !row.mode.length ||
      row.mode.length > 128 ||
      ![
        row.worldUpdateAndHudMs,
        row.effectCommitMs,
        row.renderSubmissionMs,
      ].every((value) => finite(value) && value >= 0)
    )
      throw Error(
        "Complete browser framebuffer, clock and CPU measurement required",
      );
    recorder.frame(row);
  }
  for (const row of recording.longTasks) {
    if (
      !finite(row.startTime) ||
      row.startTime < 0 ||
      !finite(row.duration) ||
      row.duration < 0
    )
      throw Error("Finite browser long-task observation required");
    recorder.longTask(row);
  }
  if (recording.schema === 2) {
    if (
      !Array.isArray(recording.displayTicks) ||
      recording.displayTicks.length > 20000
    )
      throw Error("Bounded raw display ticks required");
    for (const row of recording.displayTicks) recorder.displayTick(row);
  }
  const recomputed = recorder.finish({ gpuTimings: recording.gpuTimings });
  if (
    !sameDirectCompiledData(recomputed.cohorts, recording.cohorts) ||
    (recording.schema === 2 &&
      (!sameDirectCompiledData(
        recomputed.displayTicks,
        recording.displayTicks,
      ) ||
        !sameDirectCompiledData(
          recomputed.scheduling,
          recording.scheduling,
        ))) ||
    !sameDirectCompiledData(recomputed.frames, recording.frames) ||
    !sameDirectCompiledData(recomputed.gpuSampleJoins, recording.gpuSampleJoins)
  )
    throw Error(
      "Recorded summaries or frame intervals differ from raw browser observations",
    );
  const measurements = {};
  for (const [name, predicate] of Object.entries(cohorts)) {
    const intervals = [],
      mismatches = [],
      runs = [];
    let run = null;
    const close = () => {
      if (run) runs.push(run);
      run = null;
    };
    for (let index = 0; index < recording.frames.length; index++) {
      const row = recording.frames[index],
        previous = recording.frames[index - 1];
      const eligible = predicate(row) && referenceDisplay(row) && ordinary(row);
      if (!eligible) {
        close();
        continue;
      }
      const same =
        previous &&
        predicate(previous) &&
        referenceDisplay(previous) &&
        ordinary(previous) &&
        matchingDisplay(previous, row);
      const expected = same
        ? ((row.wallTime - previous.wallTime) * row.speed) / 1000
        : null;
      const error = same
        ? (recording.schema === 2
            ? row.desiredTime - previous.desiredTime
            : row.replayTime - previous.replayTime) - expected
        : null;
      // Ordinary Play adds the full rAF interval to its double replay clock.
      // This numerical tolerance is one microsecond, not a slow-motion allowance.
      const continuous =
        same &&
        Math.abs(error) <= 0.000001 &&
        (recording.schema === 1 ||
          (row.epoch === previous.epoch &&
            row.replayTime >= previous.replayTime));
      if (same && inWindow(row) && inWindow(previous)) {
        intervals.push({
          frameIndex: index,
          milliseconds: row.wallTime - previous.wallTime,
        });
        if (!continuous)
          mismatches.push({
            frameIndex: index,
            replayTime: row.replayTime,
            replayDelta: row.replayTime - previous.replayTime,
            expectedReplayDelta: expected,
          });
      }
      if (!continuous) close();
      if (!run)
        run = {
          firstFrame: index,
          startTime: row.replayTime,
          endTime: row.replayTime,
          frames: 1,
        };
      else {
        run.endTime = row.replayTime;
        run.frames++;
      }
    }
    close();
    const samples = recording.frames.filter(
      (row) => predicate(row) && inWindow(row),
    );
    const complete = runs.filter(
      (row) => row.startTime <= 69 && row.endTime >= 99,
    );
    const belongsToCompleteRun = (index) =>
      complete.some(
        (run) => index >= run.firstFrame && index < run.firstFrame + run.frames,
      );
    const measuredIntervals = intervals.filter(
      (row) =>
        belongsToCompleteRun(row.frameIndex) &&
        belongsToCompleteRun(row.frameIndex - 1),
    );
    const advances = recording.frames.filter(
      (row, index) =>
        inWindow(row) &&
        belongsToCompleteRun(index) &&
        row.directEffectFrame?.operation === "advance",
    );
    const limit = name === "effects1x" ? 4 : name === "effects4x" ? 8 : null;
    const sorted = advances
      .map(
        (row) =>
          row.directEffectFrame.metrics.simulationMs +
          row.directEffectFrame.metrics.geometryMs,
      )
      .sort((a, b) => a - b);
    const p95 = sorted.length
      ? sorted[Math.ceil(sorted.length * 0.95) - 1]
      : null;
    measurements[name] = {
      samples: samples.length,
      fullReferenceDisplayRuns: complete,
      completeContinuousWindowObserved: complete.length > 0,
      incompleteOrNonReferenceDisplayFrames: samples.filter(
        (row) => !referenceDisplay(row) || !ordinary(row),
      ).length,
      referenceDisplayIntervals: intervals.length,
      measuredCompleteRunIntervals: measuredIntervals.length,
      averageDisplayFps: measuredIntervals.length
        ? (1000 * measuredIntervals.length) /
          measuredIntervals.reduce((sum, row) => sum + row.milliseconds, 0)
        : null,
      targetDisplayFps: 60,
      averageDisplayFpsMeans:
        recording.schema === 2
          ? "actual GPU submissions, not RAF ticks"
          : "recorded display frames",
      clockDiscontinuities: mismatches,
      clockDiscontinuityCauseEstablished: false,
      simulationAdvanceSamples: sorted.length,
      simulationAndGeometryP95Ms: p95,
      simulationAndGeometryLimitMs: limit,
      simulationAndGeometryBudgetMet:
        limit === null || p95 === null ? null : p95 <= limit,
      maximumCpuSubmissionMs: samples.length
        ? Math.max(...samples.map((row) => row.renderSubmissionMs))
        : null,
    };
  }
  const paused = recording.frames.filter(
    (row) => !row.playing && inWindow(row),
  );
  const moved = recording.frames
    .slice(1)
    .some(
      (row, index) =>
        !sameDirectCompiledData(
          row.cameraPosition,
          recording.frames[index].cameraPosition,
        ) ||
        !sameDirectCompiledData(
          row.cameraQuaternion,
          recording.frames[index].cameraQuaternion,
        ),
    );
  return {
    schema: recording.schema,
    scheduling: recording.schema === 2 ? recomputed.scheduling : null,
    kind: "recomputed-browser-spectator-measurements",
    contract: structuredClone(contract),
    boundary: recording.boundary,
    measurements,
    recomputedCohorts: recomputed.cohorts,
    observations: {
      pausedFrames: paused.length,
      cameraChanged: moved,
      followedEntityIds: [
        ...new Set(
          recording.frames
            .map((row) => row.followEntityId)
            .filter((value) => value !== null && value !== undefined),
        ),
      ],
      longTasksSupported: contract.longTasksSupported,
      longTasksOver100Ms: contract.longTasksSupported
        ? recording.longTasks.filter((row) => row.duration > 100).length
        : null,
      maximumLongTaskMs:
        contract.longTasksSupported && recording.longTasks.length
          ? Math.max(...recording.longTasks.map((row) => row.duration))
          : null,
    },
    scope: {
      rawSummariesRecomputed: true,
      declaredSummariesTrusted: false,
      browserCaptureAuthenticityEstablished: false,
      performanceWindowRequiresContinuousReferenceDisplayRun: true,
      clockDiscontinuitiesMayIncludeUserSeeks: true,
      orbitPanAndZoomSeparatelyEstablished: false,
      effectsInducedStallAttribution: false,
      renderedCoverageEstablished: false,
      nativeFidelityEstablished: false,
      fullAcceptanceEstablished: false,
    },
  };
}
