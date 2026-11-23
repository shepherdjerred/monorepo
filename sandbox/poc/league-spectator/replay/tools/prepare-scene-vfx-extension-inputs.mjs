// Exact semantic CPU inputs may reuse historical observations. The original
// receipt remains an authority; this creates only the missing-input partition.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import { matchOriginalVfxBodies } from "./scene-vfx-body-identity.mjs";

const [sourceArg, oldFieldsArg, oldNativeArg, newFieldsArg, cacheArg] =
  process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-vfx-extension-inputs.mjs <approved-cache> <old-fields> <old-native> <new-fields> <archive-cache>",
  );
const { sourceCache, out } = await createStaticPreparationOutput(
  sourceArg,
  cacheArg,
  { prefix: "vfx-extension-fields-", directory: "vfx-fields" },
);
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const oldFieldBytes = await Bun.file(
  path.join(oldFieldsArg, "manifest.json"),
).bytes();
const oldNativeBytes = await Bun.file(
  path.join(oldNativeArg, "manifest.json"),
).bytes();
const newFieldBytes = await Bun.file(
  path.join(newFieldsArg, "manifest.json"),
).bytes();
const oldFields = decode(oldFieldBytes),
  oldNative = decode(oldNativeBytes),
  newFields = decode(newFieldBytes);
if (
  oldNative.inputManifestSha256 !== sha(oldFieldBytes) ||
  oldNative.kind !== "original-scene-vfx-native-authority" ||
  oldFields.kind !== "original-scene-vfx-field-inputs" ||
  newFields.kind !== oldFields.kind
)
  throw Error("Exact original field/native parents required");
const verification = Bun.spawn(
  [
    process.execPath,
    fileURLToPath(new URL("verify-scene-vfx-native.mjs", import.meta.url)),
    path.join(sourceCache, "public/decoder-16.21-macos"),
    path.resolve(oldFieldsArg),
    path.resolve(oldNativeArg),
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await verification.exited) !== 0)
  throw Error(
    "Historical native body authority failed independent verification",
  );
// Child receipts bind the pristine image, approved profile and original client;
// compare their recorded digests, rather than trusting wrapper build labels.
const expectedInputs = new Map(
  await Promise.all(
    [
      "public/decoder-16.21-macos/profile.json",
      "public/decoder-16.21-macos/image.bin",
      "research/LeagueofLegends-macos",
    ].map(async (file) => [
      path.resolve(sourceCache, file),
      sha(await Bun.file(path.join(sourceCache, file)).bytes()),
    ]),
  ),
);
for (const child of oldNative.children) {
  sceneAnimationFilePath(child.file);
  const raw = await Bun.file(path.join(oldNativeArg, child.file)).bytes();
  if (raw.length !== child.bytes || sha(raw) !== child.sha256)
    throw Error("Historical native worker receipt changed");
  const receipt = decode(raw);
  if (
    receipt.inputManifestSha256 !== sha(oldFieldBytes) ||
    receipt.decoderImageSha256 !==
      expectedInputs.get(
        path.resolve(sourceCache, "public/decoder-16.21-macos/image.bin"),
      ) ||
    [...expectedInputs].some(
      ([file, digest]) => receipt.inputs[file] !== digest,
    )
  )
    throw Error(
      "Historical native worker image/profile/client identity differs",
    );
}
const { reused, missing } = matchOriginalVfxBodies({
  oldInputs: oldFields,
  oldAuthority: oldNative,
  newInputs: newFields,
});
const files = [],
  selected = new Map(newFields.files.map((entry) => [entry.file, entry]));
async function write(file, bytes) {
  await Bun.write(path.join(out, file), bytes);
  files.push({ file, bytes: bytes.length, sha256: sha(bytes) });
}
const emitters = missing.map((index) => newFields.emitters[index]);
for (const file of new Set(emitters.map((entry) => entry.binFile))) {
  sceneAnimationFilePath(file);
  const expected = selected.get(file),
    bytes = await Bun.file(path.join(newFieldsArg, file)).bytes();
  if (
    !expected ||
    bytes.length !== expected.bytes ||
    sha(bytes) !== expected.sha256
  )
    throw Error("Exact new original source BIN differs");
  await write(file, bytes);
}
const input = {
  schema: 1,
  kind: newFields.kind,
  build: newFields.build,
  protocol: newFields.protocol,
  sceneManifestSha256: newFields.sceneManifestSha256,
  effectsManifestSha256: newFields.effectsManifestSha256,
  emitters,
  nativeSpectatorAdmitted: false,
};
await write("input.json", new TextEncoder().encode(JSON.stringify(input)));
const lineage = {
  schema: 1,
  kind: "original-vfx-body-extension-partition",
  oldInputManifestSha256: sha(oldFieldBytes),
  oldNativeAuthoritySha256: sha(oldNativeBytes),
  newInputManifestSha256: sha(newFieldBytes),
  reused: reused.map(({ inputIndex, originalInputIndex }) => ({
    inputIndex,
    originalInputIndex,
  })),
  missing,
  scope: {
    semanticOriginalByteIdentity: true,
    oldObservationsReexecuted: false,
    nativeRendererAdmitted: false,
  },
};
await write(
  "partition.json",
  new TextEncoder().encode(JSON.stringify(lineage)),
);
for (const [file, bytes] of [
  ["old-field-manifest.json", oldFieldBytes],
  ["old-native-manifest.json", oldNativeBytes],
  ["new-field-manifest.json", newFieldBytes],
])
  await write(file, bytes);
for (const [file, before] of [
  [path.join(oldFieldsArg, "manifest.json"), oldFieldBytes],
  [path.join(oldNativeArg, "manifest.json"), oldNativeBytes],
  [path.join(newFieldsArg, "manifest.json"), newFieldBytes],
])
  if (sha(await Bun.file(file).bytes()) !== sha(before))
    throw Error("VFX partition source authority changed");
const manifest = {
  ...input,
  parentInputManifestSha256: sha(newFieldBytes),
  parentInputIndices: missing,
  partition: "partition.json",
  input: "input.json",
  files,
};
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(
  JSON.stringify({
    output: out,
    reused: reused.length,
    missing: missing.length,
    completeParentInventory: false,
    nativeSpectatorAdmitted: false,
  }),
);
