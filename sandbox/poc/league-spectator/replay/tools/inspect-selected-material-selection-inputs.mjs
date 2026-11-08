// Read-only class frontier. It does not approve authored lowering or materials.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import {
  deriveSelectedMaterialSelectionInput,
  assertSelectedBasicMaterialDefinitionInputs,
} from "../latest-selected-material-selection-input.mjs";
import {
  assertSelectedMaterialParameterInputSpans,
  deriveAuthoredSelectedMaterialSourceVectors,
} from "../latest-selected-material-parameter-inputs.mjs";
import {
  assertSelectedMaterialRootInputSpans,
  assertSelectedMaterialNoWorldAccelerationCurve,
} from "../latest-selected-material-root-inputs.mjs";
import { APPROVED_NATIVE_MATERIAL_REFERENCE_SHA } from "../latest-selected-vfx-material-inventory.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";
import { directEmptyLinkControllerCount } from "../latest-direct-effect-link-controllers.mjs";
const selectedCache = resolve(
    process.argv[2] ?? ".cache/replay-lineup-5667809143",
  ),
  fixedCache = resolve(process.argv[3] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Selection input evidence changed: " + path);
  inputs[path] = hash;
  return bytes;
}
const parse = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  need = (value, message) => {
    if (!value) throw Error(message);
  };
await captureDirectSourceInputs([import.meta.path], raw);
const originalBytes = await raw(
  `${fixedCache}/research/vfx-materials-native.json`,
);
need(
  (await sha256(originalBytes)) === APPROVED_NATIVE_MATERIAL_REFERENCE_SHA,
  "Fixed original material observation approval required",
);
const image = await raw(`${fixedCache}/public/decoder-16.21-macos/image.bin`),
  reviewedCode = [
    ["selection", 0x16dff20, 0x16e09cc],
    ["featureStrings", 0x16e3ed0, 0x16e40e8],
    ["selectionOutput", 0x16e33b0, 0x16e38f0],
    ["renderState", 0x16df1e0, 0x16df530],
    ["cameraDefaultConstructor", 0x16fff46, 0x16fff6d],
    ["arbitraryConstructor", 0x17a6390, 0x17a63a4],
  ];
