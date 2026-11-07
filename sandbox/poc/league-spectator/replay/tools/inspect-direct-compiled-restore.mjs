// Full ordinary inventory and cross-primitive compiled-field trust controls.
// These are supplied initialization inputs, not match activation/performance.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const artifactArg = process.argv.find((arg) =>
    arg.startsWith("--artifact-version="),
  ),
  artifactVersion = artifactArg
    ? Number(artifactArg.slice("--artifact-version=".length))
    : 32;
if (!Number.isSafeInteger(artifactVersion) || artifactVersion < 1)
  throw Error("Positive artifact version required");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Compiled restore input drift ${path}`);
  inputs[path] = hash;
  return bytes;
}
const load = (path) => raw(`${cache}/public/${path}`),
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const ids = [
    "champions/karthus/10/8ad0cea5",
    "champions/vladimir/39/9fbafd14",
    "champions/hecarim/0/e57b8289",
  ],
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes: await load("latest-effects/manifest.json"),
    effectIds: ids,
  }),
  report = await read(`${cache}/research/latest-semantics-effects.json`),
  scene = await read(`${cache}/public/latest-scene/manifest.json`),
  heightBytes = await load("latest-scene/heights.bin"),
  heights = new Float32Array(
    heightBytes.buffer,
    heightBytes.byteOffset,
    heightBytes.byteLength / 4,
  ),
  definitions = [...prepared.definitions.values()],
  events = ids.map((definitionId, i) => ({
    id: `compiled-restore:${i}`,
    kind: "create",
    origin: "animation",
    entityId: i + 1,
    definitionId,
    time: 0,
    transportSequence: i,
    entryOrder: 0,
    seedHex: "0000000000000001",
    placement: {
      kind: "explicit-world",
      position: [i * 250, 0, 0],
      basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      boundObjectSize: 0,
      boundObjectSizeStatus: "supplied-native-component-control-zero",
    },
  })),
  payload = {
    profile: prepared.profile,
    packages: prepared.packages,
    definitions,
    events,
    report,
    scene,
    heights,
    contract: { ...prepared.contract, replayHash: report.replaySha256 },
    world: {},
  };
const controls = [],
  initializations = [],
  representatives = new Map();
for (const [dIndex, d] of definitions.entries())
  for (const [eIndex, e] of d.emitters.entries())
    if (!representatives.has(e.primitive))
      representatives.set(e.primitive, {
        dIndex,
        eIndex,
        index: e.index,
        id: d.id,
      });
assert.deepEqual([...representatives.keys()].sort(), [
  "arbitrary-quad",
  "camera-quad",
  "camera-trail",
  "ray",
  "static-mesh",
]);
const ordinary = new LatestDirectEffectClient();
try {
  const initialized = await ordinary.initialize(payload);
  assert.equal(initialized.compiledDefinitionValidation.mode, "normal");
  assert.equal(initialized.definitions, 3);
  assert.equal(initialized.emulatedInstructions, 0);
  initializations.push({
    label: "ordinary-five-primitive-inventory",
    compiler: initialized.compiledDefinitionValidation,
    transport: initialized.initializationTransport,
  });
} finally {
  ordinary.close();
  await ordinary.termination;
}
for (const [primitive, ref] of representatives) {
  for (const [field, mutate] of [
    ["blend", (e) => (e.blend = e.blend === 0 ? 2 : 0)],
    ["uniformScale", (e) => (e.uniformScale = !e.uniformScale)],
    ["bound", (e) => (e.bound = !e.bound)],
    [
      "local-orientation",
      (e) => (e.inheritSystemBasis = !e.inheritSystemBasis),
    ],
    [
      "placement",
      (e) =>
        (e.placementRequirements.rootBasis =
          !e.placementRequirements.rootBasis),
    ],
  ]) {
    const changed = structuredClone(payload),
      client = new LatestDirectEffectClient();
    mutate(changed.definitions[ref.dIndex].emitters[ref.eIndex]);
    try {
      await assert.rejects(
        client.initialize(changed),
        /Serialized compiled definition differs from owned recompile/,
      );
      controls.push({ primitive, field, ...ref, rejected: true });
    } finally {
      client.close();
      await client.termination;
    }
  }
}
// A source inventory cannot shrink by deleting only its serialized definition,
// or by hiding an auxiliary candidate from the supplied definitions list.
for (const [label, mutate] of [
  ["omitted-definition", (p) => p.definitions.pop()],
  ["omitted-emitter", (p) => p.definitions[0].emitters.pop()],
  ["omitted-unsupported", (p) => (p.definitions[0].unsupported = [])],
  ["omitted-blockers", (p) => (p.definitions[0].blockers = ["invented"])],
  [
    "unprepared-auxiliary-candidate",
    (p) =>
      (p.events[0].auxiliaryCandidateDefinitionId =
        "champions/vladimir/39/8388edda"),
  ],
]) {
  const changed = structuredClone(payload),
    client = new LatestDirectEffectClient();
  mutate(changed);
  try {
    await assert.rejects(
      client.initialize(changed),
      /inventory differs from ordered events|Serialized compiled definition differs/,
    );
    controls.push({ label, rejected: true });
  } finally {
    client.close();
    await client.termination;
  }
}
let getterInvoked = false;
const changed = structuredClone(payload),
  client = new LatestDirectEffectClient();
Object.defineProperty(changed.definitions[0], "toJSON", {
  get() {
    getterInvoked = true;
    return () => ({});
  },
});
try {
  await assert.rejects(
    client.initialize(changed),
    /Own data compiled fields required/,
  );
  assert.equal(getterInvoked, false);
  controls.push({
    label: "pre-postMessage-accessor",
    rejected: true,
    getterInvoked,
  });
} finally {
  client.close();
  await client.termination;
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    `Final drift ${path}`,
  );
const output = `${cache}/research/direct-compiled-restore-control-v${artifactVersion}.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "ordinary-cross-primitive-owned-compiled-restore-control",
      inputs,
      initializations,
      controls,
      counts: {
        ordinaryInitializations: initializations.length,
        primitiveFamilies: representatives.size,
        malformedRejections: controls.length,
      },
      scope: {
        actualModuleWorker: true,
        suppliedExplicitInitializationEvents: true,
        fullOrdinaryInventory: true,
        perFrameRecompile: false,
        matchActivation: false,
        browserAcceptance: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    primitiveFamilies: representatives.size,
    rejections: controls.length,
    initializations,
  }),
);
