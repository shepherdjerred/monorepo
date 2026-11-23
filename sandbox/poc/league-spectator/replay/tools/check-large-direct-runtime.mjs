import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_BUILD,
  DIRECT_EFFECT_PROTOCOL,
  DIRECT_EFFECT_PROGRAM_VERSION,
} from "../latest-direct-effect-runtime.mjs";
import { ownDirectWorkerEventInput } from "../latest-direct-event-ownership.mjs";
import { normalizeDirectSystemAudio } from "../latest-direct-effect-audio.mjs";

// Constructor/ownership storage control only. No rendered scene, decoded match
// or admitted effect is synthesized by this test fixture.
export function checkLargeDirectRuntime() {
  const count = 307256,
    createCount = 100760,
    contentHash = "a".repeat(64),
    stages = [];
  let shared = {
      values: Array.from({ length: 4096 }, (_, id) => ({
        id,
        values: [id, -0],
      })),
    },
    source = Array.from({ length: count }, (_, index) => ({
      id: `source:${index}`,
      kind: index < createCount ? "create" : "omitted",
      origin: "network-effect",
      entityId: (index % 4096) + 1,
      time: index / 100,
      transportSequence: index,
      entryOrder: 0,
      ...(index < createCount
        ? { definitionId: "storage-control", shared }
        : { reasons: ["test:unresolved"] }),
    }));
  const received = structuredClone(source);
  source = null;
  shared = null;
  const definition = {
      id: "storage-control",
      programVersion: DIRECT_EFFECT_PROGRAM_VERSION,
      build: DIRECT_EFFECT_BUILD,
      protocol: DIRECT_EFFECT_PROTOCOL,
      contentHash,
      emitters: [],
      unsupported: [],
      systemAudio: normalizeDirectSystemAudio({}),
    },
    unexpectedSimulation = () => {
      throw Error("Constructor eagerly invoked simulation");
    },
    runtime = new LatestDirectEffectRuntime({
      build: DIRECT_EFFECT_BUILD,
      protocol: DIRECT_EFFECT_PROTOCOL,
      contentHash,
      replayHash: "b".repeat(64),
      definitions: new Map([[definition.id, definition]]),
      events: received,
      eventsOwnership: ownDirectWorkerEventInput(received),
      world: { placement: unexpectedSimulation },
      kernels: {
        birth: { createRandom: unexpectedSimulation },
        emission: { count: unexpectedSimulation },
      },
      onPreparation: (event) => stages.push(event),
    });
  if (
    runtime.events !== received ||
    runtime.events.length !== count ||
    runtime.instances.size ||
    runtime.ledger.size
  )
    throw Error(
      "Worker constructor changed event ownership or eagerly instantiated future effects",
    );
  for (let index = 0; index < count; index++)
    if (
      runtime.events[index].id !== `source:${index}` ||
      runtime.events[index].transportSequence !== index
    )
      throw Error(`Full-count worker event order changed at ${index}`);
  const freezer = stages.find(
    (event) => event.stage === "events.freeze" && event.phase === "end",
  ).counts;
  if (
    freezer.reused !== createCount - 1 ||
    freezer.visited !== createCount + 2 + 4096 * 2
  )
    throw Error("Shared creation metadata was traversed repeatedly");
  return {
    scope: "Constructor storage control only; not whole-match playback proof",
    events: count,
    creates: createCount,
    adoptedOriginalReceivedGraph: true,
    instancesBeforePlayback: runtime.instances.size,
    freezer,
    stages,
  };
}
if (import.meta.main) console.log(JSON.stringify(checkLargeDirectRuntime()));
