// A new scene wrapper keeps the original observation receipts and their scene
// identities. Reuse is admitted only for identical original serialized inputs.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import {
  matchOriginalVfxBodies,
  originalVfxBodyInputIdentity,
} from "./scene-vfx-body-identity.mjs";

const [
  sourceArg,
  oldFieldsArg,
  oldNativeArg,
  newFieldsArg,
  extensionFieldsArg,
  extensionNativeArg,
  cacheArg,
] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun compose-scene-vfx-native.mjs <approved-cache> <old-fields> <old-native> <new-fields> <extension-fields> <extension-native> <archive-cache>",
  );
const { sourceCache, out } = await createStaticPreparationOutput(
  sourceArg,
  cacheArg,
  { prefix: "vfx-composed-native-", directory: "scene-vfx-native" },
);
const decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  consumed = new Map(),
  files = [];
async function authority(root) {
  const file = path.resolve(root, "manifest.json"),
    raw = await Bun.file(file).bytes();
  consumed.set(file, sha(raw));
  return { root: path.resolve(root), raw, meta: decode(raw), sha256: sha(raw) };
}
const oldFields = await authority(oldFieldsArg),
  oldNative = await authority(oldNativeArg),
  newFields = await authority(newFieldsArg),
  extFields = await authority(extensionFieldsArg),
  extNative = await authority(extensionNativeArg);
for (const [fields, native] of [
  [oldFields, oldNative],
  [extFields, extNative],
]) {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("verify-scene-vfx-native.mjs", import.meta.url)),
      path.join(sourceCache, "public/decoder-16.21-macos"),
      fields.root,
      native.root,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0)
    throw Error(
      "Original body authority verification failed before composition",
    );
}
const match = matchOriginalVfxBodies({
  oldInputs: oldFields.meta,
  oldAuthority: oldNative.meta,
  newInputs: newFields.meta,
});
if (
  extFields.meta.parentInputManifestSha256 !== newFields.sha256 ||
  JSON.stringify(extFields.meta.parentInputIndices) !==
    JSON.stringify(match.missing) ||
  extNative.meta.inputManifestSha256 !== extFields.sha256 ||
  JSON.stringify(oldNative.meta.sources) !==
    JSON.stringify(extNative.meta.sources) ||
  JSON.stringify(oldNative.meta.initializer) !==
    JSON.stringify(extNative.meta.initializer)
)
  throw Error("Exact extension input/evaluator/initializer authority differs");
if (
  extFields.meta.emitters.length !== match.missing.length ||
  extNative.meta.emitters.length !== match.missing.length
)
  throw Error("Incomplete original body extension");
const records = Array(newFields.meta.emitters.length),
  parents = [];
async function write(file, bytes) {
  sceneAnimationFilePath(file);
  const target = path.join(out, file);
  await mkdir(path.dirname(target), { recursive: true });
  await Bun.write(target, bytes);
  files.push({ file, bytes: bytes.length, sha256: sha(bytes) });
}
for (const parent of [oldNative, extNative]) {
  const prefix = `observations/${parent === oldNative ? "original" : "extension"}/`;
  await write(prefix + "manifest.json", parent.raw);
  for (const expected of parent.meta.files) {
    sceneAnimationFilePath(expected.file);
    const source = path.join(parent.root, expected.file),
      bytes = await Bun.file(source).bytes();
    if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256)
      throw Error("Original body resource changed during composition");
    consumed.set(source, expected.sha256);
    await write(prefix + expected.file, bytes);
  }
  parents.push({
    file: prefix + "manifest.json",
    bytes: parent.raw.length,
    sha256: parent.sha256,
    sceneManifestSha256: parent.meta.sceneManifestSha256,
    inputManifestSha256: parent.meta.inputManifestSha256,
  });
  const bindings =
    parent === oldNative
      ? match.reused.map((row) => ({
          inputIndex: row.inputIndex,
          originalInputIndex: row.originalInputIndex,
        }))
      : match.missing.map((inputIndex, originalInputIndex) => ({
          inputIndex,
          originalInputIndex,
        }));
  for (const { inputIndex, originalInputIndex } of bindings) {
    const original = parent.meta.emitters.find(
        (row) => row.inputIndex === originalInputIndex,
      ),
      parentInputs = parent === oldNative ? oldFields.meta : extFields.meta;
    if (
      !original ||
      records[inputIndex] ||
      originalVfxBodyInputIdentity(newFields.meta.emitters[inputIndex]) !==
        originalVfxBodyInputIdentity(parentInputs.emitters[originalInputIndex])
    )
      throw Error("Composed native body source identity differs");
    records[inputIndex] = {
      ...original,
      inputIndex,
      observation: { authoritySha256: parent.sha256, originalInputIndex },
      resources: Object.fromEntries(
        Object.entries(original.resources).map(([role, resource]) => [
          role,
          { ...resource, file: prefix + resource.file },
        ]),
      ),
    };
  }
}
if (records.filter(Boolean).length !== newFields.meta.emitters.length)
  throw Error("Composed native body inventory incomplete");
for (const [name, parent] of [
  ["original-fields", oldFields],
  ["extension-fields", extFields],
  ["scene-fields", newFields],
])
  await write(`inputs/${name}.json`, parent.raw);
const statuses = {};
for (const record of records)
  statuses[record.status] = (statuses[record.status] ?? 0) + 1;
const profile = await Bun.file(
    path.join(sourceCache, "public/decoder-16.21-macos/profile.json"),
  ).bytes(),
  image = await Bun.file(
    path.join(sourceCache, "public/decoder-16.21-macos/image.bin"),
  ).bytes();
const blocks = new Map();
for (const block of [
  ...oldNative.meta.originalBlocks,
  ...extNative.meta.originalBlocks,
]) {
  if (
    blocks.has(block.rva) &&
    JSON.stringify(blocks.get(block.rva)) !== JSON.stringify(block)
  )
    throw Error("Original instruction block identity conflicts");
  blocks.set(block.rva, block);
}
const manifest = {
  schema: 1,
  kind: "original-scene-vfx-composed-native-authority",
  build: newFields.meta.build,
  protocol: newFields.meta.protocol,
  sceneManifestSha256: newFields.meta.sceneManifestSha256,
  effectsManifestSha256: newFields.meta.effectsManifestSha256,
  inputManifestSha256: newFields.sha256,
  baseProfileSha256: sha(profile),
  decoderImageSha256: sha(image),
  sources: oldNative.meta.sources,
  initializer: oldNative.meta.initializer,
  originalBlocks: [...blocks.values()],
  emitters: records,
  statuses,
  parents,
  files,
  scope: {
    completeInputInventory: true,
    identicalSerializedInputsOnly: true,
    historicalObservationLineageRetained: true,
    fullPristineMathInitializer: true,
    assetLoading: false,
    actualScenePredicates: false,
    materialAcquisition: false,
    shaderSubmission: false,
    matchActivation: false,
    nativeRendererAdmitted: false,
  },
  nativeSpectatorAdmitted: false,
};
for (const [file, digest] of consumed)
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Composed native source changed before publication");
for (const entry of files) {
  const bytes = await Bun.file(path.join(out, entry.file)).bytes();
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
    throw Error("Composed native output readback differs");
}
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(
  JSON.stringify({
    output: out,
    emitters: records.length,
    reused: match.reused.length,
    exported: match.missing.length,
    statuses,
    nativeSpectatorAdmitted: false,
  }),
);
