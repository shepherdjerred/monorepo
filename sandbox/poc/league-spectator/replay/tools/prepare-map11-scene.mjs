// Exact archived-build static preparation. Never reads or decodes a match.
// The result is partial geometry evidence, not an admitted Map11 spectator.
import { mkdir } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { openWad } from "./wad.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { createMapSceneOutput } from "./map-scene-output.mjs";
import {
  MAP11_RESEARCH_BUILD,
  MAP11_RELEASE_URL,
  MAP11_RELEASE_SHA256,
  readMapHeightGrid,
  normalizeMapBin,
} from "./map-scene-assets.mjs";

const [
  parserCheckoutArg,
  sourceCacheArg,
  outputCacheArg,
  variant,
  dotnet = "dotnet",
] = process.argv.slice(2);
if (
  !parserCheckoutArg ||
  !sourceCacheArg ||
  !outputCacheArg ||
  !variant ||
  !/^[a-z0-9_]+$/.test(variant) ||
  process.argv.length > 7
)
  throw Error(
    "Usage: bun prepare-map11-scene.mjs <lol-exe-downloader-checkout> <approved-source-cache> <output-cache> <explicit-geometry-variant> [dotnet]",
  );
const parserCheckout = resolve(parserCheckoutArg);
const { sourceCache, cache, out, work } = await createMapSceneOutput(
  sourceCacheArg,
  outputCacheArg,
);
const hash = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const releaseBytes = new Uint8Array(
  await Bun.file(`${cache}/release.manifest`).arrayBuffer(),
);
if (hash(releaseBytes) !== MAP11_RELEASE_SHA256)
  throw Error(
    "Archived 16.21 release manifest differs from its pinned identity",
  );
const parserFile = `${parserCheckout}/src/rman.js`;
const { parseRman } = await import(pathToFileURL(parserFile).href);
const wadName = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
const release = parseRman(releaseBytes, { targetFile: wadName });
if (release.manifestId !== "B499FB04B1158CF6")
  throw Error("Archived release identity mismatch");
release.sourceSha256 = MAP11_RELEASE_SHA256;
const wadFile = release.files.find(
  (file) => file.name.toLowerCase() === wadName.toLowerCase(),
);
if (!wadFile) throw Error("Exact archived release has no Map11 WAD");
const get = await openWad(release, wadName, cache, (bytes) =>
  Bun.zstdDecompressSync(bytes),
);
const exporter = `${sourceCache}/exporter-build/bin/Debug/net10.0/Exporter.dll`;
const approvedScene = await Bun.file(
  `${sourceCache}/public/latest-scene/manifest.json`,
).json();
const exporterSha256 = hash(await Bun.file(exporter).arrayBuffer());
if (
  approvedScene.build !== MAP11_RESEARCH_BUILD ||
  approvedScene.toolchain.exporterSha256 !== exporterSha256 ||
  approvedScene.toolchain.leagueToolkitRevision !==
    "76bf57bf4fd195343dec610bf0f912a06b910914"
)
  throw Error("Original exporter/toolkit receipt is missing or changed");
