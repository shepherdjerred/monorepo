import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_BUILD,
  DIRECT_EFFECT_PROTOCOL,
} from "../latest-direct-effect-runtime.mjs";
import { ownDirectWorkerEventInput } from "../latest-direct-event-ownership.mjs";

// Isolate ordered ledger/checkpoint/tick cost. This fixture activates no
// particles and cannot establish actual match seeking or render performance.
export function checkLargeDirectAdvance(
  Runtime = LatestDirectEffectRuntime,
  inspect = null,
) {
  const count = 307256,
    duration = 3023.2,
    started = performance.now(),
    events = Array.from({ length: count }, (_, index) => ({
      id: `omitted:${index}`,
      kind: "omitted",
      origin: "network-effect",
      entityId: index + 1,
      time: Math.fround((index * duration) / (count - 1)),
      transportSequence: index,
      entryOrder: 0,
      reasons: ["storage-control:original-unresolved"],
    })),
    unexpected = () => {
      throw Error("All-omitted control invoked particle/world simulation");
    },
    runtime = new Runtime({
      build: DIRECT_EFFECT_BUILD,
      protocol: DIRECT_EFFECT_PROTOCOL,
      contentHash: "a".repeat(64),
      replayHash: "b".repeat(64),
      definitions: new Map(),
      events,
      eventsOwnership: ownDirectWorkerEventInput(events),
      world: { placement: unexpected },
      kernels: {
        birth: { createRandom: unexpected },
        emission: { count: unexpected },
      },
    }),
    initializedMs = performance.now() - started;
  runtime.advanceTo(duration);
  const advancedMs = performance.now() - started - initializedMs;
  if (
    runtime.cursor !== count ||
    runtime.ledger.size !== count ||
    runtime.instances.size
  )
    throw Error(
      "Full-count omitted control lost ledger history or eagerly activated particles",
    );
  for (const index of [0, count >> 1, count - 1])
    if (runtime.ledger.get(`omitted:${index}`)?.transportSequence !== index)
      throw Error(`Historical ledger row changed at ${index}`);
  const backwardAt = performance.now();
  runtime.advanceTo(duration - 1);
  runtime.advanceTo(duration);
  if (runtime.cursor !== count || runtime.ledger.size !== count)
    throw Error("Backward seek changed complete omitted history");
  const backwardAndReplayMs = performance.now() - backwardAt;
  const inspectedAt = performance.now();
  const inspection = inspect === null ? null : inspect(runtime);
  const inspectionMs = performance.now() - inspectedAt;
  return {
    scope:
      "All-omitted storage/tick control only; no actual match seek/render proof",
    events: count,
    duration,
    initializedMs,
    advancedMs,
    backwardAndReplayMs,
    ledgerRows: runtime.ledger.size,
    instances: runtime.instances.size,
    simulationSteps: runtime.metrics.simulationSteps,
    inspection,
    inspectionMs,
  };
}
if (import.meta.main) console.log(JSON.stringify(checkLargeDirectAdvance()));
