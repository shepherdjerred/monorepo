// Author the actual family capability inventory; unavailable families are
// explicit omissions, never empty packages standing in for native preparation.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  SELECTED_MATERIAL_POLICY,
  SELECTED_MATERIAL_FAMILIES,
} from "../latest-selected-materials.mjs";
import { APPROVED_NATIVE_MATERIAL_REFERENCE_SHA } from "../latest-selected-vfx-material-inventory.mjs";
const [cacheArg, nativeArg, colorArg] = process.argv.slice(2);
if (!cacheArg || !nativeArg || !colorArg || process.argv.length !== 5)
  throw Error(
    "Usage: prepare-selected-materials.mjs <cache> <fixed-native-material-reference> <fixed-color-reference>",
  );
const cache = resolve(cacheArg),
  assets = resolve(cache, "public"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Selected material producer input drift");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  quad = await read(`${assets}/latest-complete-quad-gpu/package.json`),
  manifest = await raw(`${assets}/latest-effects/manifest.json`),
  bound = await raw(`${assets}/decoder-16.21-macos/vfx-bound-quads.json`),
  native = await raw(`${cache}/research/vfx-materials-native.json`),
  nativeReference = await raw(nativeArg),
  colorReference = await raw(colorArg),
  pairs = await raw(`${cache}/research/latest-shaders/pairs.json`);
if (
  (await sha256(nativeReference)) !== APPROVED_NATIVE_MATERIAL_REFERENCE_SHA ||
  (await sha256(colorReference)) !==
    "ba06d3700bc3835496ab14811d9b6db1f3acab620afdeef73e8c4a23c15000a3" ||
  quad.effectsManifestSha256 !== (await sha256(manifest)) ||
  quad.quadPackageSha256 !== (await sha256(bound)) ||
  quad.nativeMaterialSha256 !== (await sha256(native))
)
  throw Error(
    "Fixed approved native algorithms and selected quad parents required",
  );
for (const [path, hash] of Object.entries(quad.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Prepared selected quad input changed: " + path);
const directory = `${assets}/latest-selected-materials`;
for (const [file, bytes] of [
  ["native-materials.json", native],
  ["native-material-reference.json", nativeReference],
  ["particle-color-reference.json", colorReference],
  ["shader-pairs.json", pairs],
]) {
  await Bun.write(`${directory}/${file}`, bytes);
  if (
    (await sha256(await Bun.file(`${directory}/${file}`).bytes())) !==
    (await sha256(bytes))
  )
    throw Error("Selected material proof copy differs");
}
const result = {
  schema: 1,
  kind: "selected-original-material-capability-inventory",
  policy: SELECTED_MATERIAL_POLICY,
  mode: "native-quad-partial",
  build: quad.build,
  protocol: quad.protocol,
  effectsManifestSha256: await sha256(manifest),
  quadGpuSha256: await sha256(
    await raw(`${assets}/latest-complete-quad-gpu/package.json`),
  ),
  boundQuadsSha256: await sha256(bound),
  families: SELECTED_MATERIAL_FAMILIES,
  omitted: quad.omitted,
};
await Bun.write(`${directory}/package.json`, JSON.stringify(result, null, 2));
// Explicit static closure for the catalog producer (no directory-wide cache scan).
const files = {},
  normalizedRoot = assets.replaceAll("\\", "/") + "/";
async function addStatic(path) {
  const bytes = await raw(`${assets}/${path}`);
  files[path] = { sha256: await sha256(bytes), bytes: bytes.length };
}
for (const path of Object.keys(quad.inputs)) {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith(normalizedRoot)) {
    const relative = normalized.slice(normalizedRoot.length);
    if (relative !== "decoder-16.21-macos/profile.json")
      await addStatic(relative);
  }
}
for (const row of JSON.parse(new TextDecoder().decode(bound)).templates)
  await addStatic(`decoder-16.21-macos/${row.file}`);
for (const path of [
  "latest-complete-quad-gpu/package.json",
  "decoder-16.21-macos/vfx-bound-quads.json",
  "latest-particle-color/package.json",
  "latest-shaders/package.json",
  ...[
    "package.json",
    "native-materials.json",
    "native-material-reference.json",
    "particle-color-reference.json",
    "shader-pairs.json",
  ].map((n) => `latest-selected-materials/${n}`),
])
  await addStatic(path);
await Bun.write(
  `${directory}/files.json`,
  JSON.stringify({ schema: 1, mode: result.mode, files }, null, 2),
);
await raw(import.meta.path);
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Final selected material source drift");
await Bun.write(
  `${cache}/research/selected-material-preparation.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "authored-selected-native-material-family-inventory",
      inputs,
      packageSha256: await sha256(
        await Bun.file(`${directory}/package.json`).bytes(),
      ),
      families: SELECTED_MATERIAL_FAMILIES,
      scope: {
        realQuadPackagePreserved: true,
        unpreparedFamiliesHaveExplicitComponentOmissions: true,
        syntheticEmptyPackages: false,
        admissionEstablishedByOwnedRuntimeValidator: false,
        replayEventsPrepared: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    packageSha256: await sha256(
      await Bun.file(`${directory}/package.json`).bytes(),
    ),
    families: SELECTED_MATERIAL_FAMILIES,
    quadBindings: quad.emitters.length,
    omitted: quad.omitted.length,
  }),
);
