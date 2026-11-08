// Static fragment/read evidence only. Nothing here mints a material capability.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { APPROVED_NATIVE_MATERIAL_REFERENCE_SHA } from "../latest-selected-vfx-material-inventory.mjs";
import {
  deriveSelectedMaterialSourceVectors,
  assertSelectedMaterialSourceVectors,
} from "../latest-selected-material-source-vectors.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import {
  SELECTED_MATERIAL_PARAMETER_FIELDS,
  deriveSelectedMaterialParameterInputSpans,
  assertSelectedMaterialParameterInputSpans,
  deriveAuthoredSelectedMaterialSourceVectors,
} from "../latest-selected-material-parameter-inputs.mjs";
const [primaryArg, secondaryArg] = process.argv.slice(2);
if (!primaryArg || !secondaryArg || process.argv.length !== 4)
  throw Error(
    "Usage: compare-selected-material-vectors.mjs <primary> <secondary>",
  );
const primary = resolve(primaryArg),
  secondary = resolve(secondaryArg),
  inputs = {},
  decode = (b) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    hash = await sha256(b);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Material source proof drift: " + path);
  inputs[path] = hash;
  return b;
}
await captureDirectSourceInputs([import.meta.path], raw);
const approvedBytes = await raw(
    `${primary}/research/vfx-materials-native.json`,
  ),
  approved = decode(approvedBytes);
if ((await sha256(approvedBytes)) !== APPROVED_NATIVE_MATERIAL_REFERENCE_SHA)
  throw Error("Fixed original native approval required");
const control = decode(
  await raw(`${secondary}/research/selected-material-vectors-native.json`),
);
for (const [path, expected] of Object.entries(control.inputs))
  if ((await sha256(await raw(path))) !== expected)
    throw Error("Native fragment input changed: " + path);
if (
  control.cases.length !== 74 ||
  new Set(control.cases.map((c) => c.index)).size !== 74
)
  throw Error("Complete74 native controls required");
