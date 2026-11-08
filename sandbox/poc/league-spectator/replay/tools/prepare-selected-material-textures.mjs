// Static pixel conversion only. Native material/source admission is performed
// independently by the selected material registry before the renderer loads it.
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";
import {
  decodeLatestRgba8Png,
  SELECTED_RGBA8_PNG_POLICY,
} from "../latest-rgba8-png.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-lineup-5667809143"),
  inputs = {},
  directory = "latest-selected-material-textures",
  out = `${cache}/public/${directory}`;
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Selected texture source changed: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  manifest = decode(manifestBytes),
  quadBytes = await raw(
    `${cache}/public/latest-complete-quad-gpu/package.json`,
  ),
  quad = decode(quadBytes);
if (
  manifest.build !== "16.21.829.8620" ||
  manifest.protocol !== "20e09df23c66b85e" ||
  quad.build !== manifest.build ||
  quad.protocol !== manifest.protocol ||
  quad.effectsManifestSha256 !== (await sha256(manifestBytes)) ||
  quad.counts.emitters !== quad.emitters.length ||
  quad.counts.omitted !== quad.omitted.length ||
  quad.scope.containsReplayData
)
  throw Error("Complete selected static quad source package required");
const assets = new Map();
for (const [path, asset] of Object.entries(manifest.assets))
  if (asset.status === "prepared" && asset.kind === "texture") {
    if (!assets.has(asset.file)) assets.set(asset.file, []);
    assets.get(asset.file).push({ path, asset });
  }
const textures = {},
  files = {},
  uses = {};
await mkdir(out, { recursive: true });
for (const emitter of quad.emitters) {
  if (
    manifest.definitions[emitter.effectId]?.sha256 !==
    emitter.sourceDefinitionSha256
  )
    throw Error("Selected texture material definition differs");
  for (const [uniform, binding] of Object.entries(emitter.textures)) {
    if (binding.kind !== "prepared-texture") {
      if (
        !["supplied-white-lookup", "supplied-transparent-remap"].includes(
          binding.kind,
        )
      )
        throw Error("Unknown selected texture binding kind");
      continue;
    }
    if (
      !/^textures\/[a-f0-9]{24,64}\.png$/.test(binding.file) ||
      !/^[a-f0-9]{64}$/.test(binding.sha256)
    )
      throw Error("Exact selected PNG identity required");
    (uses[binding.sha256] ??= []).push({
      effectId: emitter.effectId,
      emitterIndex: emitter.emitterIndex,
      uniform,
    });
    if (textures[binding.sha256]) {
      if (textures[binding.sha256].sourceFile !== binding.file)
        throw Error("Ambiguous selected PNG path/hash");
      continue;
    }
    const sources = assets.get(binding.file);
    if (
      !sources?.length ||
      sources.some(({ asset }) => asset.sha256 !== binding.sha256)
    )
      throw Error("Selected native PNG absent from effect asset manifest");
    const png = await raw(`${cache}/public/latest-effects/${binding.file}`);
    if ((await sha256(png)) !== binding.sha256)
      throw Error("Selected native PNG bytes differ");
    const pixels = await decodeLatestRgba8Png(png),
      digest = await sha256(pixels.data),
      file = `rgba-${digest}.bin`;
    if (
      sources.some(
        ({ asset }) =>
          asset.width !== pixels.width ||
          asset.height !== pixels.height ||
          asset.bytes !== png.length,
      )
    )
      throw Error(
        "Selected PNG dimensions/length differ from effect asset manifest",
      );
    await Bun.write(`${out}/${file}`, pixels.data);
    if ((await sha256(await Bun.file(`${out}/${file}`).bytes())) !== digest)
      throw Error("Selected RGBA output readback differs");
    textures[binding.sha256] = {
      sourceFile: binding.file,
      sourceSha256: binding.sha256,
      sourceBytes: png.length,
      file,
      sha256: digest,
      bytes: pixels.data.length,
      width: pixels.width,
      height: pixels.height,
    };
    files[file] = { sha256: digest, bytes: pixels.data.length };
  }
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Selected RGBA preparation input changed: ${path}`);
const metadata = {
  schema: 1,
  kind: "prepared-selected-material-rgba8-textures",
  build: manifest.build,
  protocol: manifest.protocol,
  effectsManifestSha256: await sha256(manifestBytes),
  quadGpuSha256: await sha256(quadBytes),
  pngPolicy: SELECTED_RGBA8_PNG_POLICY,
  textures,
  files,
  uses,
  scope: {
    containsReplayData: false,
    selection: "selected-quad-package-declared-texture-closure",
    nativeMaterialAdmissionEstablished: false,
    pixelFormat: "RGBA8",
    rowOrder: "source-top-to-bottom",
    premultiplied: false,
    colorSpaceConversion: false,
    mipmaps: false,
    sourcePngPixelsCompared: true,
    unsupportedFamiliesPrepared: false,
  },
};
const bytes = new TextEncoder().encode(JSON.stringify(metadata, null, 2));
await Bun.write(`${out}/package.json`, bytes);
const report = {
  schema: 1,
  kind: "selected-material-rgba8-preparation",
  inputs,
  packageSha256: await sha256(bytes),
  quadBindings: quad.emitters.length,
  textures: Object.keys(textures).length,
  rgbaBytes: Object.values(textures).reduce((n, row) => n + row.bytes, 0),
  scope: metadata.scope,
};
await Bun.write(
  `${cache}/research/selected-material-textures-preparation.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    out,
    packageSha256: report.packageSha256,
    quadBindings: report.quadBindings,
    textures: report.textures,
    rgbaBytes: report.rgbaBytes,
  }),
);