const approvedNative = parse(originalBytes);
need(
  (await sha256(image)) === approvedNative.decoderImageSha256,
  "Fixed original decoder image required",
);
async function corpus(cache, nativeBytes) {
  const assets = `${cache}/public`,
    decoder = `${assets}/decoder-16.21-macos`,
    native = parse(nativeBytes),
    boundBytes = await raw(`${decoder}/vfx-bound-quads.json`),
    bound = parse(boundBytes),
    manifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
    manifest = parse(manifestBytes),
    quad = parse(await raw(`${assets}/latest-complete-quad-gpu/package.json`)),
    prepared = new Set(
      quad.emitters.map((row) => `${row.effectId}:${row.emitterIndex}`),
    ),
    definitions = new Map(),
    classes = new Map(),
    rows = [];
  need(
    native.build === approvedNative.build &&
      native.protocol === approvedNative.protocol &&
      native.decoderImageSha256 === approvedNative.decoderImageSha256 &&
      bound.decoderImageSha256 === approvedNative.decoderImageSha256 &&
      manifest.build === native.build &&
      manifest.protocol === native.protocol &&
      quad.effectsManifestSha256 === (await sha256(manifestBytes)) &&
      quad.nativeMaterialSha256 === (await sha256(nativeBytes)) &&
      quad.quadPackageSha256 === (await sha256(boundBytes)) &&
      native.quadPackageSha256 === (await sha256(boundBytes)) &&
      native.emitters.length === bound.templates.length,
    "Exact native/graph parents required",
  );
  let conflicts = 0,
    rootCurvePointers = 0;
  const noCurveSourceOmissions = [],
    basicDefinitionOmissions = [];
  for (let index = 0; index < bound.templates.length; index++) {
    const ref = bound.templates[index],
      observation = native.emitters[index],
      graphBytes = await raw(`${decoder}/${ref.file}`),
      graph = parse(graphBytes),
      key = `${ref.effectId}:${ref.emitterIndex}`;
    need(
      ref.sha256 === (await sha256(graphBytes)) &&
        observation.graphSha256 === ref.sha256 &&
        observation.effectId === ref.effectId &&
        observation.emitterIndex === ref.emitterIndex,
      "Original selection graph identity differs",
    );
    if (!definitions.has(ref.effectId)) {
      const definitionRef = manifest.definitions[ref.effectId],
        bytes = await raw(`${assets}/latest-effects/${definitionRef.file}`);
      need(
        (await sha256(bytes)) === definitionRef.sha256 &&
          definitionRef.sha256 === ref.sourceDefinitionSha256,
        "Original authored material definition differs",
      );
      definitions.set(ref.effectId, parse(bytes).definition);
    }
    const emitter = definitions.get(ref.effectId).complexEmitterDefinitionData[
      ref.emitterIndex
    ];
    assertSelectedMaterialRootInputSpans(emitter, graph);
    let noWorldAccelerationCurve = false;
    try {
      assertSelectedMaterialNoWorldAccelerationCurve(emitter, graph);
      noWorldAccelerationCurve = true;
    } catch (error) {
      if (error.message !== "No-dynamics worldAcceleration source required")
        throw error;
      noCurveSourceOmissions.push({ key, reason: error.message });
    }
    const signature = deriveSelectedMaterialSelectionInput({ graph, emitter }),
      encoded = stringifyAssetJson(signature),
      outputs = observation.probes.map((probe) => ({
        input: probe.input,
        result: native.resultCatalog[probe.result],
      }));
    const expectedEnvironments = approvedNative.emitters[0].probes.map(
      (probe, index) =>
        index < 8
          ? probe.input
          : { ...probe.input, resourceMask: signature.definedObjectMask },
    );
    need(
      sameDirectCompiledData(
        observation.probes.map((probe) => probe.input),
        expectedEnvironments,
      ),
      "Exact original seventeen supplied environments required",
    );
    let basicDefinitionInputs = false,
      authoredParameterOutputs = false;
    try {
      assertSelectedBasicMaterialDefinitionInputs({ graph, emitter });
      basicDefinitionInputs = true;
    } catch (error) {
      if (
        !error.message.startsWith("Unsupported authored material definition: ")
      )
        throw error;
      basicDefinitionOmissions.push({ key, reason: error.message });
    }
    if (basicDefinitionInputs) {
      assertSelectedMaterialParameterInputSpans(emitter, graph);
      const expected = deriveAuthoredSelectedMaterialSourceVectors(emitter);
      for (const key of [
        "parameters",
        "samplers",
        "erosionAtSuppliedDrive",
        "erosionParameters",
      ])
        need(
          sameDirectCompiledData(expected[key], observation[key]),
          "Authored material parameter/sampler output differs: " + key,
        );
      authoredParameterOutputs = true;
    }
    need(
      outputs.length === 17 && outputs.every((row) => row.result),
      "Complete supplied environment results required",
    );
    if (
      classes.has(encoded) &&
      !sameDirectCompiledData(classes.get(encoded).outputs, outputs)
    )
      conflicts++;
    if (!classes.has(encoded))
      classes.set(encoded, { signature, outputs, original: key });
    const bytes = Uint8Array.fromHex(graph.assetObjectHex),
      rootCurve = new DataView(bytes.buffer).getBigUint64(0x380, true) !== 0n;
    rootCurvePointers += Number(rootCurve);
    rows.push({
      key,
      encoded,
      prepared: prepared.has(key),
      rootCurve,
      noWorldAccelerationCurve,
      basicDefinitionInputs,
      authoredParameterOutputs,
      emptyMaterialOverrideSource:
        directEmptyLinkControllerCount(emitter) === 0,
    });
  }
  return {
    classes,
    rows,
    noCurveSourceOmissions,
    basicDefinitionOmissions,
    summary: {
      emitters: rows.length,
      classes: classes.size,
      conflicts,
      rootCurvePointers,
      noCurveSource: rows.filter((row) => row.noWorldAccelerationCurve).length,
      prepared: rows.filter((row) => row.prepared).length,
      basicDefinitionInputs: rows.filter((row) => row.basicDefinitionInputs)
        .length,
      authoredParameterOutputs: rows.filter(
        (row) => row.authoredParameterOutputs,
      ).length,
    },
  };
}
const fixed = await corpus(fixedCache, originalBytes),
  selected = await corpus(
    selectedCache,
    await raw(`${selectedCache}/research/vfx-materials-native.json`),
  ),
  matched = [];
