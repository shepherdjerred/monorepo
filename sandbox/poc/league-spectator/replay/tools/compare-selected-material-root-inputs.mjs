// Offline source-lowering proof only; this tool does not change admission.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import {
  deriveSelectedMaterialRootInputSpans,
  assertSelectedMaterialRootInputSpans,
  assertSelectedMaterialNoWorldAccelerationCurve,
  SELECTED_MATERIAL_ROOT_INPUT_SOURCE_BLOCKS,
} from "../latest-selected-material-root-inputs.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: compare-selected-material-root-inputs.mjs <cache>");
const cache = resolve(cacheArg),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    h = await sha256(b);
  if (inputs[path] && inputs[path] !== h)
    throw Error("Source proof input changed");
  inputs[path] = h;
  return b;
}
const parse = (b) => JSON.parse(new TextDecoder().decode(b)),
  read = async (p) => parse(await raw(p));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
  `${cache}/research/selected-material-source-fields-native.json`,
);
for (const [p, h] of Object.entries(native.inputs))
  if ((await sha256(await raw(p))) !== h)
    throw Error("Original native source control stale: " + p);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
for (const block of SELECTED_MATERIAL_ROOT_INPUT_SOURCE_BLOCKS) {
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Fixed original source projection block changed");
  const matching = native.sourceRanges.find((b) => b.rva === block.rva);
  if (
    !matching ||
    matching.size !== block.size ||
    matching.sha256 !== block.sha256
  )
    throw Error("Native source projection approval differs");
}
let cases = 0,
  lanes = 0;
for (const c of native.cases) {
  const p = c.property,
    value =
      p.type === 17
        ? `{${c.supplied.toString(16).padStart(8, "0")}}`
        : p.type === 1
          ? Boolean(c.supplied)
          : c.supplied,
    emitter = { [`{${p.hash.toString(16).padStart(8, "0")}}`]: value },
    bytes = Uint8Array.fromHex(native.defaultObjectHex);
  bytes.set(Uint8Array.fromHex(c.loadedHex), p.offset);
  const graph = { assetObjectHex: bytes.toHex() };
  const spans = assertSelectedMaterialRootInputSpans(emitter, graph);
  if (
    !sameDirectCompiledData(
      spans,
      deriveSelectedMaterialRootInputSpans(emitter),
    )
  )
    throw Error("Root projection nondeterministic");
  cases++;
  lanes += spans.reduce((n, s) => n + s.bytesHex.length / 2, 0);
}
const manifest = await read(`${cache}/public/latest-effects/manifest.json`),
  bound = await read(
    `${cache}/public/decoder-16.21-macos/vfx-bound-quads.json`,
  ),
  defs = new Map();
const curveNative = await read(
  `${cache}/research/material-empty-world-acceleration-native.json`,
);
for (const [p, h] of Object.entries(curveNative.inputs))
  if ((await sha256(await raw(p))) !== h)
    throw Error("Original no-curve control stale: " + p);
let noCurveNativeCases = 0;
for (const c of curveNative.cases) {
  const emitter =
      c.source === "absent"
        ? {}
        : {
            worldAcceleration: {
              __type: "IntegratedValueVector3",
              ...(c.source === "empty-class" ? {} : { constantValue: c.value }),
            },
          },
    bytes = Uint8Array.fromHex(native.defaultObjectHex);
  bytes.set(Uint8Array.fromHex(c.objectHex), 0x370);
  assertSelectedMaterialNoWorldAccelerationCurve(emitter, {
    assetObjectHex: bytes.toHex(),
  });
  noCurveNativeCases++;
}
let graphs = 0,
  noCurveGraphs = 0,
  omittedDynamicCurveGraphs = 0;
for (const ref of bound.templates) {
  let d = defs.get(ref.effectId);
  if (!d) {
    const row = manifest.definitions[ref.effectId],
      bytes = await raw(`${cache}/public/latest-effects/${row.file}`);
    if ((await sha256(bytes)) !== row.sha256)
      throw Error("Authored definition bytes differ");
    d = parse(bytes);
    defs.set(ref.effectId, d);
  }
  const bytes = await raw(`${cache}/public/decoder-16.21-macos/${ref.file}`);
  if ((await sha256(bytes)) !== ref.sha256)
    throw Error("Actual native bound graph differs");
  const graph = parse(bytes);
  if (
    graph.sourceDefinitionSha256 !== manifest.definitions[ref.effectId].sha256
  )
    throw Error("Native root graph source differs");
  assertSelectedMaterialRootInputSpans(
    d.definition.complexEmitterDefinitionData[ref.emitterIndex],
    graph,
  );
  try {
    assertSelectedMaterialNoWorldAccelerationCurve(
      d.definition.complexEmitterDefinitionData[ref.emitterIndex],
      graph,
    );
    noCurveGraphs++;
  } catch (error) {
    if (error.message !== "No-dynamics worldAcceleration source required")
      throw error;
    omittedDynamicCurveGraphs++;
  }
  graphs++;
}
for (const [p, h] of Object.entries(inputs))
  if ((await sha256(await Bun.file(p).bytes())) !== h)
    throw Error("Final source projection input changed");
const output = {
  schema: 1,
  kind: "verified-original-material-root-source-projection",
  inputs,
  counts: {
    nativeCases: cases,
    comparedNativeBytes: lanes,
    sourceBoundGraphs: graphs,
    definitions: defs.size,
    noCurveNativeCases,
    noCurveGraphs,
    omittedDynamicCurveGraphs,
  },
  scope: {
    nativeScalarAndBitfieldLowering: true,
    actualGraphSourceComparison: true,
    pointerAndNestedMaterialLowering: false,
    postloadUniversalWriteClosure: false,
    runtimeAdmission: false,
  },
};
await Bun.write(
  `${cache}/research/selected-material-root-inputs-comparison.json`,
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output.counts));
