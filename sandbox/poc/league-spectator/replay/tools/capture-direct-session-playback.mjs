import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import { directDiagnosticDraw } from "./direct-diagnostic-draw.mjs";

// Advance the actual session's initialized worker. This supplied diagnostic
// camera bypasses the viewer's request wrapper and does not measure display FPS.
export async function captureDirectSessionPlayback(session, report) {
  const camera = {
    right: [1, 0, 0],
    up: [0, 0.6, -0.8],
    axis: [0, 0.8, 0.6],
    position: [6000, 8000, 12000],
  };
  const snapshots = [],
    schedules = [];
  let referenceCheckpoint;
  for (const speed of [1, 4]) {
    await session.client.frame(0, camera);
    await session.client.frame(69, camera);
    const timings = [];
    for (let frame = 0; frame <= 1800 / speed; frame++) {
      const packet = await session.client.frame(
        69 + (frame * speed) / 60,
        camera,
      );
      timings.push({ time: packet.time, ...structuredClone(packet.metrics) });
      if (speed === 1 && frame % 10 === 0)
        snapshots.push({
          time: packet.time,
          camera: structuredClone(camera),
          draws: packet.draws.map(directDiagnosticDraw),
        });
    }
    const checkpoint = await session.client.checkpoint();
    if (
      referenceCheckpoint &&
      !sameDirectCompiledData(checkpoint, referenceCheckpoint)
    )
      throw Error("Actual session worker 1x/4x retained state differs");
    referenceCheckpoint = checkpoint;
    const redraw = await session.client.camera({
      right: [0, 0, 1],
      up: [0, 1, 0],
      axis: [-1, 0, 0],
      position: [-6000, 0, 6000],
    });
    if (
      redraw.metrics.simulationStepsAdvanced !== 0 ||
      !sameDirectCompiledData(await session.client.checkpoint(), checkpoint)
    )
      throw Error("Actual session worker camera redraw advanced simulation");
    for (const time of [68, 99, 68, 99])
      await session.client.frame(time, camera);
    if (!sameDirectCompiledData(await session.client.checkpoint(), checkpoint))
      throw Error(
        "Actual session worker repeated seeks changed retained state",
      );
    const durations = timings
      .map((m) => m.simulationMs + m.geometryMs)
      .sort((a, b) => a - b);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
    schedules.push({
      speed,
      timings,
      frames: timings.length,
      simulationAndGeometryP95Ms: p95,
      simulationAndGeometryLimitMs: speed === 1 ? 4 : 8,
      simulationAndGeometryBudgetMet: p95 <= (speed === 1 ? 4 : 8),
      coverage: await session.client.coverage(),
    });
  }
  const within = (row) => row.time >= 69 && row.time <= 99;
  const heroes = new Set(report.heroes.map((h) => h.entityId));
  return {
    schema: 1,
    kind: "actual-ordinary-direct-session-playback-capture",
    comparisonWindow: [69, 99],
    sourceCounts: {
      heroAttacks: report.attacks.filter(
        (r) => within(r) && heroes.has(r.entityId),
      ).length,
      heroCasts: report.casts.filter((r) => within(r) && heroes.has(r.entityId))
        .length,
      missileRecords: report.missiles.filter(within).length,
      creationRequests: report.effectCreations.filter(within).length,
    },
    snapshots,
    schedules,
    controls: {
      realBunModuleWorker: true,
      identical1x4xCheckpoint: true,
      cameraWithoutSimulation: true,
      backwardRepeatedSeek: true,
    },
    scope: {
      actualInitializedOrdinarySessionClient: true,
      actualDecodedReplayRequests: true,
      suppliedEffectDefinitions: false,
      suppliedPerRequestPlacement: false,
      suppliedFixedDiagnosticCamera: true,
      viewerRequestWrapperExecutedDuringCapture: false,
      wallClockPacing: false,
      browserExecuted: false,
      gpuSubmission: false,
      visiblePixels: false,
      browserFpsEstablished: false,
      worldOnlyBaseline: false,
      hostLoadControlled: false,
      nativeMatchAcceptance: null,
    },
  };
}