need(
  fixed.summary.conflicts === 0 && selected.summary.conflicts === 0,
  "One read signature has conflicting original outputs",
);
for (const row of selected.rows) {
  const approved = fixed.classes.get(row.encoded);
  if (!approved) continue;
  need(
    sameDirectCompiledData(
      approved.outputs,
      selected.classes.get(row.encoded).outputs,
    ),
    "Equal original selection read class produced unequal outputs",
  );
  if (row.prepared)
    matched.push({
      selected: row.key,
      original: approved.original,
      rootCurve: row.rootCurve,
      noWorldAccelerationCurve: row.noWorldAccelerationCurve,
      basicDefinitionInputs: row.basicDefinitionInputs,
      authoredParameterOutputs: row.authoredParameterOutputs,
      emptyMaterialOverrideSource: row.emptyMaterialOverrideSource,
    });
}
let stageRows = selected.rows.filter((row) => row.prepared);
const conjunctionStages = [
    { stage: "declared-prepared-quad-material", remaining: stageRows.length },
  ],
  conjunctionOmissions = [];
for (const [stage, predicate] of [
  [
    "existing-empty-material-override-source-policy",
    (row) => row.emptyMaterialOverrideSource,
  ],
  [
    "source-and-native-unprepared-definitions-absent",
    (row) => row.basicDefinitionInputs,
  ],
  [
    "authored-worldAcceleration-no-dynamics",
    (row) => row.noWorldAccelerationCurve,
  ],
  [
    "authored-numeric-input-and-output-equality",
    (row) => row.authoredParameterOutputs,
  ],
  [
    "fixed-original-all17-environment-input-class",
    (row) => fixed.classes.has(row.encoded),
  ],
]) {
  const next = stageRows.filter(predicate);
  conjunctionOmissions.push(
    ...stageRows
      .filter((row) => !predicate(row))
      .map((row) => ({ key: row.key, stage })),
  );
  conjunctionStages.push({
    stage,
    omitted: stageRows.length - next.length,
    remaining: next.length,
  });
  stageRows = next;
}
const originalBlocks = [];
for (const [name, start, end] of reviewedCode)
  originalBlocks.push({
    name,
    rva: start,
    size: end - start,
    sha256: await sha256(image.subarray(start, end)),
  });
for (const [path, hash] of Object.entries(inputs))
  need(
    (await sha256(await Bun.file(path).bytes())) === hash,
    "Final selection input evidence changed",
  );
const report = {
  schema: 1,
  kind: "original-material-selection-read-class-frontier",
  inputs,
  originalBlocks,
  fixed: fixed.summary,
  selected: selected.summary,
  matchedPrepared: matched.length,
  matchedPreparedWithoutRootCurve: matched.filter((row) => !row.rootCurve)
    .length,
  matchedPreparedWithSourceNoCurveGuard: matched.filter(
    (row) => row.noWorldAccelerationCurve,
  ).length,
  matched,
  noCurveSourceOmissions: selected.noCurveSourceOmissions,
  basicDefinitionOmissions: selected.basicDefinitionOmissions,
  conjunctionStages,
  conjunctionOmissions,
  finalUnprovedGate: {
    dependency: "postload:general-nested-material-input-write-closure-unproved",
    candidatesBlocked: stageRows.length,
    activeAdmission: false,
  },
  conjunctionCandidates: stageRows.map((row) => ({
    key: row.key,
    original: fixed.classes.get(row.encoded).original,
  })),
  scope: {
    fixedOriginalObservationReference: true,
    all17SuppliedEnvironmentsCompared: true,
    rootScalarAndFlagProjectionCompared: true,
    primitiveSourceAndConstructorClassCompared: true,
    graphOwnershipAndRootCopiesChecked: true,
    sourceMaterialNumericPointerPresenceAndReadsCompared: true,
    sourceAbsentSceneDefinitionPointersCompared: true,
    generalNestedPostloadWriteClosureEstablished: false,
    arbitraryPostloadWriteClosureEstablished: false,
    fullAuthoredInputEquivalenceEstablished: false,
    materialAdmissionEstablished: false,
    renderingEstablished: false,
  },
};
await Bun.write(
  `${selectedCache}/research/selected-material-selection-inputs-frontier.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    fixed: report.fixed,
    selected: report.selected,
    matchedPrepared: report.matchedPrepared,
    matchedPreparedWithoutRootCurve: report.matchedPreparedWithoutRootCurve,
    conjunctionStages: report.conjunctionStages,
    scope: report.scope,
  }),
);
