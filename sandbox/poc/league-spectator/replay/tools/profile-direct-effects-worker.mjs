// Performance-fixture worker only. The ordinary spectator worker retains its
// verified world/placement gates; no message can select this supplied adapter.
import {
  LatestDirectEffectRuntime,
  directDrawTransfers,
} from "../latest-direct-effect-runtime.mjs";
import { createDirectEffectKernels } from "../latest-direct-effect-worker.mjs";
import { directLoadWorldPlacement } from "./direct-effect-load-world.mjs";

let runtime = null,
  queue = Promise.resolve();
async function handle({ type, payload }) {
  if (type === "initialize") {
    if (
      runtime ||
      payload.events.some(
        (e) =>
          e.descriptor ||
          (e.kind === "create" &&
            (e.placement?.kind !== "explicit-world" ||
              e.placement.position?.length !== 3 ||
              !e.placement.position.every(Number.isFinite))),
      )
    )
      throw Error("Explicit supplied performance fixture events required");
    const kernels = await createDirectEffectKernels(payload);
    runtime = new LatestDirectEffectRuntime({
      ...payload.contract,
      definitions: new Map(payload.definitions.map((d) => [d.id, d])),
      events: payload.events,
      kernels,
      world: { placement: directLoadWorldPlacement },
    });
    return {
      contract: runtime.contract,
      events: payload.events.length,
      definitions: payload.definitions.length,
      emulatedInstructions: 0,
      suppliedBendingWorld: true,
    };
  }
  if (!runtime) throw Error("Performance fixture worker is not initialized");
  if (type === "checkpoint") return runtime.checkpoint();
  if (type === "restore") {
    runtime.restore(payload);
    return { time: runtime.time };
  }
  if (type === "coverage") return runtime.coverage({ includeRows: true });
  if (type !== "advance" && type !== "camera")
    throw Error("Unknown performance fixture operation");
  const start = performance.now(),
    steps = runtime.metrics.simulationSteps;
  if (type === "advance") runtime.advanceTo(payload.time);
  const packet = runtime.generateDraws(payload.camera),
    simulationMs = type === "camera" ? 0 : packet.metrics.simulationMs,
    workerOperationMs = performance.now() - start;
  packet.metrics = {
    ...packet.metrics,
    simulationMs,
    worldQueryMs: type === "camera" ? 0 : packet.metrics.worldQueryMs,
    worldQueries: type === "camera" ? 0 : packet.metrics.worldQueries,
    workerOperationMs,
    simulationStepsAdvanced: runtime.metrics.simulationSteps - steps,
    bookkeepingMs: Math.max(
      0,
      workerOperationMs - simulationMs - packet.metrics.geometryMs,
    ),
  };
  return packet;
}
self.onmessage = ({ data }) => {
  const receivedAtEpochMs = performance.timeOrigin + performance.now();
  queue = queue.then(async () => {
    try {
      if (data?.version !== 1 || !Number.isSafeInteger(data.id))
        throw Error("Malformed performance fixture request");
      const processingAtEpochMs = performance.timeOrigin + performance.now(),
        result = await handle(data),
        transfers = result.draws ? directDrawTransfers(result) : [];
      if (result.draws)
        result.metrics.transport = {
          receivedAtEpochMs,
          processingAtEpochMs,
          replyReadyAtEpochMs: performance.timeOrigin + performance.now(),
          drawBufferBytes: transfers.reduce((n, b) => n + b.byteLength, 0),
        };
      self.postMessage(
        { version: 1, id: data.id, ok: true, result },
        transfers,
      );
    } catch (error) {
      self.postMessage({
        version: 1,
        id: data.id,
        ok: false,
        error: { name: error.name, message: error.message },
      });
    }
  });
};
