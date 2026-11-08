export const FRAME_SCHEDULING_POLICY = "reply-driven-owned-presentations-v1";
const finite = Number.isFinite;
const unsigned = (v) => Number.isSafeInteger(v) && v >= 0;
const DRAW_FIELDS = [
  "drawId",
  "drawWallTime",
  "epoch",
  "stateKey",
  "worldStateKey",
  "particleStateKey",
  "cameraKey",
  "presentedTime",
  "mode",
  "replayHash",
  "width",
  "height",
  "pixelRatio",
  "playing",
  "speed",
  "effectsEnabled",
  "effectsVisible",
  "effectPreparationActive",
  "simulationStepsAdvanced",
  "requestToPresentMs",
];
function sameStamp(a, b) {
  return DRAW_FIELDS.every((key) => Object.is(a[key], b[key]));
}
function validateStamp(row, contract) {
  if (
    !row ||
    !unsigned(row.drawId) ||
    row.drawId < 1 ||
    !unsigned(row.epoch) ||
    ![row.drawWallTime, row.presentedTime, row.speed, row.pixelRatio].every(
      finite,
    ) ||
    row.drawWallTime < 0 ||
    row.presentedTime < 0 ||
    row.speed <= 0 ||
    row.pixelRatio <= 0 ||
    ![
      row.playing,
      row.effectsEnabled,
      row.effectsVisible,
      row.effectPreparationActive,
    ].every((v) => typeof v === "boolean") ||
    !Number.isInteger(row.width) ||
    row.width < 1 ||
    !Number.isInteger(row.height) ||
    row.height < 1 ||
    typeof row.mode !== "string" ||
    !row.mode.length ||
    typeof row.cameraKey !== "string" ||
    !row.cameraKey.length ||
    row.replayHash !== contract.replayHash ||
    row.stateKey !== String(row.presentedTime) ||
    row.worldStateKey !== row.stateKey ||
    !(
      row.particleStateKey === null ||
      (typeof row.particleStateKey === "string" &&
        unsigned(Number(row.particleStateKey)) &&
        String(Number(row.particleStateKey)) === row.particleStateKey)
    ) ||
    !unsigned(row.simulationStepsAdvanced) ||
    !(
      row.requestToPresentMs === null ||
      (finite(row.requestToPresentMs) && row.requestToPresentMs >= 0)
    )
  )
    throw Error(
      "Identified draw stamp with exact replay/configuration metadata required",
    );
}
export function validateDisplayTick(row, previous, contract) {
  validateStamp(row, contract);
  if (
    ![row.wallTime, row.rafTime, row.desiredTime, row.desiredSpeed].every(
      finite,
    ) ||
    row.wallTime < row.drawWallTime ||
    row.rafTime < 0 ||
    row.wallTime < row.rafTime ||
    row.desiredTime < 0 ||
    row.desiredSpeed <= 0 ||
    !unsigned(row.desiredEpoch) ||
    typeof row.desiredPlaying !== "boolean" ||
    (previous &&
      (row.wallTime <= previous.wallTime ||
        row.rafTime <= previous.rafTime ||
        row.drawId < previous.drawId ||
        (row.drawId === previous.drawId && !sameStamp(row, previous)) ||
        (row.desiredEpoch === previous.desiredEpoch &&
          row.desiredTime < previous.desiredTime)))
  )
    throw Error("Identified monotonic display tick required");
}
// Draw identity is resolved only against recorded submissions or the explicit
// pre-recording boundary. Retained canvas observations do not invent draws.
export function validateDisplayTickJoins(ticks, frames, contract) {
  if (!Array.isArray(ticks) || !Array.isArray(frames))
    throw Error("Raw display ticks and draw frames required");
  const draws = new Map();
  let previous = null;
  for (const row of frames) {
    validateStamp(row, contract);
    if (
      !finite(row.wallTime) ||
      row.wallTime < 0 ||
      !finite(row.desiredTime) ||
      row.desiredTime < 0 ||
      row.wallTime > row.drawWallTime ||
      !Object.is(row.replayTime, row.presentedTime) ||
      draws.has(row.drawId) ||
      (previous &&
        (row.drawId <= previous.drawId ||
          row.drawWallTime <= previous.drawWallTime ||
          row.wallTime <= previous.wallTime))
    )
      throw Error("Ordered unique draw frame required");
    const direct = row.directEffectFrame;
    if (direct) {
      if (
        !unsigned(direct.metrics?.simulationSteps) ||
        row.particleStateKey !== String(direct.metrics.simulationSteps) ||
        row.simulationStepsAdvanced !==
          direct.metrics.simulationStepsAdvanced ||
        !["advance", "camera"].includes(direct.operation) ||
        (direct.operation === "camera" && row.simulationStepsAdvanced !== 0) ||
        !Object.is(direct.time, row.presentedTime) ||
        !row.presentation
      )
        throw Error("Draw particle state must match committed response");
    } else if (
      row.particleStateKey !== null ||
      row.simulationStepsAdvanced !== 0
    )
      throw Error("World draw cannot invent particle steps");
    if (row.presentation) {
      if (
        !finite(row.presentation.requestedAt) ||
        row.presentation.requestedAt < 0 ||
        row.presentation.requestedAt > row.wallTime ||
        row.presentation.epoch !== row.epoch ||
        !Object.is(
          row.requestToPresentMs,
          row.drawWallTime - row.presentation.requestedAt,
        )
      )
        throw Error("Draw request-to-present latency must match its request");
    } else if (row.requestToPresentMs !== null)
      throw Error("Unrequested draw cannot invent request latency");
    draws.set(row.drawId, row);
    previous = row;
  }
  const boundary = contract.initialDisplayBoundary ?? null;
  if (boundary) {
    validateStamp(boundary, contract);
    if (
      draws.has(boundary.drawId) ||
      (frames.length &&
        (boundary.drawId >= frames[0].drawId ||
          boundary.drawWallTime > frames[0].wallTime))
    )
      throw Error("Initial display boundary must precede recorded draws");
  }
  let initialBoundaryTicks = 0,
    completedIndex = -1;
  previous = null;
  for (const row of ticks) {
    validateDisplayTick(row, previous, contract);
    const draw =
      draws.get(row.drawId) ??
      (boundary?.drawId === row.drawId ? boundary : null);
    if (!draw || !sameStamp(draw, row))
      throw Error(
        "Display tick differs from its recorded draw or explicit boundary",
      );
    while (
      completedIndex + 1 < frames.length &&
      frames[completedIndex + 1].drawWallTime <= row.wallTime
    )
      completedIndex++;
    if (completedIndex >= 0 && frames[completedIndex].drawId !== row.drawId)
      throw Error("Display tick must observe the latest completed draw");
    if (draw === boundary) initialBoundaryTicks++;
    previous = row;
  }
  return {
    recordedDraws: frames.length,
    matchedTicks: ticks.length,
    initialBoundaryTicks,
  };
}
const percentile = (values, p) =>
  values.length
    ? values.toSorted((a, b) => a - b)[
        Math.max(0, Math.ceil(values.length * p) - 1)
      ]
    : null;
