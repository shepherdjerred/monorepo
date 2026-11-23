import path from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  readOriginalRigOrdinalSource,
  validateOrdinalModelLayout,
} from "../ordinal-model-bindings.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [sceneRoot, outputFile] = process.argv.slice(2);
if (!sceneRoot || !outputFile || process.argv.length !== 4)
  throw Error(
    "Usage: bun verify-map11-runtime-scene.mjs <runtime/public/latest-scene> <output.json>",
  );
const inputs = {};
async function raw(file) {
  const bytes = await Bun.file(file).bytes(),
    hash = await sha256(bytes);
  file = path.resolve(file);
  if (inputs[file] && inputs[file] !== hash)
    throw Error("Scene readback input changed");
  inputs[file] = hash;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const manifest = decode(await raw(path.join(sceneRoot, "manifest.json")));
if (
  manifest.kind !== "archived-map11-common-runtime-scene" ||
  manifest.map.id !== 11 ||
  manifest.spectatorAdmission !== false ||
  !Array.isArray(manifest.files)
)
  throw Error("Explicit partial Map11 runtime scene required");
const declared = new Map();
for (const ref of manifest.files) {
  if (
    !/^[-A-Za-z0-9_./]+$/.test(ref.path) ||
    ref.path.startsWith("/") ||
    ref.path
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    declared.has(ref.path)
  )
    throw Error("Unique closed runtime scene path required");
  declared.set(ref.path, ref);
}
async function resource(file) {
  const ref = declared.get(file);
  if (!ref)
    throw Error("Runtime scene resource outside closed inventory: " + file);
  const bytes = await raw(path.join(sceneRoot, file));
  if (bytes.length !== ref.bytes || (await sha256(bytes)) !== ref.sha256)
    throw Error("Runtime scene resource identity differs: " + file);
  return bytes;
}
for (const file of declared.keys()) await resource(file);
const world = decode(await resource(manifest.world));
let joints = 0,
  paletteEntries = 0;
const models = [];
for (const [actor, asset] of Object.entries({
  ...manifest.champions,
  ...world.assets,
})) {
  if (asset.rigJointBindingKind !== "original-rig-ordinal-model-bindings")
    throw Error("Original ordinal model binding required: " + actor);
  if (
    actor.startsWith("neutral/") &&
    !asset.rigJointBindings.startsWith("neutral/")
  )
    throw Error(
      "Neutral ordinal sidecar must remain in its explicit namespace",
    );
  const model = await resource(asset.model),
    bindingBytes = await resource(asset.rigJointBindings),
    bindings = decode(bindingBytes),
    folder = path.posix.dirname(asset.model),
    rig = await resource(folder + "/model.skl"),
    mesh = await resource(folder + "/model.skn");
  if (
    bindings.modelSha256 !== (await sha256(model)) ||
    bindings.rigSha256 !== (await sha256(rig)) ||
    bindings.meshSha256 !== (await sha256(mesh))
  )
    throw Error("Original ordinal source identity differs: " + actor);
  const view = new DataView(model.buffer, model.byteOffset, model.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== model.length ||
    view.getUint32(16, true) !== 0x4e4f534a
  )
    throw Error("Bounded original ordinal GLB required");
  const length = view.getUint32(12, true);
  if (20 + length > model.length)
    throw Error("Ordinal GLB JSON escaped resource");
  const gltf = decode(model.subarray(20, 20 + length)),
    source = readOriginalRigOrdinalSource(rig);
  validateOrdinalModelLayout({ bindings, gltf, ...source });
  joints += source.sourceJoints.length;
  paletteEntries += source.sourcePalette.length;
  models.push({
    actor,
    model: asset.model,
    jointBindings: asset.rigJointBindings,
    joints: source.sourceJoints.length,
    palette: source.sourcePalette.length,
  });
}
for (const [file, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(file).bytes())) !== hash)
    throw Error("Runtime scene changed during readback");
await Bun.write(
  path.resolve(outputFile),
  JSON.stringify(
    {
      schema: 1,
      kind: "verified-map11-common-scene-closure",
      inputs,
      files: declared.size,
      models,
      joints,
      paletteEntries,
      scope: {
        closedInventoryVerified: true,
        rawRigNodeOrdinalLayoutVerified: true,
        nativeAnimationOrWorldAcceptance: false,
        nativeSpectatorAdmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    files: declared.size,
    models: models.length,
    joints,
    paletteEntries,
    nativeSpectatorAdmitted: false,
  }),
);
