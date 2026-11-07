import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
    path = resolve(path);
    const b = await Bun.file(path).bytes(),
      h = await sha256(b);
    if (inputs[path] && inputs[path] !== h) throw Error("Input drift: " + path);
    inputs[path] = h;
    return b;
  },
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const id = "champions/akshan/20/d213225a",
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes: await load("latest-effects/manifest.json"),
    effectIds: [id],
  }),
  report = await read(`${cache}/research/latest-semantics-effects.json`),
  scene = await read(`${cache}/public/latest-scene/manifest.json`),
  hb = await load("latest-scene/heights.bin"),
  payload = {
    profile: prepared.profile,
    packages: prepared.packages,
    definitions: [...prepared.definitions.values()],
    report,
    scene,
    heights: new Float32Array(hb.buffer, hb.byteOffset, hb.byteLength / 4),
    contract: { ...prepared.contract, replayHash: report.replaySha256 },
    world: {},
    // Initialization-only source inventory selector: no position, basis, target or
    // seed is invented, and no advance/draw request will consume this event.
    events: [
      {
        id: "absent-controller-restore-only",
        kind: "create",
        definitionId: id,
        entityId: 1,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
        origin: "animation",
      },
    ],
  };
assert.deepEqual(
  payload.definitions[0].emitters
    .filter((e) => [3, 4, 6, 7].includes(e.index))
    .map((e) => e.index),
  [3, 6, 7],
);
const controls = [];
async function initialize(value) {
  const client = new LatestDirectEffectClient();
  try {
    return await client.initialize(value);
  } finally {
    client.close();
    await client.termination;
  }
}
const normal = await initialize(payload);
assert.equal(normal.compiledDefinitionValidation.mode, "normal");
assert.equal(normal.emulatedInstructions, 0);
const index = payload.definitions[0].emitters.findIndex((e) => e.index === 3);
for (const [label, mutate] of [
  ["missing required program", (e) => delete e.absentRotationControllerProgram],
  [
    "wrong zero sign",
    (e) => (e.absentRotationControllerProgram.constant[0] = -0),
  ],
  [
    "nonzero default",
    (e) => (e.absentRotationControllerProgram.constant[1] = 1),
  ],
  ["wrong enable", (e) => (e.absentRotationControllerProgram.enabled = false)],
  [
    "wrong curve absence",
    (e) => (e.absentRotationControllerProgram.curve = "null"),
  ],
  [
    "wrong policy",
    (e) => (e.absentRotationControllerProgram.policy = "forged"),
  ],
  ["authored curve substituted", (e) => (e.source.rotation0 = null)],
  ["authored flag changed", (e) => (e.source.isRotationEnabled = 0)],
  [
    "dynamic table added",
    (e) =>
      (e.integratedRotation = { sampleCount: 64, samples: Array(192).fill(0) }),
  ],
]) {
  const changed = structuredClone(payload);
  mutate(changed.definitions[0].emitters[index]);
  await assert.rejects(
    initialize(changed),
    /Serialized compiled definition differs from owned recompile/,
  );
  controls.push({ label, rejected: true });
}
for (const path of Object.keys(inputs)) await raw(path);
const out = {
  schema: 1,
  kind: "actual-module-worker-absent-controller-restoration-control-v38",
  inputs,
  normal: {
    mode: normal.compiledDefinitionValidation.mode,
    definitions: normal.definitions,
    emulatedInstructions: normal.emulatedInstructions,
    compiler: normal.compiledDefinitionValidation,
  },
  controls,
  scope: {
    actualBunModuleWorker: true,
    normalFullDefinitionRecompile: true,
    initializationOnly: true,
    placementSupplied: false,
    motionSupplied: false,
    worldActivation: false,
    geometryComparedSeparately: true,
    browserAcceptance: false,
  },
};
const output = `${cache}/research/direct-absent-rotation-worker-control-v38.json`;
await Bun.write(output, JSON.stringify(out, null, 2) + "\n");
console.log(
  JSON.stringify({
    output,
    normal: true,
    malformedRejections: controls.length,
  }),
);