const distribution = (values) => ({
  samples: values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  maximum: values.length ? Math.max(...values) : null,
});
const cohort = (row) =>
  !row.playing
    ? "paused"
    : !row.effectsEnabled && row.speed === 1
      ? "worldOnly"
      : row.effectsEnabled && row.speed === 1
        ? "effects1x"
        : row.effectsEnabled && row.speed === 4
          ? "effects4x"
          : null;
function eligible(row, contract, tick) {
  const [start, end] = contract.comparisonWindow ?? [69, 99];
  return (
    row.width === 1920 &&
    row.height === 1080 &&
    row.pixelRatio === 1 &&
    row.mode === "shared effects" &&
    !row.effectPreparationActive &&
    row.effectsEnabled === row.effectsVisible &&
    row.presentedTime >= start &&
    row.presentedTime <= end &&
    (!row.effectsEnabled || row.particleStateKey !== null) &&
    (!tick ||
      (row.desiredEpoch === row.epoch &&
        row.desiredPlaying === row.playing &&
        row.desiredSpeed === row.speed &&
        row.desiredTime >= start &&
        row.desiredTime <= end))
  );
}
// Runs are formed before selection. An intervening pause, seek, preparation,
// resolution change or rate transition breaks the measurement interval.
function runsFor(rows, name, contract, tick) {
  const runs = [];
  let run = null;
  for (const row of rows) {
    if (!eligible(row, contract, tick) || cohort(row) !== name) {
      run = null;
      continue;
    }
    const prev = run?.at(-1);
    const clockContinuous =
      !prev ||
      !row.playing ||
      Math.abs(
        row.desiredTime -
          prev.desiredTime -
          ((row.wallTime - prev.wallTime) * row.speed) / 1000,
      ) <= 0.000001;
    if (
      !run ||
      row.epoch !== prev.epoch ||
      row.presentedTime < prev.presentedTime ||
      !clockContinuous
    ) {
      run = [];
      runs.push(run);
    }
    run.push(row);
  }
  return runs;
}
function intervalStats(runs, key) {
  let intervals = 0,
    durationMs = 0;
  for (const run of runs)
    if (run.length > 1) {
      intervals += run.length - 1;
      durationMs += run.at(-1)[key] - run[0][key];
    }
  return { intervals, durationMs };
}
const rate = (count, durationMs, paused) =>
  !paused && durationMs > 0 ? (count * 1000) / durationMs : null;
