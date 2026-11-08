// Static exact-build map effect dependencies. No replay or runtime is executed.
import { readdir, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  installation = resolve(process.argv[3] ?? "C:/Riot Games/League of Legends"),
  tools = import.meta.dir,
  work = `${cache}/research/map-effect-assets`,
  output = `${cache}/public/latest-map-effect-assets`,
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  inputs = {},
  raw = async (path) => {
    const bytes = await Bun.file(path).bytes();
    inputs[resolve(path)] = sha(bytes);
    return bytes;
  },
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  inputPath = `${cache}/public/latest-map-effect-inputs/package.json`,
  map = await read(inputPath),
  definitions = await read(
    `${cache}/public/latest-map-effect-inputs/${map.definitions.file}`,
  ),
  nativePath = `${cache}/research/map-native-textures.json`,
  native = await read(nativePath),
  systemsPath = `${cache}/public/latest-map-vfx-systems/package.json`,
  systems = await read(systemsPath),
  scenePath = `${cache}/public/latest-scene/manifest.json`,
  scene = await read(scenePath),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  exe = await raw(`${installation}/Game/League of Legends.exe`),
  exporter = `${cache}/exporter-build/bin/Debug/net10.0/Exporter.dll`,
  exporterSha256 = sha(await raw(exporter));
if (
  map.kind !== "installed-map-effect-inputs" ||
  map.build !== "16.21.829.8620" ||
  map.protocol !== "20e09df23c66b85e" ||
  map.mapId !== 12 ||
  scene.build !== map.build ||
  scene.protocol !== map.protocol ||
  systems.build !== map.build ||
  systems.protocol !== map.protocol ||
  map.decoderImageSha256 !== profile.decoderImageSha256 ||
  sha(exe) !==
    "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a" ||
  inputs[
    resolve(`${cache}/public/latest-map-effect-inputs/${map.definitions.file}`)
  ] !== map.definitions.sha256 ||
  systems.mapInputsSha256 !== inputs[resolve(inputPath)] ||
  native.mapSystemsSha256 !== inputs[resolve(systemsPath)] ||
  native.kind !== "native-map-texture-dependency-inventory" ||
  native.counts.roots !== Object.keys(systems.systems).length ||
  !native.scope.constructorDefaultsIncluded ||
  !native.scope.staticInspectionOnly ||
  exporterSha256 !== scene.toolchain.exporterSha256
)
  throw Error("Exact-build map/native texture/exporter inputs differ");
for (const [path, digest] of Object.entries(native.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error(`Native texture input changed: ${path}`);
for (const [name, digest] of Object.entries(native.sources))
  if (sha(await raw(`${tools}/${name}`)) !== digest)
    throw Error(`Native texture producer changed: ${name}`);
for (const [name, digest] of Object.entries(systems.compilerSources))
  if (sha(await raw(`${tools}/${name}`)) !== digest)
    throw Error(`Native map compiler changed: ${name}`);
for (const name of ["Program.cs", "Exporter.csproj"])
  if (
    sha(await raw(`${tools}/exporter/${name}`)) !==
    sha(await raw(`${cache}/exporter-build/${name}`))
  )
    throw Error(`Exporter source changed: ${name}`);
const sources = {};
for (const path of [import.meta.path, `${tools}/wad.mjs`])
  sources[path.slice(tools.length + 1)] = sha(await raw(path));
for (const dir of [
  work,
  `${output}/raw`,
  `${output}/textures`,
  `${output}/meshes`,
])
  await mkdir(dir, { recursive: true });
const { decompress } = await import(
    pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
  ),
  archiveRoot = "DATA/FINAL/Champions",
  // Global and map files may borrow champion resources. Include every installed
  // champion archive, but no unrelated game-mode archive with override semantics.
  archiveNames = [
    "DATA/FINAL/Global.wad.client",
    "DATA/FINAL/DATA.wad.client",
    "DATA/FINAL/Maps/Shipping/Common.wad.client",
    "DATA/FINAL/Maps/Shipping/Map12.wad.client",
    ...(await readdir(`${installation}/Game/${archiveRoot}`))
      .filter((n) => n.endsWith(".wad.client"))
      .sort()
      .map((n) => `${archiveRoot}/${n}`),
  ],
  archives = [];
for (const name of archiveNames)
  archives.push({
    name,
    read: await openLocalWad(installation, name, decompress),
  });
function normalize(path) {
  if (
    typeof path !== "string" ||
    !path.length ||
    path.startsWith("/") ||
    path.includes(":") ||
    path.split(/[\\/]/).some((p) => p === "." || p === ".." || p === "")
  )
    throw Error(`Invalid map asset path: ${path}`);
  return path.replaceAll("\\", "/").toLowerCase();
}
const dependencies = new Map(),
  effects = {},
  textureJobs = {},
  meshJobs = [],
  assets = {},
  converted = new Map();
function add(path, effectId, property, source) {
  path = normalize(path);
  let record = dependencies.get(path);
  if (!record) dependencies.set(path, (record = { path, uses: [] }));
  record.uses.push({ effectId, property, source });
  effects[effectId] ??= { dependencies: [] };
  if (!effects[effectId].dependencies.includes(path))
    effects[effectId].dependencies.push(path);
}
function walk(value, effectId, property = "") {
  if (Array.isArray(value))
    return value.forEach((v, i) => walk(v, effectId, `${property}[${i}]`));
  if (value && typeof value === "object") {
    for (const [name, child] of Object.entries(value))
      if (
        ![
          "__type",
          "objectPath",
          "particleName",
          "particlePath",
          "emitterName",
        ].includes(name)
      )
        walk(child, effectId, `${property}.${name}`);
    return;
  }
  if (
    typeof value === "string" &&
    /^(assets|data)[\\/].+\.[a-z0-9_]+$/i.test(value)
  )
    add(value, effectId, property, "complete-serialized-root");
}
for (const [id, definition] of Object.entries(definitions)) {
  const effectId = `map/12/${id}`;
  effects[effectId] = {
    dependencies: [],
    nativeGraphPrepared: !!systems.systems[effectId],
    typedNativeTexturesInspected: !!native.effects[effectId],
  };
  walk(definition, effectId);
}
for (const [effectId, records] of Object.entries(native.effects)) {
  if (!effects[effectId])
    throw Error("Native texture inventory has an undeclared map root");
  for (const record of records)
    add(
      record.path,
      effectId,
      record.fields,
      "typed-native-string-including-defaults",
    );
}
console.log(
  JSON.stringify({
    archives: archives.length,
    roots: Object.keys(effects).length,
    dependencies: dependencies.size,
  }),
);
for (const [index, dependency] of [...dependencies.values()]
  .sort((a, b) => a.path.localeCompare(b.path))
  .entries()) {
  const { path, uses } = dependency,
    matches = archives.filter((a) => a.read.has(path));
  if (!matches.length) {
    assets[path] = {
      status: "unprepared",
      reason: "asset-absent-from-declared-installed-archives",
      uses,
    };
    continue;
  }
  const bytes = await Promise.all(matches.map((a) => a.read(path))),
    digest = sha(bytes[0]);
  if (bytes.some((b) => sha(b) !== digest))
    throw Error(`Conflicting installed map asset definitions: ${path}`);
  const extension = extname(path).slice(1),
    rawFile = `raw/${digest}.${extension}`;
  await Bun.write(`${output}/${rawFile}`, bytes[0]);
  const asset = {
    kind: extension,
    status: "raw-source-only",
    sourceSha256: digest,
    rawFile,
    rawBytes: bytes[0].length,
    archives: matches.map((a) => a.name),
    uses,
  };
  assets[path] = asset;
  if (["tex", "dds", "scb", "sco"].includes(extension)) {
    const key = sha(`${digest}|${exporterSha256}|${extension}`),
      existing = converted.get(key);
    const file = ["tex", "dds"].includes(extension)
      ? `textures/${key}.png`
      : `meshes/${key}.json`;
    Object.assign(asset, {
      file,
      kind: ["tex", "dds"].includes(extension) ? "texture" : "static-mesh",
      status: "conversion-pending",
      conversionKey: key,
    });
    if (!existing) {
      converted.set(key, asset);
      if (asset.kind === "texture")
        textureJobs[`${output}/${rawFile}`] = `${output}/${file}`;
      else meshJobs.push({ source: `${output}/${rawFile}`, file });
    }
  } else
    asset.reason = "native-format-retained; runtime-and-renderer-not-prepared";
  if (index % 250 === 0)
    console.log(
      JSON.stringify({ assetsInspected: index + 1, total: dependencies.size }),
    );
}
async function command(args) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" }),
    [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
  if (code) throw Error(`Map asset conversion failed: ${stdout}\n${stderr}`);
  if (stdout.trim()) console.log(stdout.trim());
}
const dotnet = "C:/Program Files/dotnet/dotnet.exe";
await Bun.write(`${work}/texture-jobs.json`, JSON.stringify(textureJobs));
if (Object.keys(textureJobs).length)
  await command([dotnet, exporter, "textures", `${work}/texture-jobs.json`]);
let meshIndex = 0;
for (const job of meshJobs) {
  await command([
    dotnet,
    exporter,
    "effect-mesh",
    job.source,
    `${output}/${job.file}`,
  ]);
  if (++meshIndex % 100 === 0)
    console.log(
      JSON.stringify({ meshesConverted: meshIndex, total: meshJobs.length }),
    );
}
for (const asset of Object.values(assets)) {
  if (!asset.file) continue;
  const bytes = await Bun.file(`${output}/${asset.file}`).bytes();
  Object.assign(asset, {
    sha256: sha(bytes),
    bytes: bytes.length,
    status: "prepared",
  });
  if (asset.kind === "texture") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0) !== 0x89504e47 || view.getUint32(12) !== 0x49484452)
      throw Error("Map texture conversion did not produce PNG");
    Object.assign(asset, {
      width: view.getUint32(16),
      height: view.getUint32(20),
      scope: "mip0-first-face preview; original texture retained",
    });
  } else {
    const mesh = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !mesh.positions?.length ||
      mesh.positions.length % 9 ||
      mesh.uv?.length * 3 !== mesh.positions.length * 2 ||
      ![...mesh.positions, ...mesh.uv].every(Number.isFinite)
    )
      throw Error("Converted map VFX mesh geometry is invalid");
    asset.triangles = mesh.positions.length / 9;
  }
}
const counts = {
  roots: Object.keys(effects).length,
  assetPaths: dependencies.size,
  preparedTextures: 0,
  preparedStaticMeshes: 0,
  rawOnly: 0,
  missing: 0,
  rawBytes: 0,
  convertedBytes: 0,
  uniqueConvertedTextures: Object.keys(textureJobs).length,
  uniqueConvertedMeshes: meshJobs.length,
};
for (const asset of Object.values(assets)) {
  if (asset.status === "prepared") {
    counts[
      asset.kind === "texture" ? "preparedTextures" : "preparedStaticMeshes"
    ]++;
    counts.convertedBytes += asset.bytes;
  } else if (asset.status === "raw-source-only") counts.rawOnly++;
  else if (asset.status === "unprepared") counts.missing++;
  else throw Error("Unfinished map dependency conversion");
  counts.rawBytes += asset.rawBytes ?? 0;
}
// A package is published only after every attempted conversion has succeeded.
const result = {
  schema: 1,
  kind: "prepared-map-effect-assets",
  build: map.build,
  protocol: map.protocol,
  mapId: 12,
  mapInputsSha256: inputs[resolve(inputPath)],
  mapSystemsSha256: inputs[resolve(systemsPath)],
  nativeTextureInventorySha256: inputs[resolve(nativePath)],
  decoderImageSha256: map.decoderImageSha256,
  exporterSha256,
  sources,
  inputs,
  archives: archiveNames,
  effects,
  assets,
  counts,
  scope: {
    staticBuildDataOnly: true,
    completeSerializedRootPaths: true,
    constructorDefaultTexturesIncluded: true,
    allDeclaredPathsAttempted: true,
    textureMip0PreviewOnly: true,
    originalRawAssetsRetained: true,
    transitiveMaterialAndShaderClosureResolved: false,
    skinnedMeshesAndAnimationsConverted: false,
    runtimeResourceAcquisitionExecuted: false,
    runtimeFactoryExecuted: false,
    replayEventsConnected: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
const bytes = JSON.stringify(result);
await Bun.write(`${output}/package.json`, bytes);
await Bun.write(
  `${work}/preparation.json`,
  JSON.stringify(
    {
      packageSha256: sha(bytes),
      counts,
      missing: Object.entries(assets)
        .filter(([, a]) => a.status === "unprepared")
        .map(([path, a]) => ({ path, reason: a.reason })),
      scope: result.scope,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ packageSha256: sha(bytes), counts }));
