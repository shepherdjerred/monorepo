// Discover and translate missing shadow stages selected by the native material corpus.
// This package supplements the existing particle package without changing its proof.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";
const [installation, cacheArg, compilerArg] = process.argv.slice(2);
if (!installation || !cacheArg || !compilerArg || process.argv.length !== 5)
  throw Error(
    "Usage: prepare-shadow-shaders.mjs <installation> <cache> <compiler workspace>",
  );
const cache = resolve(cacheArg),
  compiler = resolve(compilerArg);
const readBytes = async (path) =>
  new Uint8Array(await Bun.file(path).arrayBuffer());
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
const baseRaw = await readBytes(`${cache}/public/latest-shaders/package.json`),
  base = JSON.parse(new TextDecoder().decode(baseRaw));
const nativeRaw = await readBytes(
    `${cache}/research/vfx-materials-comparison.json`,
  ),
  native = JSON.parse(new TextDecoder().decode(nativeRaw));
const executableSha256 =
  "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a";
const sourceRaw = await readBytes(`${compiler}/sources.json`),
  sources = JSON.parse(new TextDecoder().decode(sourceRaw));
if (
  base.build !== "16.21.829.8620" ||
  native.build !== base.build ||
  native.scope.mismatchCount !== 0 ||
  native.shaderPackageSha256 !== sha(baseRaw) ||
  base.compiler.sourcesSha256 !== sha(sourceRaw) ||
  sources.revision !== "a3e5ef85ca4cf50486f2dcd9024831432ec9921b" ||
  sources.pipelineVersion !== 4 ||
  sha(await readBytes(`${installation}/Game/League of Legends.exe`)) !==
    executableSha256
)
  throw Error("Unmatched native shader-selection evidence or installed build");
for (const ref of sources.files)
  if (sha(await readBytes(`${compiler}/${ref.path}`)) !== ref.sha256)
    throw Error(`Compiler source changed: ${ref.path}`);
const executable = `${compiler}/target/release/scout-shader-prepare.exe`;
if (
  sha(await readBytes(executable)) !== base.compiler.binarySha256 ||
  sha(await readBytes(`${compiler}/Cargo.lock`)) !== base.compiler.lockSha256
)
  throw Error("Shader compiler changed since the base shader preparation");
