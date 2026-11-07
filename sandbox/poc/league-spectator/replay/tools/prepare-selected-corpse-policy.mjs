import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { CORPSE_POLICY_SHA } from "../latest-corpse-contract.mjs";
import { assertCorpseSceneRebinding } from "../latest-selected-corpse.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";
const [cacheArg, referenceArg] = process.argv.slice(2);
if (!cacheArg || !referenceArg)
  throw Error(
    "Usage: bun prepare-selected-corpse-policy.mjs <selected-cache> <fixed-original-corpse-package>",
  );
const cache = resolve(cacheArg),
  inputs = {},
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  raw = async (path) => {
    path = resolve(path);
    const bytes = await Bun.file(path).bytes();
    inputs[path] = hash(bytes);
    return bytes;
  },
  decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
  referenceBytes = await raw(referenceArg),
  reference = decode(referenceBytes),
  sceneBytes = await raw(`${cache}/public/latest-scene/manifest.json`),
  scene = decode(sceneBytes),
  worldBytes = await raw(`${cache}/public/latest-scene/${scene.world}`),
  world = decode(worldBytes);
if (
  hash(referenceBytes) !== CORPSE_POLICY_SHA ||
  world.mapId !== scene.map.id ||
  hash(worldBytes) !== reference.worldCatalogSha256
)
  throw Error(
    "Only original identical world assets permit corpse scene-parent rebinding",
  );
for (const asset of Object.values(reference.assets))
  if (
    hash(await raw(`${cache}/public/latest-scene/${asset.catalog}`)) !==
    asset.catalogSha256
  )
    throw Error("Selected authored corpse catalog differs from original proof");
const metadata = { ...reference, sceneManifestSha256: hash(sceneBytes) };
assertCorpseSceneRebinding(reference, metadata, hash(sceneBytes));
await mkdir(`${cache}/public/latest-corpse`, { recursive: true });
const bytes = new TextEncoder().encode(stringifyAssetJson(metadata, 2)),
  out = `${cache}/public/latest-corpse/package.json`;
await raw(import.meta.path);
for (const [path, digest] of Object.entries(inputs))
  if (hash(await Bun.file(path).bytes()) !== digest)
    throw Error(`Corpse input changed: ${path}`);
await Bun.write(out, bytes);
const report = {
  schema: 1,
  kind: "selected-corpse-scene-rebinding",
  inputs,
  packageSha256: hash(bytes),
  fixedReferenceSha256: CORPSE_POLICY_SHA,
  worldCatalogSha256: hash(worldBytes),
  onlySceneParentChanged: true,
  assets: Object.keys(metadata.assets).length,
  scope: {
    originalNativeProofRetained: true,
    newNativeAlgorithmApproved: false,
    nativeClockRecovered: false,
    browserObserved: false,
  },
};
await Bun.write(
  `${cache}/research/selected-corpse-rebinding.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    out,
    sha256: report.packageSha256,
    assets: report.assets,
    onlySceneParentChanged: true,
  }),
);
