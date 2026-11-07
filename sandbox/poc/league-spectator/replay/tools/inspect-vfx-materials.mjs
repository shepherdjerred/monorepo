// Inspect every prepared material input/output and its browser data adapter.
// This is static/component evidence, not browser rendering or reference pixels.
import { resolve } from "node:path";
import { createLatestVfxMaterials } from "../latest-vfx-materials.mjs";
import { createSelectedNativeMaterialInventory } from "../latest-selected-vfx-material-inventory.mjs";
const [
  decoderArg,
  materialArg,
  drivesArg,
  shaderArg,
  outputArg,
  selectedFlag,
  selectedReference,
] = process.argv.slice(2);
if (
  !outputArg ||
  !(
    process.argv.length === 7 ||
    (process.argv.length === 9 &&
      selectedFlag === "--selected-inventory" &&
      selectedReference)
  )
)
  throw Error(
    "Usage: inspect-vfx-materials.mjs <decoder> <materials> <drives> <shaders> <output>",
  );
const root = resolve(import.meta.dir, ".."),
  decoder = resolve(decoderArg);
const bytes = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer());
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
const raw = await bytes(materialArg),
  meta = JSON.parse(new TextDecoder().decode(raw)),
  profile = await Bun.file(`${decoder}/profile.json`).json();
const quadRaw = await bytes(`${decoder}/vfx-bound-quads.json`),
  quads = JSON.parse(new TextDecoder().decode(quadRaw));
if (meta.quadPackageSha256 !== sha(quadRaw))
  throw Error("Native material asset package changed");
const image = await bytes(`${decoder}/image.bin`);
if (sha(image) !== meta.decoderImageSha256)
  throw Error("Native material decoder image changed");
