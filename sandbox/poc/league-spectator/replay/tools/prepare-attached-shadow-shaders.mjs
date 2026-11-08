// Static exact-build supplement for the shadow stages selected by attached meshes.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";
const [installation, cacheArg, compilerArg] = process.argv.slice(2);
if (!compilerArg || process.argv.length !== 5)
  throw Error(
    "Usage: prepare-attached-shadow-shaders.mjs <installation> <cache> <compiler workspace>",
  );
const cache = resolve(cacheArg),
  compiler = resolve(compilerArg),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  baseRaw = await raw(`${cache}/public/latest-shaders/package.json`),
  base = JSON.parse(new TextDecoder().decode(baseRaw)),
  nativeRaw = await raw(`${cache}/research/attached-materials-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeRaw)),
  compilerRaw = await raw(`${compiler}/sources.json`),
  sources = JSON.parse(new TextDecoder().decode(compilerRaw)),
  executableSha256 =
    "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a",
  executable = `${compiler}/target/release/scout-shader-prepare.exe`;
check(
  base.build === "16.21.829.8620" &&
    native.build === base.build &&
    native.scope.partialCorpus === false &&
    native.counts.emitters === 181 &&
    base.compiler.sourcesSha256 === sha(compilerRaw) &&
    sources.pipelineVersion === 4 &&
    sources.revision === "a3e5ef85ca4cf50486f2dcd9024831432ec9921b" &&
    sha(await raw(`${installation}/Game/League of Legends.exe`)) ===
      executableSha256 &&
    sha(await raw(executable)) === base.compiler.binarySha256 &&
    sha(await raw(`${compiler}/Cargo.lock`)) === base.compiler.lockSha256 &&
    sha(await raw(`${compiler}/Cargo.toml`)) === sources.workspaceSha256,
  "Unmatched attached shadow build or compiler",
);
for (const file of sources.files)
  check(
    sha(await raw(`${compiler}/${file.path}`)) === file.sha256,
    `Compiler changed: ${file.path}`,
  );
const pairs = [
  {
    name: "shadowAttachedMesh",
    vertex: "assets/shaders/hlsl/skinnedmesh/particle_shadow_vs.vs",
    pixel: "assets/shaders/hlsl/skinnedmesh/particle_shadow_ps.ps",
  },
  {
    name: "shadowMesh",
    vertex: "assets/shaders/hlsl/particlesystem/shadow_mesh_vs.vs",
    pixel: "assets/shaders/hlsl/particlesystem/shadow_mesh_ps.ps",
  },
];
for (const pair of pairs)
  check(
    native.emitters.some((e) =>
      e.probes.some(
        (p) =>
          p.selection.vertex.toLowerCase() === pair.vertex &&
          p.selection.pixel.toLowerCase() === pair.pixel,
      ),
    ),
    "Shadow pair lacks original selection evidence",
  );
const archive = "DATA/FINAL/ShaderCache.dx11.wad.client",
  archiveSha256 = sha(await raw(`${installation}/Game/${archive}`));
check(archiveSha256 === base.archiveSha256, "Shader archive changed");
const { decompress } = await import(
    pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
  ),
  read = await openLocalWad(installation, archive, decompress),
  output = `${cache}/public/latest-attached-shadow-shaders`,
  work = `${cache}/research/latest-attached-shadow-shaders`;
for (const dir of [output, `${output}/stages`, `${output}/blobs`, work])
  await mkdir(dir, { recursive: true });
async function run(args) {
  const child = Bun.spawn([executable, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    }),
    [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
  check(code === 0, `Attached shadow compiler failed: ${error}\n${out}`);
}
const stages = [],
  translations = new Map(),
  bundles = new Map(),
  jobs = [];
for (const file of pairs.flatMap((p) => [p.vertex, p.pixel])) {
  const tocPath = `${file}-dx11`,
    toc = await read(tocPath),
    tocSha256 = sha(toc);
  await Bun.write(`${work}/${tocSha256}.toc`, toc);
  await run(["toc", `${work}/${tocSha256}.toc`, `${work}/${tocSha256}.json`]);
  const parsed = await Bun.file(`${work}/${tocSha256}.json`).json();
  check(
    parsed.pipelineVersion === 4 &&
      parsed.shaderIds.length === parsed.shaderHashes.length,
    "Invalid attached shadow TOC",
  );
  const stage = file.endsWith(".vs") ? "vertex" : "pixel",
    records = [];
  for (const id of new Set(parsed.shaderIds)) {
    check(Number.isInteger(id) && id >= 0, "Invalid shadow record id");
    const bundle = `${tocPath}_${100 * Math.floor(id / 100)}`;
    if (!bundles.has(bundle)) {
      const bytes = await read(bundle);
      bundles.set(bundle, { path: bundle, bytes, sha256: sha(bytes) });
    }
    const data = bundles.get(bundle).bytes,
      view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 0;
    for (let i = 0; i < id % 100; i++) {
      check(at + 4 <= data.length, "Truncated attached shadow bundle");
      at += 4 + view.getUint32(at, true);
    }
    check(at + 4 <= data.length, "Missing attached shadow record");
    const recordSize = view.getUint32(at, true),
      offset = at + 4;
    check(
      recordSize >= 32 &&
        offset + recordSize <= data.length &&
        Buffer.from(data.subarray(offset, offset + 4)).toString("ascii") ===
          "DXBC",
      "Invalid attached shadow DXBC",
    );
    const containerSize = view.getUint32(offset + 24, true);
    check(
      containerSize >= 32 && containerSize <= recordSize,
      "Invalid attached shadow container",
    );
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
      bundle,
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
check(
  result.failed === 0 && result.translated === translations.size,
  "Incomplete attached shadow translation",
);
for (const ref of translations.values()) {
  const b = await raw(`${output}/${ref.file}`);
  check(
    JSON.parse(new TextDecoder().decode(b)).glsl.startsWith("#version 300 es"),
    "Attached shadow is not GLSL ES 3.00",
  );
  ref.sha256 = sha(b);
  ref.bytes = b.length;
}
check(
  sha(await raw(`${installation}/Game/${archive}`)) === archiveSha256 &&
    sha(await raw(`${installation}/Game/League of Legends.exe`)) ===
      executableSha256,
  "Installed shader source changed during preparation",
);
const meta = {
  schema: 1,
  kind: "installed-particle-shader-translations",
  build: base.build,
  executableSha256,
  archive,
  archiveSha256,
  baseShaderPackageSha256: sha(baseRaw),
  nativeMaterialSha256: sha(nativeRaw),
  compiler: {
    ...base.compiler,
    preparationSha256: sha(await raw(import.meta.path)),
  },
  pairs,
  stages,
  bundles: [...bundles.values()].map(({ path, bytes, sha256 }) => ({
    path,
    bytes: bytes.length,
    sha256,
  })),
  translations: [...translations.values()],
  counts: {
    pairs: pairs.length,
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
await Bun.write(`${output}/package.json`, JSON.stringify(meta, null, 2));
await Bun.write(
  `${output}/HEXShade-LICENSE.txt`,
  Bun.file(`${compiler}/HEXShade-LICENSE`),
);
console.log(
  JSON.stringify({
    counts: meta.counts,
    defines: stages.map((s) => ({ stage: s.stage, defines: s.baseDefines })),
  }),
);
