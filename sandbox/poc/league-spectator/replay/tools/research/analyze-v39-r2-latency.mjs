const paths = {
  currentRecording:
    ".cache/replay-spike/research/browser-cdp-v39-primary-r2-recording.json",
  currentAnalysis:
    ".cache/replay-spike/research/browser-cdp-v39-primary-r2-analysis.json",
  historicalAnalysis:
    ".cache/replay-spike/research/browser-cdp-v38-primary-analysis.json",
};
const inputs = {},
  data = {};
for (const [role, path] of Object.entries(paths)) {
  const bytes = await Bun.file(path).bytes();
  inputs[role] = {
    path,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  };
  data[role] = JSON.parse(new TextDecoder().decode(bytes));
}
const qs = (values) => {
  values = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    samples: values.length,
    p50: values[Math.ceil(values.length * 0.5) - 1] ?? null,
    p95: values[Math.ceil(values.length * 0.95) - 1] ?? null,
    maximum: values.at(-1) ?? null,
  };
};
const corr = (rows, a, b) => {
  const pairs = rows
    .map((r) => [a(r), b(r)])
    .filter((p) => p.every(Number.isFinite));
  if (pairs.length < 2) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length,
    my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let cov = 0,
    vx = 0,
    vy = 0;
  for (const [x, y] of pairs) {
    cov += (x - mx) * (y - my);
    vx += (x - mx) ** 2;
    vy += (y - my) ** 2;
  }
  return vx && vy ? cov / Math.sqrt(vx * vy) : null;
};
const cohorts = {};
for (const [name, speed] of [
  ["effects1x", 1],
  ["effects4x", 4],
]) {
  const rows = data.currentRecording.frames.filter(
    (r) =>
      r.playing &&
      r.speed === speed &&
      r.effectsEnabled &&
      r.replayTime >= 69 &&
      r.replayTime <= 99 &&
      r.directEffectFrame,
  );
  const pairs = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i];
    if (
      a.epoch !== b.epoch ||
      a.presentation.epoch !== b.presentation.epoch ||
      b.drawId !== a.drawId + 1
    )
      continue;
    const m = b.directEffectFrame.metrics;
    const overlap = Math.max(0, a.drawWallTime - b.presentation.requestedAt);
    pairs.push({
      requestId: b.directEffectFrame.requestId,
      time: b.replayTime,
      roundTripMs: m.transport.roundTripMs,
      requestToPresentMs: b.requestToPresentMs,
      workerMs: m.workerOperationMs,
      simGeomMs: m.simulationMs + m.geometryMs,
      bytes: m.transport.drawBufferBytes,
      worldMs: b.worldUpdateAndHudMs,
      commitMs: b.effectCommitMs,
      submissionMs: b.renderSubmissionMs,
      navMs: m.navPrepassCpuMs,
      mainPresentationCpuMs:
        b.worldUpdateAndHudMs + b.effectCommitMs + b.renderSubmissionMs,
      previousPresentationOverlapMs: overlap,
      requestToPresentMinusRttMs:
        b.requestToPresentMs - m.transport.roundTripMs,
      rttMinusWorkerMs: m.transport.roundTripMs - m.workerOperationMs,
      rttAfterPreviousSubmissionMs: m.transport.roundTripMs - overlap,
      presentationIntervalMs: b.drawWallTime - a.drawWallTime,
    });
  }
  const fields = [
    "roundTripMs",
    "requestToPresentMs",
    "workerMs",
    "simGeomMs",
    "bytes",
    "worldMs",
    "commitMs",
    "submissionMs",
    "navMs",
    "mainPresentationCpuMs",
    "previousPresentationOverlapMs",
    "requestToPresentMinusRttMs",
    "rttMinusWorkerMs",
    "rttAfterPreviousSubmissionMs",
    "presentationIntervalMs",
  ];
  const old = data.historicalAnalysis.recomputedCohorts[name],
    current = data.currentAnalysis.recomputedCohorts[name];
  cohorts[name] = {
    pairCount: pairs.length,
    distributions: Object.fromEntries(
      fields.map((f) => [f, qs(pairs.map((r) => r[f]))]),
    ),
    correlations: {
      rttVersusWorker: corr(
        pairs,
        (r) => r.roundTripMs,
        (r) => r.workerMs,
      ),
      rttVersusBytes: corr(
        pairs,
        (r) => r.roundTripMs,
        (r) => r.bytes,
      ),
      rttVersusPreviousPresentationOverlap: corr(
        pairs,
        (r) => r.roundTripMs,
        (r) => r.previousPresentationOverlapMs,
      ),
      intervalVersusWorker: corr(
        pairs,
        (r) => r.presentationIntervalMs,
        (r) => r.workerMs,
      ),
    },
    historicalDescriptiveComparison: {
      notControlled: true,
      oldActualDrawFps:
        data.historicalAnalysis.measurements[name].averageDisplayFps,
      newObservedStateFps:
        data.currentAnalysis.scheduling[name].observedWorldTimeChangeFps,
      oldWorldMs: old.worldUpdateAndHudMs,
      newWorldMs: current.worldUpdateAndHudMs,
      oldGpuWholeElapsedMs: old.gpuMs,
      newGpuWholeElapsedMs: current.gpuMs,
      oldRoundTripMs: old.directEffects.transport.roundTripMs,
      newRoundTripMs: current.directEffects.transport.roundTripMs,
    },
    records: pairs,
  };
}
inputs.analyzer = {
  path: import.meta.path,
  sha256: new Bun.CryptoHasher("sha256")
    .update(await Bun.file(import.meta.path).bytes())
    .digest("hex"),
};
const output =
  ".cache/replay-spike/research/browser-cdp-v39-primary-r2-latency-analysis-v2.json";
if (await Bun.file(output).exists())
  throw Error("Preserve existing latency evidence");
const report = {
  kind: "same-main-clock-v39-r2-request-presentation-decomposition",
  inputs,
  scope: {
    productionEdits: false,
    browserDriven: false,
    historicalComparisonCausal: false,
    crossRealmDeliverySplitReliable: false,
    previousPresentationOverlapIsMainClockExact: true,
    rttAfterPreviousSubmissionMsMeaning:
      "RTT minus the exact interval from this request to preceding completed submission; not a worker-only or pure browser scheduling duration",
    mainPresentationCpuMayIncludePreRequestFollowSampling: true,
    quantilesNotAdditive: true,
    payloadDeserializationCostEstablished: false,
    gpuTimersAreWholeElapsedNotIsolatedShaderExecution: true,
  },
  cohorts,
  recommendedNextDiagnostic:
    "Trace4seconds of ordinary1xPlay under these exact V39 served sources, capturing Chromium SchedulePostMessage/HandlePostMessage flow on its unified clock plus main task/RAF boundaries. Preserve actual request ordering and payloads; inspect whether the residual after prior presentation ends is queued worker-to-main delivery. This localizes the current21msRTT before any scheduling A/B or GPU/shader optimization.",
};
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      output,
      sha256: new Bun.CryptoHasher("sha256")
        .update(await Bun.file(output).bytes())
        .digest("hex"),
      cohorts: Object.fromEntries(
        Object.entries(cohorts).map(([name, r]) => [
          name,
          {
            pairs: r.pairCount,
            distributions: r.distributions,
            correlations: r.correlations,
          },
        ]),
      ),
    },
    null,
    2,
  ),
);