for (const block of meta.originalBlocks)
  if (sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Native material executed block changed");
for (const [name, expected] of Object.entries(meta.sources))
  if (sha(await bytes(`${root}/tools/${name}`)) !== expected)
    throw Error(`Native material source changed: ${name}`);
const driveRaw = await bytes(drivesArg),
  drives = JSON.parse(new TextDecoder().decode(driveRaw));
if (
  drives.quadPackageSha256 !== meta.quadPackageSha256 ||
  drives.counts.graphs < 10 ||
  drives.counts.drives !== drives.counts.graphs * 8 ||
  drives.counts.restored !== 3
)
  throw Error("Incomplete native erosion-drive evidence");
for (const [name, expected] of Object.entries(drives.sources))
  if (sha(await bytes(`${root}/tools/${name}`)) !== expected)
    throw Error(`Native drive source changed: ${name}`);
for (const block of drives.originalBlocks)
  if (sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Native drive executed block changed");
const shaderRaw = await bytes(`${shaderArg}/package.json`),
  shaders = JSON.parse(new TextDecoder().decode(shaderRaw));
if (shaders.build !== meta.build || shaders.compiler.pipelineVersion !== 4)
  throw Error("Native material shader build mismatch");
const preparedStages = new Set(shaders.stages.map((s) => s.file));
const selectedInventory = selectedReference
  ? await createSelectedNativeMaterialInventory({
      approvedReferenceBytes: await bytes(selectedReference),
      materialBytes: raw,
      boundQuadBytes: quadRaw,
      imageBytes: image,
      profile,
      loadGraph: (file) => bytes(`${decoder}/${file}`),
    })
  : null;
const native = await createLatestVfxMaterials(
  raw,
  sha(raw),
  profile,
  selectedInventory,
);
const unsupported = new Map(),
  selectedPairs = new Map();
let calls = 0,
  vectors = 0,
  scalarChecks = 0,
  customMaterials = 0;
const defaults = quads.initializedGlobals.find((g) => g.rva === 0x253d218);
if (!defaults) throw Error("Original default mult definition was not packaged");
const defaultMult = Uint8Array.from(
  defaults.bytesHex.match(/../g).map((s) => Number.parseInt(s, 16)),
);
const vecHex = (values) => {
  const view = new DataView(new ArrayBuffer(16));
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return Buffer.from(view.buffer).toString("hex");
};
for (const entry of meta.emitters) {
  const ref = quads.templates.find(
    (r) =>
      r.effectId === entry.effectId && r.emitterIndex === entry.emitterIndex,
  );
  if (!ref || ref.sha256 !== entry.graphSha256)
    throw Error(
      "Native material emitter is absent from the complete graph package",
    );
  const graphRaw = await bytes(`${decoder}/${ref.file}`),
    graph = JSON.parse(new TextDecoder().decode(graphRaw));
  if (sha(graphRaw) !== ref.sha256)
    throw Error("Native material graph changed");
  const object = Buffer.from(graph.assetObjectHex, "hex"),
    view = new DataView(object.buffer, object.byteOffset, object.byteLength);
  if (view.getBigUint64(0x68, true)) customMaterials++;
  const heap = Buffer.from(graph.segments[1].bytesHex, "hex");
  const ptr = Number(view.getBigUint64(0x230, true));
  const mult = ptr
    ? heap.subarray(
        ptr - graph.assetHeapStart,
        ptr - graph.assetHeapStart + 0xa8,
      )
    : defaultMult;
  if (mult.length < 0xa8)
    throw Error("Native mult definition is outside the owned asset graph");
  const multView = new DataView(mult.buffer, mult.byteOffset, mult.byteLength);
  for (const [name, columns, rows] of [
    ["TEXTURE_INFO", view.getFloat32(0x8c, true), view.getFloat32(0x90, true)],
    [
      "TEXTURE_INFO_2",
      multView.getFloat32(0x10, true),
      multView.getFloat32(0x14, true),
    ],
  ]) {
    const parameter = entry.parameters.find((p) => p.name === name);
    if (
      parameter.bytesHex !==
      vecHex([
        columns,
        columns === 0 ? 0 : Math.fround(1 / columns),
        rows === 0 ? 0 : Math.fround(1 / rows),
        0,
      ])
    )
      throw Error(
        "Native atlas parameter differs from the byte-level field calculation",
      );
    scalarChecks++;
  }
  if (
    entry.parameters.find((p) => p.name === "PARTICLE_DEPTH_PUSH_PULL")
      .bytesHex !== vecHex([view.getFloat32(0x33c, true), 0, 0, 0])
  )
    throw Error("Native push/pull differs from its loaded field");
  scalarChecks++;
  for (const probe of entry.probes) {
    const described = native.describe(
      entry.effectId,
      entry.emitterIndex,
      probe.input,
      { erosionDrive: entry.erosionParameters.length ? 0.5 : null },
    );
    const result = meta.resultCatalog[probe.result];
    if (
      described.vertex !== result.selection.vertex ||
      described.pixel !== result.selection.pixel ||
      described.renderStateHex !== result.renderState.bytesHex ||
      described.programPrefixHex !== result.renderState.programPrefixHex ||
      JSON.stringify(described.defines) !==
        JSON.stringify(result.renderState.defines) ||
      JSON.stringify(described.samplers) !== JSON.stringify(entry.samplers)
    )
      throw Error("Browser material description changed native results");
    for (const parameter of [
      ...entry.parameters,
      ...entry.erosionParameters,
      ...result.renderState.uniforms,
    ]) {
      if (
        vecHex([...described.parameters.get(parameter.name)]) !==
        parameter.bytesHex
      )
        throw Error("Browser material vector differs from native bytes");
      vectors++;
    }
    const alpha = result.renderState.uniforms.find(
      (p) => p.name === "AlphaTestReferenceValue",
    );
    if (
      alpha &&
      alpha.bytesHex !== vecHex([Math.fround(object[0x77] / 255), 0, 0, 0])
    )
      throw Error("Native alpha threshold differs from its loaded byte field");
    const selected = [
      described.vertex.toLowerCase(),
      described.pixel.toLowerCase(),
    ];
    selectedPairs.set(
      selected.join("|"),
      (selectedPairs.get(selected.join("|")) ?? 0) + 1,
    );
    for (const file of selected)
      if (!preparedStages.has(file))
        unsupported.set(file, (unsupported.get(file) ?? 0) + 1);
    calls++;
  }
}
if (customMaterials)
  throw Error(
    "Custom materials were incorrectly admitted to the default-material component",
  );
let driveCalls = 0;
for (const sample of drives.cases) {
  const entry = meta.emitters.find(
    (e) =>
      e.effectId === sample.effectId && e.emitterIndex === sample.emitterIndex,
  );
  if (!entry || entry.graphSha256 !== sample.graphSha256)
    throw Error("Drive sample graph is absent from material preparation");
  for (const output of sample.outputs) {
    const encoded = Buffer.from(output.driveHex, "hex"),
      drive = encoded.readFloatLE(0);
    const described = native.describe(
      entry.effectId,
      entry.emitterIndex,
      entry.probes[0].input,
      { erosionDrive: drive },
    );
    for (const parameter of output.parameters)
      if (
        vecHex([...described.parameters.get(parameter.name)]) !==
        parameter.bytesHex
      )
        throw Error(
          "Browser erosion drive differs from original native computation",
        );
    driveCalls++;
  }
}
const result = {
  schema: 1,
  kind: "native-material-component-inspection",
  build: meta.build,
  materialPackageSha256: sha(raw),
  quadPackageSha256: sha(quadRaw),
  driveEvidenceSha256: sha(driveRaw),
  shaderPackageSha256: sha(shaderRaw),
  moduleSha256: sha(await bytes(`${root}/latest-vfx-materials.mjs`)),
  inspectorSha256: sha(await bytes(import.meta.path)),
  ...(selectedInventory
    ? {
        selectedInventory: {
          policy: selectedInventory.policy,
          emitters: selectedInventory.emitters,
          approvedReferenceSha256: sha(await bytes(selectedReference)),
          completeBoundGraphInventory: true,
          original17ProbeEnvironmentsPerEmitter: true,
        },
      }
    : {}),
  counts: {
    emitters: meta.emitters.length,
    calls,
    vectors,
    scalarChecks,
    driveCalls,
  },
  missingPreparedShaders: [...unsupported].map(([file, selections]) => ({
    file,
    selections,
  })),
  selectedPairs: [...selectedPairs].map(([files, selections]) => ({
    files: files.split("|"),
    selections,
  })),
  scope: {
    mismatchCount: 0,
    browserRun: false,
    gpuSubmitted: false,
    resourceAcquisition: false,
    mainViewerIntegrated: false,
    referencePixelsCompared: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    counts: result.counts,
    missingPreparedShaders: result.missingPreparedShaders,
  }),
);
