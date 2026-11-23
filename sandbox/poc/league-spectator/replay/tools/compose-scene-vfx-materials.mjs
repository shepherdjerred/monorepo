// Re-index a new scene without rewriting any historical observation receipt.
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import { sameDirectCompiledData as same } from "../latest-direct-compiled-restore.mjs";
import {
  validateSceneMaterialRows,
  sceneMaterialIdentity,
} from "../scene-vfx-material-data.mjs";

const [
  sourceArg,
  oldNativeArg,
  oldMaterialArg,
  newNativeArg,
  newMaterialArg,
  composedNativeArg,
  cacheArg,
] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun compose-scene-vfx-materials.mjs <approved-cache> <original-native> <original-material> <extension-native> <extension-material> <composed-native> <archive-cache>",
  );
const { sourceCache, out } = await createStaticPreparationOutput(
  sourceArg,
  cacheArg,
  { prefix: "vfx-composed-materials-", directory: "scene-vfx-materials" },
);
const decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  consumed = new Map(),
  files = [];
async function read(root) {
  const file = path.resolve(root, "manifest.json"),
    raw = await Bun.file(file).bytes();
  consumed.set(file, sha(raw));
  return { root: path.resolve(root), raw, meta: decode(raw), sha256: sha(raw) };
}
const oldNative = await read(oldNativeArg),
  oldMaterial = await read(oldMaterialArg),
  newNative = await read(newNativeArg),
  newMaterial = await read(newMaterialArg),
  native = await read(composedNativeArg);
if (
  native.meta.kind !== "original-scene-vfx-composed-native-authority" ||
  !same(oldMaterial.meta.sources, newMaterial.meta.sources) ||
  !same(oldMaterial.meta.runtime, newMaterial.meta.runtime)
)
  throw Error("Exact compatible original material recipe/runtime required");
for (const [body, material] of [
  [oldNative, oldMaterial],
  [newNative, newMaterial],
]) {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("verify-scene-vfx-materials.mjs", import.meta.url)),
      path.join(sourceCache, "public/decoder-16.21-macos"),
      body.root,
      material.root,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0)
    throw Error("Original material authority verification failed");
}
const eligible = native.meta.emitters.filter(
    (row) => row.status === "native-bound-quad-prepared",
  ),
  byObservation = new Map(),
  catalog = [],
  catalogIds = new Map(),
  emitters = [],
  parents = [];
async function write(file, bytes) {
  sceneAnimationFilePath(file);
  const target = path.join(out, file);
  await mkdir(path.dirname(target), { recursive: true });
  await Bun.write(target, bytes);
  files.push({ file, bytes: bytes.length, sha256: sha(bytes) });
}
for (const [body, material] of [
  [oldNative, oldMaterial],
  [newNative, newMaterial],
]) {
  const prefix = `observations/${material === oldMaterial ? "original" : "extension"}/`;
  await write(prefix + "manifest.json", material.raw);
  for (const ref of material.meta.files) {
    sceneAnimationFilePath(ref.file);
    const source = path.join(material.root, ref.file),
      bytes = await Bun.file(source).bytes();
    if (bytes.length !== ref.bytes || sha(bytes) !== ref.sha256)
      throw Error("Original material resource changed during composition");
    consumed.set(source, ref.sha256);
    await write(prefix + ref.file, bytes);
  }
  parents.push({
    file: prefix + "manifest.json",
    bytes: material.raw.length,
    sha256: material.sha256,
    nativeAuthoritySha256: body.sha256,
    sceneManifestSha256: material.meta.sceneManifestSha256,
  });
  for (const record of material.meta.emitters) {
    const key = `${body.sha256}:${sceneMaterialIdentity(record)}`;
    if (byObservation.has(key))
      throw Error("Ambiguous original material observation");
    byObservation.set(key, { record, material });
  }
}
for (const body of eligible) {
  const original = byObservation.get(
    `${body.observation.authoritySha256}:${sceneMaterialIdentity(body)}`,
  );
  if (!original)
    throw Error("Composed body has no original material observation");
  const { record, material } = original;
  if (
    record.graphSha256 !== body.resources.boundQuad.sha256 ||
    record.sourceDefinitionSha256 !== body.sourceDefinitionSha256
  )
    throw Error(
      "Historical material graph/source differs from new body identity",
    );
  const probes = record.probes?.map((probe) => {
    const result = material.meta.resultCatalog[probe.result],
      key = JSON.stringify(result);
    let resultIndex = catalogIds.get(key);
    if (resultIndex === undefined) {
      resultIndex = catalog.length;
      catalogIds.set(key, resultIndex);
      catalog.push(result);
    }
    return { input: probe.input, result: resultIndex };
  });
  emitters.push({
    ...record,
    graphFile: body.resources.boundQuad.file,
    ...(probes ? { probes } : {}),
    observation: {
      authoritySha256: material.sha256,
      originalGraphFile: record.graphFile,
    },
  });
}
const statuses = {};
for (const row of emitters)
  statuses[row.status] = (statuses[row.status] ?? 0) + 1;
const manifest = {
  schema: 1,
  kind: "original-scene-vfx-composed-material-authority",
  build: native.meta.build,
  protocol: native.meta.protocol,
  baseProfileSha256: native.meta.baseProfileSha256,
  decoderImageSha256: native.meta.decoderImageSha256,
  sceneManifestSha256: native.meta.sceneManifestSha256,
  effectsManifestSha256: native.meta.effectsManifestSha256,
  nativeAuthoritySha256: native.sha256,
  sources: oldMaterial.meta.sources,
  runtime: oldMaterial.meta.runtime,
  emitters,
  resultCatalog: catalog,
  statuses,
  parents,
  files,
  scope: {
    completeEligibleGraphInventory: true,
    identicalOriginalGraphBytesOnly: true,
    historicalObservationLineageRetained: true,
    actualScenePredicates: false,
    resourceAcquisition: false,
    materialFactory: false,
    shaderSubmission: false,
    matchActivation: false,
    nativeRendererAdmitted: false,
  },
  nativeSpectatorAdmitted: false,
};
validateSceneMaterialRows(manifest, native.meta);
for (const [file, digest] of consumed)
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Material source changed before composition publication");
for (const ref of files) {
  const raw = await Bun.file(path.join(out, ref.file)).bytes();
  if (raw.length !== ref.bytes || sha(raw) !== ref.sha256)
    throw Error("Composed material output readback differs");
}
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(
  JSON.stringify({
    output: out,
    emitters: emitters.length,
    resultCatalog: catalog.length,
    statuses,
    nativeSpectatorAdmitted: false,
  }),
);
