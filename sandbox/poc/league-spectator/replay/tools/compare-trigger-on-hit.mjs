import { resolve } from "node:path";
import { createLatestMissileActors } from "../latest-missile-actors.mjs";
import { createPresentationMissileActors } from "../latest-presentation-missile-actors.mjs";
import {
  createTriggerOnHitNoHitActors,
  TRIGGER_ON_HIT_CONTRACT,
} from "../latest-trigger-on-hit.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Trigger comparison input changed");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/trigger-on-hit-native-v35.json`);
if (
  native.kind !== "original-trigger-on-hit-no-hit-local-controls" ||
  native.build !== TRIGGER_ON_HIT_CONTRACT.build ||
  native.protocol !== TRIGGER_ON_HIT_CONTRACT.protocol ||
  native.scope.actualReplayCollisionObserved !== false ||
  native.scope.activeFamilyAdmissionChanged !== false
)
  throw Error("Exact scoped TriggerOnHit original controls required");
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Trigger native source changed: " + path);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Trigger original instruction block changed");
for (const [key, value] of Object.entries(TRIGGER_ON_HIT_CONTRACT))
  if (native.contract[key] !== value)
    throw Error("Trigger original contract differs");
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  bytes = await raw(`${cache}/public/decoder-16.21-macos/missile-actors.json`);
if ((await sha256(bytes)) !== profile.missileActorsSha256)
  throw Error("Pinned shared actor package required");
const actors = createTriggerOnHitNoHitActors(
  createPresentationMissileActors(
    createLatestMissileActors(JSON.parse(new TextDecoder().decode(bytes))),
  ),
);
const hex = (v) => new Uint8Array(new Float32Array(v).buffer).toHex();
const mismatches = [];
let operations = 0,
  hitRejections = 0;
for (const [index, c] of native.cases.entries()) {
  const record = {
    entityId: index + 1,
    pendingChildren: 0,
    replicationPhase: 0,
    cast: { targetCount: 0 },
    behaviorSpecs: c.componentOrder.map((type) =>
      type === "trigger"
        ? { __type: "TriggerOnHit", mActions: [{ __type: "Cast" }] }
        : { __type: "DestroyOnMovementComplete" },
    ),
  };
  const state = actors.initialize(record, c.velocity, {
    instanceId: `trigger-control:${index}`,
    sourceEventId: `source:${index}`,
  });
  state.position = [17, 19, 23];
  const check = (expected, tick) => {
    const components = state.components.map((c) =>
      c.type === "TriggerOnHit"
        ? {
            vtableRva: TRIGGER_ON_HIT_CONTRACT.runtimeVtableRva,
            ownerMatches: true,
            actions: c.actions.map((a) => ({
              vtableRva: TRIGGER_ON_HIT_CONTRACT.castActionVtableRva,
              executed: a.executed,
            })),
          }
        : {
            vtableRva: 0x235c300,
            ownerMatches: true,
            actions: [{ vtableRva: 0x235c648, executed: c.actionExecuted }],
            remainingDelay: c.remainingDelay,
            fired: c.fired,
          },
    );
    const actual = {
      phase: state.phase,
      phaseLatch: state.phaseLatch,
      phaseCount: state.phaseCount,
      stopped: state.stopped,
      positionHex: hex(state.position),
      velocityHex: hex(state.velocity),
      components,
      callbacks: Array.from({ length: state.presentationStopCalls }, () => ({
        kind: "stop-presentation",
        entryRva: 0x8950e0,
      })),
    };
    if (!sameDirectCompiledData(actual, expected))
      mismatches.push({ index, tick, actual, expected });
  };
  check(c.initial, -1);
  for (const [tick, operation] of c.operations.entries()) {
    if (operation.operation === "phase") actors.advancePhase(state, tick);
    else if (operation.operation === "stop") actors.stop(state);
    else actors.componentFrame(state, operation.operation === "frame-arrived");
    check(operation.state, tick);
    operations++;
  }
  if (c.componentOrder.includes("trigger")) {
    const before = structuredClone(state);
    let rejected = false;
    try {
      actors.hit(state);
    } catch (error) {
      rejected = error.message.includes("collision and downstream Cast");
    }
    if (!rejected || !sameDirectCompiledData(before, state))
      throw Error("Untranslated hit boundary did not reject without mutation");
    hitRejections++;
  }
}
if (native.cases.length !== 18 || operations !== 126 || hitRejections !== 12)
  throw Error("Complete TriggerOnHit native cohort required");
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Trigger comparison input drifted");
const output = `${cache}/research/trigger-on-hit-comparison-v35.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "translated-trigger-on-hit-no-hit-comparison",
      artifactVersion: 35,
      inputs,
      cases: native.cases.length,
      operations,
      explicitHitBoundaryRejections: hitRejections,
      mismatches,
      scope: {
        originalOrderedNoHitLifecycleCompared: true,
        exactActionListOwnershipCompared: true,
        actualReplayCollisionEstablished: false,
        activeFamilyAdmissionChanged: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    cases: native.cases.length,
    operations,
    hitRejections,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length)
  throw Error("Original TriggerOnHit no-hit lifecycle differs");
