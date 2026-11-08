import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
const parse = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
await raw(import.meta.path);
const profileBytes = await raw(
    `${cache}/public/decoder-16.21-macos/profile.json`,
  ),
  profile = parse(profileBytes),
  sceneBytes = await raw(`${cache}/public/latest-scene/manifest.json`),
  scene = parse(sceneBytes),
  math = await raw(`${cache}/public/vendor/three.core.js`);
if (
  profile.clientVersion !== "16.21.829.8620" ||
  scene.build !== profile.clientVersion ||
  scene.protocol !== profile.protocolDigest
)
  throw Error("Exact installed viewer build required");
const models = {};
for (const asset of Object.values(scene.champions)) {
  const path = `latest-scene/${asset.model}`,
    bytes = await raw(`${cache}/public/${path}`),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length
  )
    throw Error("Prepared GLB2 actor required");
  models[path] = {
    sha256: await sha256(bytes),
    graph: asset.animationGraph,
    catalog: asset.animationCatalog,
    scale: asset.scale,
  };
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Input drift: ${path}`);
const output = resolve(cache, "public/latest-viewer-poses/package.json");
const bytes = new TextEncoder().encode(
  JSON.stringify(
    {
      schema: 1,
      kind: "pinned-static-viewer-pose-assets",
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      decoderImageSha256: profile.decoderImageSha256,
      sceneManifestSha256: await sha256(sceneBytes),
      mathSha256: await sha256(math),
      models,
      inputs,
      scope: {
        staticBuildAssetsOnly: true,
        replayEntityIds: false,
        replayEvents: false,
        nativePoseParity: false,
        engineWorldAcceptance: false,
      },
    },
    null,
    2,
  ),
);
await Bun.write(output, bytes);
console.log(
  JSON.stringify({
    output,
    sha256: await sha256(bytes),
    models: Object.keys(models).length,
    inputs: Object.keys(inputs).length,
  }),
);