const image = await raw(`${secondary}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== approved.decoderImageSha256)
  throw Error("Fixed approved original image differs");
for (const block of [...control.originalBlocks, ...control.originalConstants])
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original material code/constant differs");
if (
  !sameDirectCompiledData(control.entrypoints, {
    atlas: approved.entrypoints.atlas,
    pushPull: approved.entrypoints.pushPull,
    soft: approved.entrypoints.softParticles,
    samplers: approved.entrypoints.samplers,
  })
)
  throw Error("Original fragment boundaries differ");
let controlledVectors = 0;
for (const c of control.cases) {
  const actual = deriveSelectedMaterialSourceVectors(c.graph);
  if (!sameDirectCompiledData(actual, c.output))
    throw Error("Native source fragment mismatch: " + c.index);
  controlledVectors += actual.parameters.length;
}
const nested = decode(
  await raw(
    `${secondary}/research/selected-material-nested-fields-native.json`,
  ),
);
for (const [path, hash] of Object.entries(nested.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Original numeric lowering input changed: " + path);
for (const block of nested.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original numeric lowering code differs");
if (
  nested.objects.length !== 3 ||
  nested.cases.length !== 38 ||
  nested.watchedPostloadWrites.length !== 0
)
  throw Error("Complete38 original numeric lowering controls required");
for (const [index, spec] of SELECTED_MATERIAL_PARAMETER_FIELDS.entries()) {
  const observed = nested.objects[index];
  if (
    spec.rootOffset !== observed.rootOffset ||
    spec.type !== observed.type ||
    !sameDirectCompiledData(
      spec.fields.map(([hash, offset, type]) => ({ hash, offset, type })),
      observed.properties.map(({ hash, offset, type }) => ({
        hash,
        offset,
        type,
      })),
    )
  )
    throw Error("Original registered numeric field inventory differs");
  const b = Uint8Array.fromHex(observed.defaultObjectHex);
  for (const [_hash, offset, _type, hex] of spec.fields)
    if (b.subarray(offset, offset + hex.length / 2).toHex() !== hex)
      throw Error("Original numeric constructor default differs");
}
for (const c of nested.cases) {
  const key = `{${c.property.hash.toString(16).padStart(8, "0")}}`,
    field = { [key]: c.supplied },
    emitter =
      c.rootOffset === null
        ? field
        : c.rootOffset === 0x30
          ? { softParticleParams: field }
          : { textureMult: field },
    expected = deriveSelectedMaterialParameterInputSpans(emitter),
    spans =
      c.rootOffset === null
        ? expected.root
        : c.rootOffset === 0x30
          ? expected.soft
          : expected.mult;
  if (
    spans.find((s) => s.offset === c.property.offset)?.bytesHex !== c.loadedHex
  )
    throw Error("Original authored numeric lowering mismatch: " + c.key);
}
const cohorts = [];
for (const cache of [primary, secondary]) {
  const decoder = `${cache}/public/decoder-16.21-macos`,
    profile = decode(await raw(`${decoder}/profile.json`)),
    boundBytes = await raw(`${decoder}/vfx-bound-quads.json`),
    bound = decode(boundBytes),
    nativeBytes = await raw(`${cache}/research/vfx-materials-native.json`),
    native = decode(nativeBytes);
  if (
    (await sha256(boundBytes)) !== profile.vfxBoundQuadsSha256 ||
    native.quadPackageSha256 !== profile.vfxBoundQuadsSha256 ||
    native.decoderImageSha256 !== approved.decoderImageSha256 ||
    native.scope.partialCorpus ||
    bound.templates.length !== native.emitters.length ||
    native.counts.shaderSelections !== native.emitters.length * 17
  )
    throw Error("Complete same-build native cohort required");
  for (const [name, hash] of Object.entries(native.sources))
    if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
      throw Error("Native corpus source changed: " + name);
  const manifest = decode(
      await raw(`${cache}/public/latest-effects/manifest.json`),
    ),
    definitions = new Map();
  let checked = 0,
    vectors = 0;
  const omitted = [];
  for (let i = 0; i < bound.templates.length; i++) {
    const ref = bound.templates[i],
      observation = native.emitters[i];
    if (
      ref.effectId !== observation.effectId ||
      ref.emitterIndex !== observation.emitterIndex ||
      ref.sha256 !== observation.graphSha256
    )
      throw Error("Native cohort identity differs");
    const graphBytes = await raw(`${decoder}/${ref.file}`);
    if ((await sha256(graphBytes)) !== ref.sha256)
      throw Error("Native source graph differs");
    const graph = decode(graphBytes),
      b = Uint8Array.fromHex(graph.assetObjectHex);
    if (new DataView(b.buffer).getBigUint64(0x38, true) !== 0n) {
      omitted.push({
        effectId: ref.effectId,
        emitterIndex: ref.emitterIndex,
        reason: "source:erosion-vector-algorithm-unimplemented",
      });
      continue;
    }
    assertSelectedMaterialSourceVectors(graph, observation);
    const definitionRef = manifest.definitions[ref.effectId];
    if (!definitionRef || definitionRef.sha256 !== ref.sourceDefinitionSha256)
      throw Error("Authored numeric lowering source identity differs");
    if (!definitions.has(ref.effectId)) {
      const bytes = await raw(
        `${cache}/public/latest-effects/${definitionRef.file}`,
      );
      if ((await sha256(bytes)) !== ref.sourceDefinitionSha256)
        throw Error("Authored numeric lowering definition changed");
      definitions.set(ref.effectId, decode(bytes));
    }
    const emitter = definitions.get(ref.effectId).definition
      .complexEmitterDefinitionData[ref.emitterIndex];
    assertSelectedMaterialParameterInputSpans(emitter, graph);
    const authored = deriveAuthoredSelectedMaterialSourceVectors(emitter);
    for (const key of Object.keys(authored))
      if (!sameDirectCompiledData(authored[key], observation[key]))
        throw Error(
          "Authored source material output differs: " +
            ref.effectId +
            ":" +
            ref.emitterIndex +
            ":" +
            key,
        );
    checked++;
    vectors += observation.parameters.length;
  }
  if (checked === 0 || checked + omitted.length !== native.emitters.length)
    throw Error("Source cohort was narrowed or empty");
  cohorts.push({
    cache,
    total: native.emitters.length,
    checked,
    vectors,
    omitted,
  });
}
const rejections = [];
for (const [name, mutate] of [
  [
    "self-consistent-vector",
    (o) => {
      o.parameters[0].bytesHex = "000040400000803f0000803f00000000";
      o.parameters[0].value[0] = 3;
    },
  ],
  [
    "self-consistent-sampler",
    (o) => (o.samplers[0].descriptorHex = "0101010000"),
  ],
]) {
  const output = structuredClone(control.cases[0].output);
  mutate(output);
  let reason = null;
  try {
    assertSelectedMaterialSourceVectors(control.cases[0].graph, output);
  } catch (e) {
    reason = e.message;
  }
  if (!reason) throw Error("Native source forgery accepted: " + name);
  rejections.push({ name, reason });
}
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Final source proof changed: " + path);
const report = {
  schema: 1,
  kind: "selected-material-source-vector-and-sampler-comparison",
  status: "PASS",
  inputs,
  authoredLoweringControls: {
    objects: 3,
    cases: 38,
    watchedNumericWrites: 0,
    mismatches: 0,
  },
  nativeControls: {
    cases: 74,
    vectors: controlledVectors,
    float32Lanes: controlledVectors * 4,
    mismatches: 0,
  },
  cohorts,
  rejections,
  scope: {
    boundedProductionNumericCheck: true,
    derivedWithoutCandidateOutputs: true,
    completeNonerosionNativeCohorts: true,
    exactSignedZeroAndVectorByteEquality: true,
    authoredNumericSourceLowering: true,
    universalNestedPostloadImmutability: false,
    shaderSelection: false,
    materialAdmission: false,
    browserPlayback: false,
    gpuSubmission: false,
  },
};
const path = `${secondary}/research/selected-material-vectors-comparison.json`;
await Bun.write(path, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    path,
    nativeControls: report.nativeControls,
    cohorts: cohorts.map((c) => ({
      total: c.total,
      checked: c.checked,
      vectors: c.vectors,
      omitted: c.omitted.length,
    })),
    rejections: rejections.length,
  }),
);
