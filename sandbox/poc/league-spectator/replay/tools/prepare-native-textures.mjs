// Supplement explicit BIN dependencies with typed native constructor defaults.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { openLocalWad } from "./wad.mjs";
const [installationArg, cacheArg] = process.argv.slice(2);
if (!installationArg || !cacheArg || process.argv.length !== 4)
  throw Error("Usage: prepare-native-textures.mjs <installation> <cache>");
const installation = resolve(installationArg),
  cache = resolve(cacheArg),
  assets = `${cache}/public`,
  out = `${assets}/latest-native-textures`,
  work = `${cache}/research/native-textures`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  inventory = await read(`${cache}/research/native-texture-dependencies.json`),
  effects = await read(`${assets}/latest-effects/manifest.json`),
  scene = await read(`${assets}/latest-scene/manifest.json`),
  exporter = `${cache}/exporter-build/bin/Debug/net10.0/Exporter.dll`;
if (
  inventory.build !== "16.21.829.8620" ||
  inventory.protocol !== "20e09df23c66b85e" ||
  inventory.counts.roots !== 876 ||
  !inventory.scope.constructorDefaultsIncluded ||
  effects.build !== inventory.build ||
  scene.build !== inventory.build ||
  sha(await raw(`${installation}/Game/League of Legends.exe`)) !==
    "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a" ||
  sha(await raw(exporter)) !== scene.toolchain.exporterSha256
)
  throw Error("Native texture build/exporter mismatch");
for (const [name, h] of Object.entries(inventory.sources))
  if (sha(await raw(resolve(import.meta.dir, name))) !== h)
    throw Error(`Native texture discovery source changed: ${name}`);
for (const [path, h] of Object.entries(inventory.inputs))
  if (sha(await raw(path)) !== h)
    throw Error(`Native texture discovery input changed: ${path}`);
for (const name of ["Program.cs", "Exporter.csproj"])
  if (
    sha(await raw(resolve(import.meta.dir, "exporter", name))) !==
    sha(await raw(`${cache}/exporter-build/${name}`))
  )
    throw Error("Native texture exporter source changed");
await mkdir(`${out}/raw`, { recursive: true });
await mkdir(`${out}/textures`, { recursive: true });
await mkdir(work, { recursive: true });
const { decompress } = await import(
    pathToFileURL(`${assets}/vendor/fzstd.mjs`).href
  ),
  readers = [];
for (const archive of [
  "DATA/FINAL/Global.wad.client",
  "DATA/FINAL/DATA.wad.client",
  "DATA/FINAL/Maps/Shipping/Map12.wad.client",
])
  readers.push({
    archive,
    read: await openLocalWad(installation, archive, decompress),
  });
const textures = {},
  jobs = {};
for (const [path, discovery] of Object.entries(inventory.paths)) {
  if (discovery.preparedInEffectsManifest) continue;
  if (
    !/^(assets|data)\/[a-z0-9_./-]+\.(tex|dds)$/.test(path) ||
    path.includes("..")
  )
    throw Error("Invalid native texture dependency path");
  const matches = readers.filter((r) => r.read.has(path));
  if (!matches.length)
    throw Error(`Native texture absent from exact-build archives: ${path}`);
  const bytes = await Promise.all(matches.map((r) => r.read(path))),
    sourceSha256 = sha(bytes[0]);
  if (bytes.some((b) => sha(b) !== sourceSha256))
    throw Error(`Conflicting native texture bytes: ${path}`);
  const rawFile = `raw/${sourceSha256}.${path.split(".").at(-1)}`,
    file = `textures/${sourceSha256}.png`;
  await Bun.write(`${out}/${rawFile}`, bytes[0]);
  jobs[`${out}/${rawFile}`] = `${out}/${file}`;
  textures[path] = {
    kind: "texture",
    status: "prepared",
    path,
    file,
    rawFile,
    sourceSha256,
    archives: matches.map((r) => r.archive),
    constructorDefaultDependency: true,
  };
}
await Bun.write(`${work}/jobs.json`, JSON.stringify(jobs, null, 2));
if (Object.keys(jobs).length) {
  const child = Bun.spawn(
      [
        "C:/Program Files/dotnet/dotnet.exe",
        exporter,
        "textures",
        `${work}/jobs.json`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    ),
    [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
  if (code) throw Error(`Native texture export failed: ${stdout}\n${stderr}`);
}
for (const asset of Object.values(textures)) {
  const b = await raw(`${out}/${asset.file}`),
    v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint32(0) !== 0x89504e47 || v.getUint32(12) !== 0x49484452)
    throw Error("Native texture PNG is invalid");
  Object.assign(asset, {
    sha256: sha(b),
    bytes: b.length,
    width: v.getUint32(16),
    height: v.getUint32(20),
  });
}
await raw(resolve(import.meta.path));
await raw(resolve(import.meta.dir, "wad.mjs"));
const result = {
  schema: 1,
  kind: "prepared-native-constructor-textures",
  build: inventory.build,
  protocol: inventory.protocol,
  inputs,
  assets: textures,
  counts: {
    nativePaths: inventory.counts.uniqueTextures,
    supplementalTextures: Object.keys(textures).length,
  },
  scope: {
    constructorDefaultsIncluded: true,
    originalSourceRetained: true,
    decodedBaseLevelOnly: true,
    fullMipChainsPrepared: false,
    nativeFactoryExecuted: false,
    browserRun: false,
    referenceCompared: false,
  },
};
const encoded = JSON.stringify(result, null, 2);
await Bun.write(`${out}/package.json`, encoded);
console.log(
  JSON.stringify({
    sha256: sha(encoded),
    counts: result.counts,
    assets: textures,
  }),
);