const provenance = [];
function referenceKey(reference) {
  if (typeof reference === "string" && reference.length)
    return reference.toLowerCase();
  if (
    reference?.kind === "wad-path-hash" &&
    typeof reference.value === "string" &&
    /^\d+$/.test(reference.value)
  )
    return `wad-hash:${reference.value}`;
  throw Error("An original WAD path or typed path-hash reference is required");
}
async function source(reference) {
  referenceKey(reference);
  const bytes =
    typeof reference === "string"
      ? await get(reference.toLowerCase())
      : await get.byHash(BigInt(reference.value));
  provenance.push({ reference, bytes: bytes.length, sha256: hash(bytes) });
  return bytes;
}
async function write(relative, bytes) {
  const path = resolve(out, relative);
  if (!path.startsWith(resolve(out) + sep))
    throw Error("Prepared asset escaped output root");
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, bytes);
}
async function command(args, program = exporter) {
  const child = Bun.spawn([dotnet, program, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw Error(`Exact map exporter failed: ${stdout}\n${stderr}`);
  console.log(stdout.trim());
}
const mapPath = `data/maps/mapgeometry/map11/${variant}`;
const materialPath = `${mapPath}.materials.bin`;
const materialBytes = await source(materialPath);
await write("materials.bin", materialBytes);
const geometryPath = `${mapPath}.mapgeo`,
  geometryBytes = await source(geometryPath);
await Bun.write(`${work}/map.mapgeo`, geometryBytes);
await command(["map", `${work}/map.mapgeo`, `${out}/map`]);
const description = await Bun.file(`${out}/map/map.json`).json();
const materialNames = new Set(
  description.meshes.flatMap((mesh) =>
    mesh.submeshes.map((submesh) => submesh.material),
  ),
);
const typedMaterials = readExactMapBin(materialBytes);
await write("materials-typed.json", JSON.stringify(typedMaterials));
if (typedMaterials.sourceSha256 !== hash(materialBytes))
  throw Error(
    "Typed material reader did not consume the archived original bytes",
  );
const materials = normalizeMapBin(typedMaterials, materialNames);
await write("materials.json", JSON.stringify(materials));
const containers = Object.entries(materials).filter(([_key, value]) =>
  value.components?.some((component) => component.__type === "MapNavGrid"),
);
if (containers.length !== 1)
  throw Error("Unique authored Map11 navigation container required");
const [containerName, container] = containers[0];
const navigation = container.components.filter(
  (component) => component.__type === "MapNavGrid",
);
if (navigation.length !== 1 || typeof navigation[0].NavGridPath !== "string")
  throw Error("Unique original Map11 navigation path required");
const navPath = navigation[0].NavGridPath;
const navBytes = await source(navPath);
const grid = readMapHeightGrid(navBytes);
await write("heights.bin", grid.heights);
await Bun.write(`${work}/map.navgrid`, navBytes);
const bindings = {},
  unsupported = {},
  jobs = {};
for (const name of new Set(
  description.meshes.flatMap((mesh) =>
    mesh.submeshes.map((submesh) => submesh.material),
  ),
)) {
  const material = materials[name];
  if (!material) throw Error(`Missing archived map material ${name}`);
  const samplers = (material.samplerValues ?? []).filter((sampler) =>
    /^Diffuse_?Texture$/i.test(sampler.TextureName),
  );
  const shader = material.techniques?.[0]?.passes?.[0]?.shader;
  if (samplers.length !== 1) {
    unsupported[name] = {
      reason:
        "No unique diffuse sampler; original material shader is not implemented",
      shader,
    };
    continue;
  }
  const path = samplers[0].texturePath;
  const key = hash(referenceKey(path)),
    raw = `${work}/${key}.texture`,
    texture = `textures/${key}.png`;
  if (!Object.hasOwn(jobs, raw)) {
    await Bun.write(raw, await source(path));
    await mkdir(`${out}/textures`, { recursive: true });
    jobs[raw] = `${out}/${texture}`;
  }
  bindings[name] = {
    texture: `../${texture}`,
    shader,
    alphaTest:
      material.paramValues?.find(
        (parameter) => parameter.name === "AlphaTestValue",
      )?.value?.[0] ?? 0,
    approximation:
      "Original diffuse texture only; native world shader and compositing are not implemented",
  };
}
await write(
  "map/bindings.json",
  JSON.stringify({ bindings, unsupported }, null, 2),
);
await write(
  "world-catalog-source.json",
  JSON.stringify({ containerName, container }, null, 2),
);
await Bun.write(`${work}/texture-jobs.json`, JSON.stringify(jobs));
if (Object.keys(jobs).length)
  await command(["textures", `${work}/texture-jobs.json`]);
const files = [];
for (const path of new Bun.Glob("**/*").scanSync({
  cwd: out,
  onlyFiles: true,
})) {
  if (path === "manifest.json") continue;
  const bytes = new Uint8Array(await Bun.file(`${out}/${path}`).arrayBuffer());
  files.push({
    path: path.replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: hash(bytes),
  });
}
const manifest = {
  schema: 1,
  build: MAP11_RESEARCH_BUILD,
  protocol: "20e09df23c66b85e",
  scope: "partial-static-map-geometry-only",
  spectatorAdmission: false,
  release: {
    url: MAP11_RELEASE_URL,
    sha256: MAP11_RELEASE_SHA256,
    mapWad: wadName,
    mapWadBytes: wadFile.size,
    chunkReceipts: get.rmanReceipts(),
  },
  toolchain: {
    exporterSha256,
    binDecoderSourceSha256: hash(
      await Bun.file(
        new URL("./exact-map-bin.mjs", import.meta.url),
      ).arrayBuffer(),
    ),
    mapSceneAssetsSourceSha256: hash(
      await Bun.file(
        new URL("./map-scene-assets.mjs", import.meta.url),
      ).arrayBuffer(),
    ),
    wadReaderSha256: hash(
      await Bun.file(new URL("./wad.mjs", import.meta.url)).arrayBuffer(),
    ),
    rmanChunkReaderSha256: hash(
      await Bun.file(
        new URL("./rman-chunks.mjs", import.meta.url),
      ).arrayBuffer(),
    ),
    outputPolicySha256: hash(
      await Bun.file(
        new URL("./map-scene-output.mjs", import.meta.url),
      ).arrayBuffer(),
    ),
    leagueToolkitRevision: approvedScene.toolchain.leagueToolkitRevision,
    rmanParserSha256: hash(await Bun.file(parserFile).arrayBuffer()),
    preparerSha256: hash(
      await Bun.file(fileURLToPath(import.meta.url)).arrayBuffer(),
    ),
  },
  map: {
    id: 11,
    variant,
    selection:
      "Explicit static geometry selection; recorded variant and native visibility remain unverified",
    containerName,
    geometryPath,
    navPath,
    min: grid.min,
    max: grid.max,
    movementOrigin: grid.movementOrigin,
    heightGrid: {
      x: grid.x,
      z: grid.z,
      step: grid.step,
      sourceSha256: hash(navBytes),
    },
    bindings: "map/bindings.json",
  },
  summary: {
    sourceMeshes: description.sourceMeshCount,
    exportedMeshes: description.meshes.length,
    baseVisibilityMask: 1,
    diffuseMaterials: Object.keys(bindings).length,
    unsupportedMaterials: Object.keys(unsupported).length,
    textures: Object.keys(jobs).length,
  },
  provenance,
  files: files.sort((left, right) => left.path.localeCompare(right.path)),
  omissions: [
    "No Map11 world/entity registration or lifecycle admission",
    "No champions, skins, jungle, objectives, structures, summons or combat presentation",
    "Only the exporter's base visibility bit-1 mesh subset; no native dynamic map visibility",
    "Diffuse material approximation only; native shaders, lighting, shadows, water and compositing remain open",
    "No assertion that this explicit geometry variant matches either recorded replay",
  ],
};
await write("manifest.json", JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({
    output: out,
    ...manifest.summary,
    spectatorAdmission: false,
  }),
);