const run = async (args) => {
  const child = Bun.spawn([executable, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, out, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status) throw Error(`Shadow shader compiler failed: ${error}\n${out}`);
};
const expected = [
  "assets/shaders/hlsl/particlesystem/shadow_quad_vs.vs",
  "assets/shaders/hlsl/particlesystem/shadow_quad_ps.ps",
];
if (
  native.missingPreparedShaders.length !== 2 ||
  expected.some(
    (file) => !native.missingPreparedShaders.some((s) => s.file === file),
  )
)
  throw Error(
    "Native missing-shader set changed; inspect it before expanding shadow preparation",
  );
if (
  !native.selectedPairs.some(
    (p) => p.files[0] === expected[0] && p.files[1] === expected[1],
  )
)
  throw Error("Shadow stages were not selected as a native pair");
const output = `${cache}/public/latest-shadow-shaders`,
  work = `${cache}/research/latest-shadow-shaders`;
for (const path of [output, `${output}/blobs`, `${output}/stages`, work])
  await mkdir(path, { recursive: true });
const archive = "DATA/FINAL/ShaderCache.dx11.wad.client",
  archiveSha256 = sha(await readBytes(`${installation}/Game/${archive}`));
if (archiveSha256 !== base.archiveSha256)
  throw Error("Installed shader archive differs from the base package");
const { decompress } = await import(
  pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
);
const read = await openLocalWad(installation, archive, decompress);
const stages = [],
  translations = new Map(),
  bundles = new Map(),
  jobs = [];
for (const file of expected) {
  const tocPath = `${file}-dx11`,
    toc = await read(tocPath),
    tocSha256 = sha(toc);
  await Bun.write(`${work}/${tocSha256}.toc`, toc);
  await run(["toc", `${work}/${tocSha256}.toc`, `${work}/${tocSha256}.json`]);
  const parsed = await Bun.file(`${work}/${tocSha256}.json`).json();
  if (
    parsed.pipelineVersion !== 4 ||
    parsed.shaderIds.length !== parsed.shaderHashes.length
  )
    throw Error("Invalid shadow shader table");
  const stage = file.endsWith(".vs") ? "vertex" : "pixel",
    records = [];
  for (const id of new Set(parsed.shaderIds)) {
    if (!Number.isInteger(id) || id < 0)
      throw Error("Invalid shadow shader record id");
    const path = `${tocPath}_${100 * Math.floor(id / 100)}`;
    if (!bundles.has(path)) {
      const bytes = await read(path);
      bundles.set(path, { path, bytes, sha256: sha(bytes) });
    }
    const data = bundles.get(path).bytes,
      view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 0;
    for (let index = 0; index < id % 100; index++) {
      if (at + 4 > data.length) throw Error("Truncated shadow bundle");
      at += 4 + view.getUint32(at, true);
    }
    if (at + 4 > data.length) throw Error("Missing shadow record");
    const recordSize = view.getUint32(at, true),
      offset = at + 4;
    if (
      recordSize < 32 ||
      offset + recordSize > data.length ||
      Buffer.from(data.subarray(offset, offset + 4)).toString("ascii") !==
        "DXBC"
    )
      throw Error("Invalid shadow DXBC record");
    const containerSize = view.getUint32(offset + 24, true);
    if (containerSize < 32 || containerSize > recordSize)
      throw Error("Invalid shadow DXBC size");
    const dxbc = data.subarray(offset, offset + containerSize),
      dxbcSha256 = sha(dxbc),
      key = `${stage}:${dxbcSha256}`;
    if (!translations.has(key)) {
      const ref = {
        stage,
        dxbcSha256,
        dxbcBytes: dxbc.length,
        dxbc: `blobs/${dxbcSha256}.dxbc`,
        file: `stages/${dxbcSha256}.json`,
      };
      translations.set(key, ref);
      await Bun.write(`${output}/${ref.dxbc}`, dxbc);
      jobs.push({
        stage,
        source: `${output}/${ref.dxbc}`,
        output: `${output}/${ref.file}`,
      });
    }
    records.push({
      id,
      dxbcSha256,
      bundle: path,
      offset,
      recordSize,
      containerSize,
      trailingBytes: Buffer.from(
        data.subarray(offset + containerSize, offset + recordSize),
      ).toString("hex"),
    });
  }
  stages.push({
    file,
    stage,
    tocPath,
    tocSha256,
    tocBytes: toc.length,
    baseDefines: parsed.baseDefines,
    permutations: parsed.shaderIds.map((id, i) => ({
      id,
      hash: parsed.shaderHashes[i],
    })),
    records,
  });
}
await Bun.write(`${work}/jobs.json`, JSON.stringify(jobs, null, 2));
await run(["translate", `${work}/jobs.json`, `${work}/translation.json`]);
const result = await Bun.file(`${work}/translation.json`).json();
if (result.failed || result.translated !== translations.size)
  throw Error("Incomplete shadow translation");
for (const ref of translations.values()) {
  const data = await readBytes(`${output}/${ref.file}`);
  if (
    !JSON.parse(new TextDecoder().decode(data)).glsl.startsWith(
      "#version 300 es",
    )
  )
    throw Error("Shadow shader is not GLSL ES 3.00");
  ref.sha256 = sha(data);
  ref.bytes = data.length;
}
if (
  sha(await readBytes(`${installation}/Game/${archive}`)) !== archiveSha256 ||
  sha(await readBytes(`${installation}/Game/League of Legends.exe`)) !==
    executableSha256
)
  throw Error("Installed build changed during shadow preparation");
const manifest = {
  schema: 1,
  kind: "installed-particle-shader-translations",
  build: base.build,
  executableSha256,
  archive,
  archiveSha256,
  baseShaderPackageSha256: sha(baseRaw),
  nativeMaterialInspectionSha256: sha(nativeRaw),
  compiler: {
    ...base.compiler,
    preparationSha256: sha(await readBytes(import.meta.path)),
  },
  pairs: [{ name: "shadowQuad", vertex: expected[0], pixel: expected[1] }],
  stages,
  bundles: [...bundles.values()].map(({ path, bytes, sha256 }) => ({
    path,
    bytes: bytes.length,
    sha256,
  })),
  translations: [...translations.values()],
  counts: {
    pairs: 1,
    stages: stages.length,
    permutations: stages.reduce((n, s) => n + s.permutations.length, 0),
    records: stages.reduce((n, s) => n + s.records.length, 0),
    uniqueTranslations: translations.size,
    failed: 0,
  },
  scope: {
    translationOnly: true,
    browserRun: false,
    pixelsCompared: false,
    shadowSceneRendered: false,
    mainViewerIntegrated: false,
    unsupportedPermutation: "reject; never substitute another record",
  },
};
await Bun.write(`${output}/package.json`, JSON.stringify(manifest, null, 2));
await Bun.write(
  `${output}/HEXShade-LICENSE.txt`,
  Bun.file(`${compiler}/HEXShade-LICENSE`),
);
console.log(
  JSON.stringify({
    counts: manifest.counts,
    defines: stages.map((s) => ({ stage: s.stage, defines: s.baseDefines })),
  }),
);
