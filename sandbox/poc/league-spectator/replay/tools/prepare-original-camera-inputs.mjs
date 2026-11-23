// Recover authored CLASSIC camera fields from the complete original archive.
// Missing properties remain absent; native defaults and camera behavior require
// their own original-constructor/consumer controls.
import path from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash, MAP11_RELEASE_SHA256 } from "./map-scene-assets.mjs";
import {
  ACTOR_META_SOURCE_SHA256,
  readActorMetaNames,
  normalizeActorBin,
} from "./archived-actor-bin.mjs";
import { captureResearchSourceClosure } from "./research-source-closure.mjs";

const [receiptArg, sourceArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun prepare-original-camera-inputs.mjs <complete-shader-installation-manifest.json> <approved-source-cache> <fresh-output-directory>",
  );
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function fileSha(file) {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file).stream()) hash.update(chunk);
  return hash.digest("hex");
}
const sourceBefore = await captureResearchSourceClosure([
    new URL(import.meta.url),
  ]),
  receiptFile = await realpath(receiptArg),
  receiptBytes = await Bun.file(receiptFile).bytes(),
  receipt = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(receiptBytes),
  ),
  sourceCache = await realpath(sourceArg);
if (
  receipt.schema !== 1 ||
  receipt.kind !== "archived-original-controller-bootstrap-with-shaders" ||
  receipt.build !== "16.21.829.8620" ||
  receipt.protocol !== "20e09df23c66b85e" ||
  receipt.releaseManifestId !== "B499FB04B1158CF6" ||
  receipt.releaseManifestSha256 !== MAP11_RELEASE_SHA256 ||
  receipt.scope?.completeOriginalFiles !== true ||
  receipt.files?.length !== 7
)
  throw Error("Complete original seven-file installation authority required");
const installation = await realpath(receipt.installationRoot),
  globalName = "DATA/FINAL/Global.wad.client",
  globalRows = receipt.files.filter((row) => row.originalName === globalName),
  executableRows = receipt.files.filter(
    (row) => row.originalName === "League of Legends.exe",
  );
if (
  globalRows.length !== 1 ||
  globalRows[0].bytes !== 1027672524 ||
  globalRows[0].sha256 !==
    "0664517f47ee9883bbb9d3ce831c11596aa19dc2e3aaf9be80ceb5746b24a7bc" ||
  executableRows.length !== 1 ||
  executableRows[0].sha256 !==
    "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a"
)
  throw Error("Exact original Global archive/executable identities required");
const globalFile = await realpath(path.join(installation, "Game", globalName)),
  executableFile = await realpath(
    path.join(installation, "Game", "League of Legends.exe"),
  ),
  metadataFile = await realpath(
    path.join(
      sourceCache,
      "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
    ),
  ),
  decompressorFile = await realpath(
    path.join(sourceCache, "public/vendor/fzstd.mjs"),
  ),
  metadata = await Bun.file(metadataFile).bytes(),
  inputs = {
    [receiptFile]: sha(receiptBytes),
    [globalFile]: await fileSha(globalFile),
    [executableFile]: await fileSha(executableFile),
    [metadataFile]: sha(metadata),
    [decompressorFile]: await fileSha(decompressorFile),
  };
if (
  Bun.file(globalFile).size !== globalRows[0].bytes ||
  inputs[globalFile] !== globalRows[0].sha256 ||
  inputs[executableFile] !== executableRows[0].sha256 ||
  inputs[metadataFile] !== ACTOR_META_SOURCE_SHA256
)
  throw Error("Original camera archive, executable or annotations changed");
const { decompress } = await import(pathToFileURL(decompressorFile).href),
  read = await openLocalWad(installation, globalName, decompress),
  bytes = await read("globals");
if (
  sha(bytes) !==
  "7aea41e5f9a1ad4684711e410c37d126edbbc70cf9209bdde2a87e2f36a744aa"
)
  throw Error("Original globals BIN identity differs");
const tree = readExactMapBin(bytes, receipt.build, { captureFieldSpans: true }),
  objectPath = "Globals/CameraConfig_CLASSIC",
  candidates = tree.objects.filter(
    (row) => row.pathHash === mapBinHash(objectPath),
  );
if (
  candidates.length !== 1 ||
  candidates[0].classHash !== mapBinHash("CameraConfig")
)
  throw Error("Unique authored CLASSIC CameraConfig required");
const object = candidates[0],
  names = readActorMetaNames(new TextDecoder().decode(metadata)),
  normalized = normalizeActorBin({ ...tree, objects: [object] }, names, [
    objectPath,
  ]),
  fields = object.fieldSpans.map((span) => ({
    ...span,
    sha256: sha(bytes.subarray(span.offset, span.offset + span.bytes)),
  }));
for (const [file, digest] of Object.entries(inputs))
  if ((await fileSha(file)) !== digest)
    throw Error("Original camera input changed during acquisition: " + file);
const sourceAfter = await captureResearchSourceClosure([
  new URL(import.meta.url),
]);
if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter))
  throw Error("Camera acquisition producer changed during execution");
const output = path.resolve(outputArg),
  parent = await realpath(path.dirname(output)),
  canonical = path.join(parent, path.basename(output)),
  fold = (value) =>
    process.platform === "win32" ? value.toLowerCase() : value;
for (const root of [sourceCache, installation])
  if (
    fold(canonical) === fold(root) ||
    fold(canonical).startsWith(fold(root) + path.sep)
  )
    throw Error(
      "Camera outputs must be outside retained source/installation roots",
    );
await mkdir(canonical);
const sourceFile = path.join(canonical, "globals.bin"),
  result = {
    schema: 1,
    kind: "original-classic-camera-field-input",
    build: receipt.build,
    protocol: receipt.protocol,
    source: { file: sourceFile, bytes: bytes.length, sha256: sha(bytes) },
    objectPath,
    object: {
      pathHash: object.pathHash,
      classHash: object.classHash,
      fields: object.fields,
    },
    fields,
    normalized,
    inputs,
    sourceBefore,
    sourceAfter,
    scope: {
      originalArchivedFields: true,
      missingPropertiesSynthesized: false,
      nativeDefaultsProved: false,
      originalCameraConsumerExecuted: false,
      browserCameraAdmitted: false,
      nativeSpectatorAdmitted: false,
    },
  };
await Bun.write(sourceFile, bytes);
if ((await fileSha(sourceFile)) !== result.source.sha256)
  throw Error("Original camera BIN output readback differs");
await Bun.write(path.join(canonical, "manifest.json"), JSON.stringify(result));
console.log(
  JSON.stringify({ output: canonical, fields: fields.length, normalized }),
);
