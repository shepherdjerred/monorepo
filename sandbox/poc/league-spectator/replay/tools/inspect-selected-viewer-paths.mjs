// Inventory audit of ordinary viewer-owned get paths, separate from fixed
// hash-approved provider fetches. This does not execute a browser.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-selected-viewer-paths.mjs <cache>");
const cache = resolve(cacheArg),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes();
  inputs[path] = await sha256(b);
  return b;
}
const parse = (b) => JSON.parse(new TextDecoder().decode(b)),
  read = (p) => raw(`${cache}/public/${p}`);
await raw(import.meta.path);
const viewer = await raw(resolve(import.meta.dir, "../latest-viewer.mjs")),
  bootstrap = parse(await read("latest-static-catalog/bootstrap.json")),
  catalogBytes = await read(bootstrap.catalog.path),
  profileBytes = await read(bootstrap.profile.path);
if (
  (await sha256(catalogBytes)) !== bootstrap.catalog.sha256 ||
  (await sha256(profileBytes)) !== bootstrap.profile.sha256
)
  throw Error("Published static bootstrap parents differ");
const catalog = parse(catalogBytes),
  needed = new Map();
function add(path, kind, expected = null) {
  const ref = catalog.files[path];
  if (!ref) throw Error("Mandatory owned viewer get outside catalog: " + path);
  if (expected && ref.sha256 !== expected)
    throw Error("Mandatory viewer path parent digest differs: " + path);
  const prior = needed.get(path);
  if (prior) prior.kinds.add(kind);
  else needed.set(path, { kinds: new Set([kind]), ...ref });
}
for (const path of [
  "latest-scene/manifest.json",
  "latest-scene/map/map.json",
  "latest-scene/map/map.bin",
  "latest-scene/map/bindings.json",
  "latest-scene/heights.bin",
  "decoder-16.21-macos/missile-motion.json",
  "decoder-16.21-macos/missile-controllers.json",
  "decoder-16.21-macos/missile-actors.json",
  "decoder-16.21-macos/vfx-values.json",
  "decoder-16.21-macos/animation-clock.json",
  "latest-effects/manifest.json",
  "latest-animation-poses/manifest.json",
  "latest-submesh-visibility/package.json",
  "latest-corpse/package.json",
  "latest-effect-contexts/package.json",
  "latest-effect-resolvers/package.json",
  "latest-builtin-resource-contexts/package.json",
  "latest-items/package.json",
])
  add(path, "owned-get-literal");
const scene = parse(await read("latest-scene/manifest.json"));
add(`latest-scene/${scene.world}`, "owned-get-world");
const world = parse(await read(`latest-scene/${scene.world}`));
for (const asset of Object.values(scene.champions))
  for (const key of [
    "model",
    "animationGraph",
    "animationCatalog",
    "spellCatalog",
  ])
    add(`latest-scene/${asset[key]}`, "owned-get-actor");
for (const asset of Object.values(world.assets)) {
  add(`latest-scene/${asset.model}`, "building-or-animated-model");
  // loadWorldObjects uses GLTFLoader directly for static buildings. Only
  // bindLatestMinions' animated assets enter loadAnimatedActor/owned get.
  const fields = ["animationGraph", "animationCatalog", "spellCatalog"];
  if (fields.some((key) => Object.hasOwn(asset, key))) {
    if (!fields.every((key) => typeof asset[key] === "string"))
      throw Error("Incomplete animated world asset contract");
    for (const key of fields)
      add(`latest-scene/${asset[key]}`, "owned-get-animated-world");
  }
}
const poses = parse(await read("latest-animation-poses/manifest.json"));
let clips = 0;
for (const graph of Object.values(poses.graphs))
  for (const clip of Object.values(graph.catalog.clips)) {
    add(
      `latest-animation-poses/${graph.directory}/${clip.file}`,
      "owned-get-clip",
      clip.sha256,
    );
    clips++;
  }
const items = parse(await read("latest-items/package.json"));
for (const item of Object.values(items.items))
  add(`latest-items/${item.icon}`, "owned-get-item", item.iconSha256);
const closure = parse(await read("latest-selected-materials/files.json"));
for (const [path, ref] of Object.entries(closure.files))
  add(path, "owned-selected-registry", ref.sha256);
for (const path of Object.values(catalog.roles))
  add(path, "owned-selected-role");
// This explicit profile root is outside the catalog to avoid circular pins.
const profileRoot = {
  path: bootstrap.profile.path,
  sha256: bootstrap.profile.sha256,
  bytes: profileBytes.length,
};
for (const [path, ref] of needed) {
  const file = Bun.file(`${cache}/public/${path}`);
  if (!(await file.exists()) || file.size !== ref.bytes)
    throw Error("Mandatory viewer static file absent/wrong size: " + path);
}
const output = {
  schema: 1,
  kind: "verified-selected-viewer-owned-path-inventory",
  inputs,
  catalogSha256: bootstrap.catalog.sha256,
  viewerSha256: await sha256(viewer),
  profileRoot,
  mandatoryPaths: [...needed].map(([path, ref]) => ({
    path,
    ...ref,
    kinds: [...ref.kinds],
  })),
  counts: {
    mandatoryPaths: needed.size,
    actorAssets:
      Object.keys(scene.champions).length + Object.keys(world.assets).length,
    clips,
    items: Object.keys(items.items).length,
  },
  scope: {
    ownedGetInventoryCompleteForCurrentSource: true,
    profileExplicitSeparateBootstrapRoot: true,
    fixedHashApprovedProviderFetchesSeparate: true,
    fullGpuNavProviderNotRequiredByPartialMode:
      closure.mode === "native-quad-partial",
    browserExecuted: false,
  },
};
await Bun.write(
  `${cache}/research/selected-viewer-path-control.json`,
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output.counts));
