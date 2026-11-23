import path from "node:path";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { assertSelectedMaterialTextureInventory } from "../latest-selected-material-textures.mjs";
const [configArg, pixelArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun extend-selected-scene-pixel-config.mjs <explicit-material-config.json> <scene-pixel-authority-root> <output.json>",
  );
const inputs = {},
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
async function raw(file) {
  const bytes = await Bun.file(file).bytes();
  inputs[path.resolve(file)] = sha(bytes);
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const config = decode(await raw(configArg)),
  root = path.resolve(pixelArg),
  bytes = await raw(path.join(root, "manifest.json")),
  manifest = decode(bytes),
  authority = "materialPixels";
if (
  manifest.kind !== "prepared-scene-material-pixels" ||
  manifest.schema !== 1 ||
  config.plan.sources[authority] ||
  config.roots[authority]
)
  throw Error("Fresh explicit scene-pixel source authority required");
const effectsRef = config.plan.files[config.roles.effects],
  quadRef = config.plan.files[config.roles.quadGpu];
if (
  manifest.effectsManifestSha256 !== effectsRef.sha256 ||
  manifest.quadGpuSha256 !== quadRef.sha256
)
  throw Error("Scene pixel authority parent differs from selected effects/GPU");
config.roots[authority] = root;
config.plan.sources[authority] = {
  kind: "prepared-scene-package",
  identity: { file: "manifest.json", bytes: bytes.length, sha256: sha(bytes) },
};
config.plan.files["scene-material-pixels/manifest.json"] = {
  source: { authority, file: "manifest.json" },
  bytes: bytes.length,
  sha256: sha(bytes),
};
let metadata = null;
for (const ref of manifest.files) {
  if (ref.file !== "package.json" && !/^rgba-[a-f0-9]{64}\.bin$/.test(ref.file))
    throw Error("Unknown scene pixel output filename");
  const payload = await raw(path.join(root, ref.file));
  if (payload.length !== ref.bytes || sha(payload) !== ref.sha256)
    throw Error("Scene pixel authority output differs");
  const target = "latest-selected-material-textures/" + ref.file;
  if (config.plan.files[target])
    throw Error("Explicit scene pixel target already owned");
  config.plan.files[target] = {
    source: { authority, file: ref.file },
    bytes: ref.bytes,
    sha256: ref.sha256,
  };
  if (ref.file === "package.json") metadata = decode(payload);
}
if (!metadata)
  throw Error("Scene pixel metadata missing from declared output closure");
config.roles.selectedMaterialTextures =
  "latest-selected-material-textures/package.json";
async function selected(ref) {
  const file = path.join(config.roots[ref.source.authority], ref.source.file),
    payload = await raw(file);
  if (payload.length !== ref.bytes || sha(payload) !== ref.sha256)
    throw Error("Selected source byte identity differs");
  return payload;
}
const effectsBytes = await selected(effectsRef),
  quadBytes = await selected(quadRef),
  effects = decode(effectsBytes),
  quad = decode(quadBytes);
assertSelectedMaterialTextureInventory({
  metadata,
  manifest: effects,
  quad,
  manifestSha256: sha(effectsBytes),
  quadSha256: sha(quadBytes),
  catalogFiles: config.plan.files,
});
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Selected scene pixel source changed");
await Bun.write(outputArg, JSON.stringify(config));
console.log(
  JSON.stringify({
    output: outputArg,
    files: Object.keys(config.plan.files).length,
    textures: Object.keys(metadata.textures).length,
    authorities: Object.keys(config.plan.sources).length,
    nativeRendererAdmitted: false,
  }),
);
