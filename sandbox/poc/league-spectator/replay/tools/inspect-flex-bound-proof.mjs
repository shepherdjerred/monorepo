// Original native equivalence plus browser conditional normalization. This is
// not a whole-parent native/browser simulation or actual replay rendering proof.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { directZeroBoundFlex } from "../latest-direct-effect-flex.mjs";
import {
  PROVIDER_FREE_BOUND_SIZE_BLOCKS,
  createLatestProviderFreeBoundSize,
} from "../latest-provider-free-bound-size.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const data = await Bun.file(path).bytes(),
    digest = await sha256(data);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input drift: ${path}`);
  inputs[path] = digest;
  return data;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await load("decoder-16.21-macos/image.bin");
const bound = createLatestProviderFreeBoundSize(profile);
if ((await sha256(image)) !== profile.decoderImageSha256)
  throw Error("Original image differs");
let assertions = 0;
function check(value, message) {
  if (!value) throw Error(message);
  assertions++;
}
async function validateNative(report) {
  check(
    report.build === profile.clientVersion &&
      report.protocol === profile.protocolDigest &&
      !report.boundary,
    "Exact complete native controls required",
  );
  for (const [path, digest] of Object.entries({
    ...report.inputs,
    ...report.sources,
  }))
    check(
      (await sha256(await raw(path))) === digest,
      `Native input or producer drift: ${path}`,
    );
  for (const b of [...report.originalBlocks, ...(report.sourceBlocks ?? [])])
    check(
      (await sha256(image.subarray(b.rva, b.rva + b.size))) === b.sha256,
      "Original instruction bytes differ",
    );
}
for (const [at, size, digest] of PROVIDER_FREE_BOUND_SIZE_BLOCKS)
  check(
    (await sha256(image.subarray(at, at + size))) === digest,
    "Browser producer source pin differs",
  );
const leaf = await read(`${cache}/research/flex-bound-size-native.json`);
await validateNative(leaf);
check(
  leaf.kind === "original-provider-free-flex-bound-size-leaf-control" &&
    leaf.completeFactoryDefaults.length === 10 &&
    leaf.controls.length === 20 &&
    leaf.typedFlex.size === 48 &&
    leaf.boundScaleProperty.hash === 0x95111b29 &&
    leaf.boundScaleProperty.offset === 4 &&
    leaf.boundScaleProperty.type === 10,
  "Complete typed Flex and factory-default control matrix required",
);
for (const d of leaf.completeFactoryDefaults) {
  check(
    JSON.stringify(Object.keys(d).sort()) ===
      JSON.stringify([
        "objectBoundSizeHex",
        "parentBoundSizeHex",
        "wrapperBoundSizeHex",
      ]),
    "Exact factory default byte fields required",
  );
  check(
    Object.values(d).every((value) => value === "00000000"),
    "Factory default is not exact positive zero",
  );
}
let identityControls = 0;
const expectedLeafControls = new Set(
  [0, Math.fround(0.005), 1, 100].flatMap((coefficient) =>
    [0, 100, 200, 250, 500].map((size) => JSON.stringify([coefficient, size])),
  ),
);
const observedLeafControls = new Set();
for (const c of leaf.controls) {
  const key = JSON.stringify([c.coefficient, c.suppliedBoundSize]);
  check(
    expectedLeafControls.has(key) && !observedLeafControls.has(key),
    "Unexpected or duplicate native coefficient/size control",
  );
  observedLeafControls.add(key);
  const product = Math.fround(
    Math.fround(c.coefficient) * Math.fround(c.nativeParentBoundSize),
  );
  check(
    c.birthScaleFactor === (product > 0 ? product : 1),
    "Browser float32 leaf differs from native",
  );
  if (c.suppliedBoundSize === 0) {
    check(
      c.nativeParentBoundSize === bound.boundObjectSize &&
        c.birthScaleFactor === 1,
      "Provider-free Flex did not preserve identity scale",
    );
    identityControls++;
  }
}
check(
  observedLeafControls.size === expectedLeafControls.size,
  "Complete twenty-case native coefficient/size matrix required",
);
const visual = await read(
  `${cache}/research/flex-bound-size-visuals-native.json`,
);
await validateNative(visual);
check(
  visual.kind === "original-authored-flex-zero-bound-size-visual-control" &&
    visual.cases.length === 4 &&
    visual.scope.allOriginalEmitterSimulationAndStateCompared === true &&
    visual.scope.unsupportedSiblingGeometryExecuted === false,
  "Full-simulation/selected-geometry native coefficient equivalence required",
);
const selected = new Map([
  ["champions/ornn/0/1dce7d04", [2, 4]],
  ["champions/ornn/0/869ee434", [1]],
]);
let nativeFrames = 0,
  nativeVertices = 0;
for (const [id, indices] of selected) {
  const authored = visual.cases.find(
    (c) => c.effectId === id && c.zeroCoefficientControl === false,
  );
  const zero = visual.cases.find(
    (c) => c.effectId === id && c.zeroCoefficientControl === true,
  );
  check(
    !!authored &&
      !!zero &&
      authored.frames.length === 61 &&
      zero.frames.length === 61 &&
      !authored.differentFrames.length &&
      !zero.differentFrames.length &&
      JSON.stringify(authored.frames) === JSON.stringify(zero.frames),
    "Native exact full visual state differs",
  );
  for (const c of [authored, zero]) {
    check(
      JSON.stringify(c.geometryEmitterIndices) === JSON.stringify(indices),
      "Unexpected geometry selection",
    );
    check(
      c.frames.every(
        (f) => f.state.actors.length === (indices.length === 2 ? 6 : 2),
      ),
      "Simulation sibling omitted",
    );
    const vertices = new Map(indices.map((i) => [i, 0]));
    for (const f of c.frames) {
      check(
        f.state.parentHex.slice(0x1cc * 2, 0x1d0 * 2) === "00000000",
        "Native parent bound size changed",
      );
      for (const d of f.draws) {
        check(vertices.has(d.emitterIndex), "Unselected geometry submitted");
        const count = d.verticesHex.length / 56;
        vertices.set(d.emitterIndex, vertices.get(d.emitterIndex) + count);
        nativeVertices += count;
      }
      nativeFrames++;
    }
    check(
      [...vertices.values()].every((n) => n > 0),
      "Selected native emitter has no positive geometry",
    );
  }
  for (let i = 0; i < authored.flexFields.length; i++) {
    const before = authored.flexFields[i],
      after = zero.flexFields[i];
    check(
      before.pointer === after.pointer &&
        before.emitterIndex === after.emitterIndex &&
        before.authoredHex === after.authoredHex &&
        before.authoredHex === before.controlledHex &&
        after.controlledHex.slice(0, 8) === before.authoredHex.slice(0, 8) &&
        after.controlledHex.slice(8, 16) === "00000000" &&
        after.controlledHex.slice(16) === before.authoredHex.slice(16),
      "Typed float control changed more than scale-by-bound-size coefficient",
    );
  }
}
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes: await load("latest-effects/manifest.json"),
  effectIds: [...selected.keys()],
});
const compiled = [];
for (const [id, indices] of selected)
  for (const index of indices) {
    const definition = prepared.definitions.get(id),
      emitter = definition.emitters.find((e) => e.index === index);
    check(
      !definition.blockers.length && !!emitter,
      "Actual Flex component not compiled",
    );
    check(
      directZeroBoundFlex(emitter.source.FlexShapeDefinition) &&
        emitter.placementRequirements.rootBasis === true &&
        emitter.placementRequirements.boundObjectSize === 0,
      "Compiled Flex source/conditional world requirement differs",
    );
    check(
      prepared.materials.has(emitter.materialKey),
      "Exact prepared Flex material absent",
    );
    compiled.push({
      id,
      index,
      rawFlex: emitter.source.FlexShapeDefinition,
      placementRequirements: emitter.placementRequirements,
    });
  }
for (const [path, digest] of Object.entries(inputs))
  check(
    (await sha256(await Bun.file(path).bytes())) === digest,
    `Final input drift: ${path}`,
  );
const output = resolve(cache, "research/flex-bound-size-comparison.json");
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-browser-flex-zero-bound-normalization-proof",
      inputs,
      assertions,
      factoryDefaults: 10,
      nativeLeafControls: 20,
      zeroSizeIdentityControls: identityControls,
      nativeFrames,
      nativeVertices,
      compiled,
      scope: {
        nativeCoefficientEquivalence: true,
        browserFloat32LeafComparison: true,
        browserConditionalCompilerNormalization: true,
        selectedGeometryOnly: true,
        wholeParentNativeBrowserSimulationCompared: false,
        actualReplayRenderingEstablished: false,
        nativeMatchAcceptanceEstablished: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    assertions,
    nativeFrames,
    nativeVertices,
    compiledComponents: compiled.length,
    inputs: Object.keys(inputs).length,
  }),
);
