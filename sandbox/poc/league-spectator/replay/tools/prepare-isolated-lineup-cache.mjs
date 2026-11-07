// Copy build-level prerequisites into a physically separate static preparation
// workspace. Scene/effect/pose packages must be produced for the new request.
import { resolve, relative, dirname } from "node:path";
import { readdir, lstat, mkdir } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";
const [sourceArg, semanticsArg, targetArg, resumeArg] = process.argv.slice(2);
if (resumeArg !== undefined && resumeArg !== "--resume")
  throw Error("Unknown bootstrap option");
if (!targetArg)
  throw Error(
    "Usage: bun prepare-isolated-lineup-cache.mjs <same-build-cache> <decoded-semantics.json> <new-cache>",
  );
const source = resolve(sourceArg),
  target = resolve(targetArg),
  semanticsPath = resolve(semanticsArg);
if (
  source === target ||
  relative(source, target).split(/[\\/]/)[0] !== ".." ||
  /[\\/]hs(?:[\\/]|$)/i.test(target)
)
  throw Error("A separate non-hs cache is required");
try {
  await lstat(target);
  if (resumeArg !== "--resume")
    throw Error(
      "Isolated target must not already exist; --resume is only for unfinished static bootstrap",
    );
  for (const name of ["latest-scene", "latest-effects"])
    if (await Bun.file(`${target}/public/${name}/manifest.json`).exists())
      throw Error("Cannot bootstrap over prepared scene/effect output");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const inputs = {},
  outputs = {};
let copiedBytes = 0;
async function read(path) {
  if (!(await lstat(path)).isFile())
    throw Error("Ordinary source file required: " + path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
async function write(path, bytes) {
  if (typeof bytes === "string") bytes = new TextEncoder().encode(bytes);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, bytes);
  const expected = await sha256(bytes),
    actual = await sha256(await Bun.file(path).bytes());
  if (actual !== expected) throw Error("Static snapshot readback mismatch");
  outputs[path] = expected;
  copiedBytes += bytes.byteLength ?? new TextEncoder().encode(bytes).byteLength;
}
async function copyFile(from, to) {
  await write(to, await read(from));
}
async function copyTree(from, to, include = () => true) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const a = resolve(from, entry.name),
      b = resolve(to, entry.name);
    if (entry.isSymbolicLink())
      throw Error("Static snapshot cannot follow links: " + a);
    if (!include(entry.name)) continue;
    if (entry.isDirectory()) await copyTree(a, b, include);
    else if (entry.isFile()) await copyFile(a, b);
    else throw Error("Unexpected static source type: " + a);
  }
}
await read(import.meta.path);
const semanticsBytes = await read(semanticsPath),
  semantics = JSON.parse(new TextDecoder().decode(semanticsBytes));
const profileBytes = await read(
    `${source}/public/decoder-16.21-macos/profile.json`,
  ),
  profile = JSON.parse(new TextDecoder().decode(profileBytes));
if (
  semantics.build !== "16.21.829.8620" ||
  semantics.protocol !== "20e09df23c66b85e" ||
  profile.clientVersion !== semantics.build ||
  profile.protocolDigest !== semantics.protocol ||
  semantics.decoderImageSha256 !== profile.decoderImageSha256 ||
  semantics.heroes.length !== 10
)
  throw Error("Exact same-build ten-hero decoded fixture required");
const prior = JSON.parse(
  new TextDecoder().decode(
    await read(`${source}/research/requested-latest-scene.json`),
  ),
);
const champions = semantics.heroes.map(({ champion, skinId }) => {
  if (
    typeof champion !== "string" ||
    !/^[A-Za-z0-9]+$/.test(champion) ||
    !Number.isInteger(skinId) ||
    skinId < 0
  )
    throw Error("Typed decoded champion/skin candidate required");
  return { champion, skinId };
});
if (
  new Set(champions.map(({ champion }) => champion.toLowerCase())).size !== 10
)
  throw Error("Ten distinct decoded heroes required");
await copyTree(
  `${source}/public/decoder-16.21-macos`,
  `${target}/public/decoder-16.21-macos`,
  (name) =>
    !["profile.json", "animation-rigs.json"].includes(name) &&
    !name.endsWith("-graphs"),
);
await copyTree(`${source}/public/vendor`, `${target}/public/vendor`);
// GLTFLoader's relative imports and gameplay-scene's SkeletonUtils import are
// part of the same installed Three dependency closure, outside vendor/.
await copyTree(`${source}/public/utils`, `${target}/public/utils`);
await write(`${target}/research/source-decoder-profile.json`, profileBytes);
delete profile.animationRigsSha256;
await write(
  `${target}/public/decoder-16.21-macos/profile.json`,
  JSON.stringify(profile, null, 2),
);
for (const name of ["binfields", "bintypes"])
  await copyFile(
    `${source}/vfx/hashes.${name}.txt`,
    `${target}/vfx/hashes.${name}.txt`,
  );
for (const name of await readdir(`${source}/research/latest-assets`))
  if (/^[a-f0-9]{64}\.(?:json|bin)$/.test(name))
    await copyFile(
      `${source}/research/latest-assets/${name}`,
      `${target}/research/latest-assets/${name}`,
    );
await write(`${target}/research/decoded-semantics-99.json`, semanticsBytes);
await write(
  `${target}/research/requested-latest-scene.json`,
  JSON.stringify(
    {
      build: semantics.build,
      mapId: 12,
      variant: "base",
      champions,
      omittedMapMaterials: prior.omittedMapMaterials,
    },
    null,
    2,
  ),
);
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Snapshot source changed: " + path);
const report = {
  schema: 1,
  kind: "isolated-same-build-static-preparation-bootstrap",
  source,
  target,
  inputs,
  outputs,
  replaySha256: semantics.replaySha256,
  champions,
  scope: {
    byteCopiesReadBack: true,
    mutableLinksCreated: false,
    sceneSpecificAssetsCopied: false,
    primaryProfileMutated: false,
    sceneSpecificRigHashRemoved: true,
    candidateSkinsRequireInstalledAssetValidation: true,
    mapPolicy:
      "Map12 base presentation; replay KIWI variant appearance unverified",
    runtimeCoverageEstablished: false,
  },
};
await write(
  `${target}/research/static-bootstrap.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    target,
    champions,
    copiedFiles: Object.keys(outputs).length,
    copiedBytes,
  }),
);
