// Static installed skin/mesh inputs only; never accepted replay resource state.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [cacheArg, installArg, champion, skinArg] = process.argv.slice(2);
const cache = resolve(cacheArg),
  installation = resolve(installArg);
const skin = Number(skinArg),
  root = resolve(import.meta.dir, "..");
if (
  !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(champion ?? "") ||
  !Number.isInteger(skin) ||
  skin < 0 ||
  skin > 1000
)
  throw Error("Explicit static character/skin identity required");
const inputs = {};
async function raw(path) {
  path = resolve(path);
  const data = await Bun.file(path).bytes();
  inputs[path] = await sha256(data);
  return data;
}
const profile = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/public/decoder-16.21-macos/profile.json`),
  ),
);
if (
  profile.clientVersion !== "16.21.829.8620" ||
  profile.protocolDigest !== "20e09df23c66b85e" ||
  (await sha256(await raw(`${installation}/Game/League of Legends.exe`))) !==
    profile.windowsClientSha256
)
  throw Error("Exact installed static asset build required");
for (const file of [
  import.meta.path,
  `${root}/structural-comparison.mjs`,
  `${root}/tools/wad.mjs`,
  `${root}/tools/parse-latest-assets.py`,
  `${cache}/public/vendor/fzstd.mjs`,
])
  await raw(file);
const { decompress } = await import(
  pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
);
const archive = `DATA/FINAL/Champions/${champion}.wad.client`;
await raw(`${installation}/Game/${archive}`);
const get = await openLocalWad(installation, archive, decompress);
const work = `${cache}/research/recorded-hero-skn-${champion.toLowerCase()}-${skin}`;
const asset = `data/characters/${champion.toLowerCase()}/skins/skin${skin}.bin`;
const bytes = await get(asset),
  source = `${work}/skin.bin`,
  output = `${work}/skin.json`;
await Bun.write(source, bytes);
await raw(source);
await Bun.write(
  `${work}/jobs.json`,
  JSON.stringify({
    schema: 1,
    build: profile.clientVersion,
    jobs: [{ path: asset, source, output, sha256: await sha256(bytes) }],
  }),
);
const child = Bun.spawn(
  [
    `${cache}/research/venv/Scripts/python.exe`,
    `${root}/tools/parse-latest-assets.py`,
    `${work}/jobs.json`,
    `${cache}/vfx`,
    `${work}/parsed.json`,
  ],
  { stdout: "pipe", stderr: "pipe" },
);
const [stdout, stderr, code] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
if (code) throw Error(`Pinned static BIN parser failed: ${stdout}\n${stderr}`);
for (const path of ["jobs.json", "parsed.json", "skin.json"])
  await raw(`${work}/${path}`);
for (const name of ["binfields", "bintypes"])
  await raw(`${cache}/vfx/hashes.${name}.txt`);
const parsed = JSON.parse(new TextDecoder().decode(await raw(output)));
const skins = Object.values(parsed).filter(
  (row) => row?.__type === "SkinCharacterDataProperties",
);
if (skins.length !== 1 || skins[0].championSkinId % 1000 !== skin)
  throw Error("One exact installed skin definition required");
const meshPath = skins[0].skinMeshProperties?.simpleSkin;
if (
  typeof meshPath !== "string" ||
  !/^assets\/[a-z0-9_./-]+\.skn$/i.test(meshPath) ||
  meshPath.includes("..")
)
  throw Error("Explicit authored SKN asset path required");
const mesh = await get(meshPath),
  meshFile = `${work}/model.skn`;
await Bun.write(meshFile, mesh);
await raw(meshFile);
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Static input changed: ${path}`);
const manifest = {
  schema: 1,
  kind: "installed-static-skin-vertex-input",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  decoderImageSha256: profile.decoderImageSha256,
  windowsClientSha256: profile.windowsClientSha256,
  installation,
  champion,
  skin,
  archive,
  skinAsset: asset,
  skinAssetSha256: await sha256(bytes),
  meshPath,
  rawFile: resolve(meshFile),
  sourceSha256: await sha256(mesh),
  inputs,
  scope: {
    installedStaticAssetOnly: true,
    acceptedReplayAppearance: false,
    resourceSelectionRecovered: false,
  },
};
await Bun.write(`${work}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({
    manifest: `${work}/manifest.json`,
    meshPath,
    bytes: mesh.length,
    fingerprints: Object.keys(inputs).length,
  }),
);
