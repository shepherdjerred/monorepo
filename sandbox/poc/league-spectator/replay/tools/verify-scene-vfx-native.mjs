import path from "node:path";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";

const [nativeArg, fieldsArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun verify-scene-vfx-native.mjs <approved-native-package> <original-field-inputs> <closed-scene-native-vfx>",
  );
const root = path.resolve(outputArg),
  fieldRoot = path.resolve(fieldsArg),
  inputBytes = await Bun.file(path.join(fieldRoot, "manifest.json")).bytes(),
  inputs = JSON.parse(new TextDecoder().decode(inputBytes)),
  bytes = await Bun.file(path.join(root, "manifest.json")).bytes(),
  manifest = JSON.parse(new TextDecoder().decode(bytes)),
  image = await Bun.file(path.join(nativeArg, "image.bin")).bytes(),
  selected = new Map(),
  seen = new Set(),
  statuses = {};
if (
  manifest.kind !== "original-scene-vfx-native-authority" ||
  manifest.inputManifestSha256 !== sha(inputBytes) ||
  manifest.nativeSpectatorAdmitted !== false ||
  manifest.emitters.length !== inputs.emitters.length ||
  manifest.scope.completeInputInventory !== true ||
  manifest.scope.fullPristineMathInitializer !== true
)
  throw Error("Complete original native VFX authority required");
for (const entry of manifest.files) {
  sceneAnimationFilePath(entry.file);
  if (selected.has(entry.file)) throw Error("Duplicate native VFX resource");
  selected.set(entry.file, entry);
}
async function read(file) {
  sceneAnimationFilePath(file);
  const expected = selected.get(file);
  if (!expected) throw Error("Unselected native VFX resource");
  const bytes = await Bun.file(path.join(root, file)).bytes();
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256)
    throw Error(`Native VFX resource changed: ${file}`);
  return bytes;
}
for (const file of selected.keys()) await read(file);
for (const block of manifest.originalBlocks)
  if (
    !Number.isSafeInteger(block.rva) ||
    !Number.isSafeInteger(block.size) ||
    block.rva < 0 ||
    block.size <= 0 ||
    block.rva + block.size > image.length ||
    sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256
  )
    throw Error("Original native VFX instruction block differs");
for (const [file, digest] of Object.entries(manifest.sources))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error(`Native VFX evaluator source differs: ${file}`);
let fieldGraphs = 0,
  postloadGraphs = 0,
  boundQuads = 0;
for (const record of manifest.emitters) {
  if (seen.has(record.inputIndex))
    throw Error("Duplicate native VFX input index");
  seen.add(record.inputIndex);
  const source = inputs.emitters[record.inputIndex];
  if (
    !source ||
    source.effectId !== record.effectId ||
    source.emitterIndex !== record.emitterIndex ||
    source.definitionSha256 !== record.sourceDefinitionSha256 ||
    source.binSha256 !== record.sourceBinSha256 ||
    source.kind !== record.kind ||
    source.classHash !== record.classHash
  )
    throw Error("Native VFX original source identity differs");
  statuses[record.status] = (statuses[record.status] ?? 0) + 1;
  const graphs = {};
  for (const [role, resource] of Object.entries(record.resources)) {
    const bytes = await read(resource.file);
    if (bytes.length !== resource.bytes || sha(bytes) !== resource.sha256)
      throw Error("Native VFX role identity differs");
    graphs[role] = JSON.parse(new TextDecoder().decode(bytes));
  }
  if (record.status === "unsupported-original-emitter-class") {
    if (Object.keys(graphs).length)
      throw Error("Unsupported emitter root gained native graphs");
    continue;
  }
  if (record.status === "unsupported-original-asset-class") {
    if (!record.reason || Object.keys(graphs).length)
      throw Error("Unsupported asset class lost explicit boundary");
    continue;
  }
  if (
    !graphs.fields ||
    !graphs.postload ||
    graphs.fields.phase !== "serialized-fields-before-postload" ||
    graphs.postload.phase !== "native-postload-callbacks-executed"
  )
    throw Error("Complete field/postload role data required");
  fieldGraphs++;
  postloadGraphs++;
  if (record.status === "native-bound-quad-prepared") {
    const quad = graphs.boundQuad;
    if (
      !quad ||
      quad.effectId !== source.effectId ||
      quad.emitterIndex !== source.emitterIndex ||
      quad.sourceDefinitionSha256 !== source.definitionSha256 ||
      quad.postloadGraphSha256 !== record.resources.postload.sha256 ||
      quad.assetObjectHex !== graphs.postload.objectHex ||
      quad.assetHeapStart !== graphs.postload.heapStart ||
      quad.segments[1].bytesHex !== graphs.postload.heapHex ||
      quad.segments[0].bytesHex.slice(0, 0x470 * 2) !==
        graphs.postload.objectHex ||
      !["camera", "arbitrary"].includes(quad.primitiveKind)
    )
      throw Error(
        "Native quad changed the complete postloaded source object/heap",
      );
    boundQuads++;
  } else if (
    ![
      "unsupported-native-quad-environment",
      "unsupported-native-quad-postload-boundary",
    ].includes(record.status) ||
    !record.reason ||
    graphs.boundQuad
  )
    throw Error("Unknown native VFX capability boundary");
}
if (
  seen.size !== inputs.emitters.length ||
  JSON.stringify(statuses) !== JSON.stringify(manifest.statuses)
)
  throw Error("Native VFX complete input/status coverage differs");
console.log(
  JSON.stringify({
    manifestSha256: sha(bytes),
    inputIndices: seen.size,
    resourcesVerified: selected.size,
    fieldGraphs,
    postloadGraphs,
    boundQuads,
    statuses,
    nativeSpectatorAdmitted: false,
  }),
);
