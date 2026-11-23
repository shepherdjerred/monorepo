// An owned-browser differential only; never imported by the shipped worker.
// Both runtimes receive independent event/particle state and the same owned
// absolute-time world query service plus identical immutable
// compiled programs. Actual checkpoint/geometry bytes are compared without a
// tolerance. Instrumented timings are not ordinary playback measurements.
export function checkpointCacheWorkerControl(source) {
  const replace = (needle, replacement) => {
    if (source.split(needle).length !== 2)
      throw Error("Exact worker differential source seam changed");
    source = source.replace(needle, replacement);
  };
  const constructor = source.match(
    /runtime = new LatestDirectEffectRuntime\((\{[\s\S]*?kernels,\n      \})\);/,
  );
  if (!constructor)
    throw Error("Complete original worker initialization required");
  replace(
    "  let runtime = null;",
    "  let runtime = null;\n  let checkpointControlRuntime = null;",
  );
  replace(
    constructor[0],
    `${constructor[0]}
      console.log("scout-checkpoint-cache-stage:clone-events");
      const checkpointControlEvents = structuredClone(runtime.events);
      console.log("scout-checkpoint-cache-stage:initialize-baseline");
      checkpointControlRuntime = new CheckpointBaselineRuntime({ ...${constructor[1]},
        events: checkpointControlEvents, eventsOwnership: ownDirectWorkerEventInput(checkpointControlEvents),
        onPreparation: (event) => console.log("scout-checkpoint-cache-baseline:" + JSON.stringify(event)), world });
      console.log("scout-checkpoint-cache-stage:initialized");`,
  );
  replace(
    '      if (type === "advance") runtime.advanceTo(payload.time);',
    `
      const checkpointControlBefore = checkpointControlRuntime.metrics.simulationSteps;
      const checkpointControlStarted = performance.now();
      const checkpointControlTarget = [0, 20.5, 60, 79.8, 110, 1500, 2900, 3022.7].includes(payload.time);
      if (type === "advance" && checkpointControlTarget) console.log("scout-checkpoint-cache-stage:baseline-advance:" + payload.time);
      if (type === "advance") checkpointControlRuntime.advanceTo(payload.time);
      const checkpointControlElapsed = performance.now() - checkpointControlStarted;
      if (type === "advance" && checkpointControlTarget) console.log("scout-checkpoint-cache-stage:candidate-advance:" + payload.time);
      if (type === "advance") runtime.advanceTo(payload.time);`,
  );
  replace(
    "      const packet = runtime.generateDraws(payload.camera);",
    `
      const packet = runtime.generateDraws(payload.camera);
      const checkpointControlPacket = checkpointControlRuntime.generateDraws(payload.camera);
      if (type === "advance" && [0, 20.5, 60, 79.8, 110, 1500, 2900, 3022.7].includes(payload.time)) {
        console.log("scout-checkpoint-cache-stage:compare-state:" + payload.time);
        const checkpointControlCounts = compareCheckpointStateParts(runtime.__checkpointCacheStateControl(), checkpointControlRuntime.__checkpointCacheStateControl());
        if (!sameCheckpointData(packet.draws, checkpointControlPacket.draws))
          throw Error("Full-match cached particle geometry differs at " + payload.time);
        console.log("scout-checkpoint-cache-control:" + JSON.stringify({
          time: payload.time, matched: true, ledgerRows: runtime.ledger.size,
          activeInstances: runtime.instances.size, drawPackets: packet.draws.length,
          comparedStateRows: checkpointControlCounts,
          baselineSteps: checkpointControlRuntime.metrics.simulationSteps - checkpointControlBefore,
          candidateSteps: runtime.metrics.simulationSteps - beforeSteps,
          baselineSimulationMs: checkpointControlElapsed, candidateSimulationMs: packet.metrics.simulationMs,
        }));
      }`,
  );
  replace(
    "      runtime.restore(payload);",
    "      runtime.restore(payload);\n      checkpointControlRuntime.restore(payload);",
  );
  return (
    'import { sameCheckpointData } from "./tools/checkpoint-data-equality.mjs";\n' +
    'import { compareCheckpointStateParts } from "./tools/checkpoint-state-comparison.mjs";\n' +
    'import { LatestDirectEffectRuntime as CheckpointBaselineRuntime } from "./__checkpoint_cache_baseline.mjs";\n' +
    source
  );
}

// A read-only view is safe here because comparison runs synchronously on the
// exclusive worker. It uses the exact public-checkpoint producer and every
// state field, without retaining two unnecessary deep-cloned full-match graphs.
// The production module and public checkpoint boundary are not modified.
export function checkpointCacheRuntimeControl(source) {
  const needle = "  checkpoint() {";
  if (source.split(needle).length !== 2)
    throw Error("Exact public checkpoint producer seam required");
  return source.replace(
    needle,
    `  __checkpointCacheStateControl() {
    return { header: this.#checkpointData([], []), ledger: this.ledger, generations: this.generations };
  }

${needle}`,
  );
}
