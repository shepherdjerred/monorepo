// Reuse the existing pixel converter in private staging, with exact new-scene
// inputs copied byte-for-byte. Approved caches and published roots stay read-only.
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [sourceArg, effectsArg, gpuArg, cacheArg] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-material-pixels.mjs <approved-cache> <effects-root> <quad-gpu-root> <archive-cache>",
  );
const { out, runRoot } = await createStaticPreparationOutput(sourceArg, cacheArg, {
    prefix: "mat-pixels-",
    directory: "mat-pixels",
  }),
  stage = path.join(runRoot, "work"),
  inputs = {},
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
async function raw(file) {
  const bytes = await Bun.file(file).bytes();
  inputs[path.resolve(file)] = sha(bytes);
  return bytes;
}
const converter = fileURLToPath(
  new URL("prepare-selected-material-textures.mjs", import.meta.url),
);
await captureDirectSourceInputs([import.meta.path, converter], raw);
const effectsBytes = await raw(path.join(effectsArg, "manifest.json")),
  effects = decode(effectsBytes),
  gpuBytes = await raw(path.join(gpuArg, "package.json")),
  gpu = decode(gpuBytes),
  gpuManifestBytes = await raw(path.join(gpuArg, "manifest.json")),
  gpuManifest = decode(gpuManifestBytes);
if (
  gpu.kind !== "prepared-scene-controlled-quad-gpu-bindings" ||
  gpuManifest.kind !== "prepared-scene-controlled-material-package" ||
  gpu.effectsManifestSha256 !== sha(effectsBytes) ||
  gpuManifest.effectsManifestSha256 !== sha(effectsBytes) ||
  gpu.build !== effects.build ||
  gpu.protocol !== effects.protocol ||
  !gpuManifest.files.some(
    (row) =>
      row.file === "package.json" &&
      row.sha256 === sha(gpuBytes) &&
      row.bytes === gpuBytes.length,
  )
)
  throw Error("Matching immutable scene GPU/effects pixel parents required");
async function copy(target, bytes) {
  const file = path.join(stage, "public", target);
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, bytes);
  if (sha(await Bun.file(file).bytes()) !== sha(bytes))
    throw Error("Scene pixel staging bytes differ");
}
await copy("latest-effects/manifest.json", effectsBytes);
await copy("latest-complete-quad-gpu/package.json", gpuBytes);
const textures = new Map();
for (const emitter of gpu.emitters)
  for (const texture of Object.values(emitter.textures))
    if (texture.kind === "prepared-texture") {
      if (
        !/^textures\/[a-f0-9]{24,64}\.png$/.test(texture.file) ||
        !/^[a-f0-9]{64}$/.test(texture.sha256)
      )
        throw Error("Exact original scene PNG identity required");
      if (
        textures.has(texture.file) &&
        textures.get(texture.file) !== texture.sha256
      )
        throw Error("Ambiguous scene PNG source");
      textures.set(texture.file, texture.sha256);
    }
for (const [file, digest] of textures) {
  const bytes = await raw(path.join(effectsArg, file));
  if (sha(bytes) !== digest) throw Error("Original scene PNG bytes differ");
  await copy("latest-effects/" + file, bytes);
}
const child = Bun.spawn([process.execPath, converter, stage], {
    stdout: "pipe",
    stderr: "pipe",
  }),
  [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
if (exit !== 0)
  throw Error(
    "Original selected pixel converter failed: " +
      stdout.slice(-2000) +
      stderr.slice(-2000),
  );
const pixelRoot = path.join(stage, "public/latest-selected-material-textures"),
  metadataBytes = await Bun.file(path.join(pixelRoot, "package.json")).bytes(),
  metadata = decode(metadataBytes),
  files = [];
for (const [file, ref] of Object.entries(metadata.files)) {
  if (!/^rgba-[a-f0-9]{64}\.bin$/.test(file))
    throw Error("Bounded scene RGBA output identity required");
  const bytes = await Bun.file(path.join(pixelRoot, file)).bytes();
  if (bytes.length !== ref.bytes || sha(bytes) !== ref.sha256)
    throw Error("Scene RGBA converter output differs");
  await Bun.write(path.join(out, file), bytes);
  if (sha(await Bun.file(path.join(out, file)).bytes()) !== ref.sha256)
    throw Error("Scene RGBA publication readback differs");
  files.push({ file, ...ref });
}
await Bun.write(path.join(out, "package.json"), metadataBytes);
files.push({
  file: "package.json",
  bytes: metadataBytes.length,
  sha256: sha(metadataBytes),
});
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Scene pixel preparation source changed");
const manifest = {
  schema: 1,
  kind: "prepared-scene-material-pixels",
  build: gpu.build,
  protocol: gpu.protocol,
  effectsManifestSha256: sha(effectsBytes),
  quadGpuSha256: sha(gpuBytes),
  gpuAuthoritySha256: sha(gpuManifestBytes),
  files,
  inputs,
  scope: {
    staticPixelConversionOnly: true,
    sourcePngPixelsCompared: true,
    nativeMaterialAdmissionEstablished: false,
    nativeRendererAdmitted: false,
  },
};
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(
  JSON.stringify({
    output: out,
    textures: Object.keys(metadata.textures).length,
    quadBindings: gpu.emitters.length,
    rgbaBytes: files.reduce((sum, row) => sum + row.bytes, 0),
    nativeRendererAdmitted: false,
  }),
);