export function summarizeDisplayTicks(ticks, frames, contract) {
  const joins = validateDisplayTickJoins(ticks, frames, contract);
  const byId = new Map(frames.map((row) => [row.drawId, row]));
  const result = {};
  for (const name of ["worldOnly", "effects1x", "effects4x", "paused"]) {
    const tickRuns = runsFor(ticks, name, contract, true),
      drawRuns = runsFor(frames, name, contract, false);
    const rows = tickRuns.flat(),
      draws = drawRuns.flat();
    let repeats = 0,
      worldChanges = 0,
      particleChanges = 0,
      cameraOnly = 0,
      sameStateDraws = 0;
    for (const run of tickRuns)
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1],
          b = run[i];
        if (a.drawId === b.drawId) {
          repeats++;
          continue;
        }
        const newWorld = a.worldStateKey !== b.worldStateKey;
        const newParticle =
          a.particleStateKey !== null &&
          b.particleStateKey !== null &&
          a.particleStateKey !== b.particleStateKey;
        if (newWorld) worldChanges++;
        if (newParticle) particleChanges++;
        if (!newWorld && !newParticle) {
          if (
            a.cameraKey !== b.cameraKey ||
            byId.get(b.drawId)?.directEffectFrame?.operation === "camera"
          )
            cameraOnly++;
          else sameStateDraws++;
        }
      }
    const tickIntervals = intervalStats(tickRuns, "wallTime"),
      drawIntervals = intervalStats(drawRuns, "drawWallTime");
    const observed = new Set(rows.map((r) => r.drawId)),
      paused = name === "paused";
    result[name] = {
      displayTicks: rows.length,
      actualDraws: draws.length,
      rafTickFps: rate(
        tickIntervals.intervals,
        tickIntervals.durationMs,
        paused,
      ),
      actualDrawFps: rate(
        drawIntervals.intervals,
        drawIntervals.durationMs,
        paused,
      ),
      observedWorldTimeChanges: worldChanges,
      observedWorldTimeChangeFps: rate(
        worldChanges,
        tickIntervals.durationMs,
        paused,
      ),
      observedParticleStepChanges: particleChanges,
      observedParticleStepChangeFps: rate(
        particleChanges,
        tickIntervals.durationMs,
        paused,
      ),
      uniqueNewStateTicks: worldChanges,
      uniqueNewStateFps: rate(worldChanges, tickIntervals.durationMs, paused),
      repeatedTicks: repeats,
      cameraOnlyTicks: cameraOnly,
      sameStateNewDrawTicks: sameStateDraws,
      observedWorldTimeStates: new Set(
        rows.map((r) => `${r.epoch}:${r.worldStateKey}`),
      ).size,
      observedParticleStepStates: new Set(
        rows
          .filter((r) => r.particleStateKey !== null)
          .map((r) => `${r.epoch}:${r.particleStateKey}`),
      ).size,
      simulationStepsAdvanced: draws.reduce(
        (sum, r) => sum + r.simulationStepsAdvanced,
        0,
      ),
      drawsNotObservedAtRaf: draws.filter((r) => !observed.has(r.drawId))
        .length,
      presentationLagReplaySeconds: distribution(
        rows.map((r) => r.desiredTime - r.presentedTime),
      ),
      retainedDrawAgeMs: distribution(
        rows.map((r) => r.wallTime - r.drawWallTime),
      ),
      requestToPresentMs: distribution(
        draws.flatMap((r) =>
          r.requestToPresentMs === null ? [] : [r.requestToPresentMs],
        ),
      ),
      contiguousTickRuns: tickRuns.map((r) => ({
        epoch: r[0].epoch,
        firstDrawId: r[0].drawId,
        lastDrawId: r.at(-1).drawId,
        observations: r.length,
        startWallTime: r[0].wallTime,
        endWallTime: r.at(-1).wallTime,
      })),
      contiguousDrawRuns: drawRuns.map((r) => ({
        epoch: r[0].epoch,
        firstDrawId: r[0].drawId,
        lastDrawId: r.at(-1).drawId,
        draws: r.length,
        startWallTime: r[0].drawWallTime,
        endWallTime: r.at(-1).drawWallTime,
      })),
      measuredTickIntervals: tickIntervals.intervals,
      measuredTickDurationMs: tickIntervals.durationMs,
      measuredDrawIntervals: drawIntervals.intervals,
      measuredDrawDurationMs: drawIntervals.durationMs,
      newStateMeansDistinctReplayTime: true,
    };
  }
  return { ...result, joins };
}
