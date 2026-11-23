// Original archived world definitions, independent of any match or actor assets.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openWad } from "./wad.mjs";
import { createMapSceneOutput } from "./map-scene-output.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { MAP11_RELEASE_SHA256 } from "./map-scene-assets.mjs";

const [parserArg, approvedArg, cacheArg] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-map11-world.mjs <RMAN-parser-checkout> <approved-source-cache> <map11-cache>",
  );
const { cache, out } = await createMapSceneOutput(approvedArg, cacheArg);
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const releaseBytes = new Uint8Array(
  await Bun.file(`${cache}/release.manifest`).arrayBuffer(),
);
if (sha(releaseBytes) !== MAP11_RELEASE_SHA256)
  throw Error("Pinned Map11 release manifest required");
const parserPath = resolve(parserArg, "src/rman.js");
const { parseRman } = await import(pathToFileURL(parserPath).href);
const name = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
const release = parseRman(releaseBytes, { targetFile: name });
if (release.manifestId !== "B499FB04B1158CF6")
  throw Error("Unadmitted archived release");
release.sourceSha256 = MAP11_RELEASE_SHA256;
const get = await openWad(release, name, cache, (bytes) =>
  Bun.zstdDecompressSync(bytes),
);
const sources = [];
for (const [path, stem] of [
  ["data/maps/mapgeometry/map11/base_srx.materials.bin", "materials"],
  ["data/maps/shipping/map11/map11.bin", "map-definition"],
]) {
  const bytes = await get(path),
    typed = readExactMapBin(bytes);
  await Bun.write(`${out}/${stem}.bin`, bytes);
  await Bun.write(`${out}/${stem}-typed.json`, JSON.stringify(typed));
  sources.push({
    path,
    bytes: bytes.length,
    sha256: sha(bytes),
    objects: typed.objects.length,
    properties: typed.propertyCount,
    hash64Fields: typed.hash64Fields.length,
  });
}
const files = [];
for (const path of new Bun.Glob("**/*").scanSync({
  cwd: out,
  onlyFiles: true,
})) {
  const bytes = await Bun.file(`${out}/${path}`).arrayBuffer();
  files.push({
    path: path.replaceAll("\\", "/"),
    bytes: bytes.byteLength,
    sha256: sha(bytes),
  });
}
const toolchain = {};
for (const file of [
  "prepare-map11-world.mjs",
  "exact-map-bin.mjs",
  "map-scene-assets.mjs",
  "map-scene-output.mjs",
  "wad.mjs",
  "rman-chunks.mjs",
])
  toolchain[file] = sha(
    await Bun.file(new URL(file, import.meta.url)).arrayBuffer(),
  );
toolchain.rmanParser = sha(await Bun.file(parserPath).arrayBuffer());
await Bun.write(
  `${out}/world-source-manifest.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "archived-map11-world-source",
      build: "16.21.829.8620",
      protocol: "20e09df23c66b85e",
      releaseManifestId: release.manifestId,
      releaseManifestSha256: MAP11_RELEASE_SHA256,
      spectatorAdmission: false,
      sources,
      chunkReceipts: get.rmanReceipts(),
      toolchain,
      files,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ output: out, sources, spectatorAdmission: false }),
);
