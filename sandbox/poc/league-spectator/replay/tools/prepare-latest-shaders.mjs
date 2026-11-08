// Extract exact-build particle DXBC and translate it offline with pinned Hexshade.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";

const [installation, cacheArg, compilerArg] = process.argv.slice(2);
if (!installation || !cacheArg || !compilerArg || process.argv.length !== 5)
  throw Error(
    "Usage: prepare-latest-shaders.mjs <League installation> <cache> <compiler workspace>",
  );
const cache = resolve(cacheArg),
  compiler = resolve(compilerArg);
const output = `${cache}/public/latest-shaders`,
  work = `${cache}/research/latest-shaders`;
const digest = (data) =>
  new Bun.CryptoHasher("sha256").update(data).digest("hex");
const bytes = async (path) =>
  new Uint8Array(await Bun.file(path).arrayBuffer());
const sha = async (path) => digest(await bytes(path));
const expectedExecutable =
  "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a";
if (
  (await sha(`${installation}/Game/League of Legends.exe`)) !==
  expectedExecutable
)
  throw Error("Installed executable is not the pinned 16.21.829.8620 build");
const sourceBytes = await bytes(`${compiler}/sources.json`),
  sources = JSON.parse(new TextDecoder().decode(sourceBytes));
if (
  sources.revision !== "a3e5ef85ca4cf50486f2dcd9024831432ec9921b" ||
  sources.pipelineVersion !== 4
)
  throw Error("Unsupported Hexshade source revision");
for (const file of sources.files)
  if ((await sha(`${compiler}/${file.path}`)) !== file.sha256)
    throw Error(`Compiler source changed: ${file.path}`);
if ((await sha(`${compiler}/Cargo.toml`)) !== sources.workspaceSha256)
  throw Error("Compiler workspace changed");
const executable = `${compiler}/target/release/scout-shader-prepare.exe`;
const run = async (args) => {
  const child = Bun.spawn([executable, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0)
    throw Error(`Shader preparer exited ${status}: ${stderr}\n${stdout}`);
};
await mkdir(work, { recursive: true });
await mkdir(`${output}/blobs`, { recursive: true });
await mkdir(`${output}/stages`, { recursive: true });
const archive = "DATA/FINAL/ShaderCache.dx11.wad.client";
const wadSha256 = await sha(`${installation}/Game/${archive}`);
const { decompress } = await import(
  pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
);
const read = await openLocalWad(installation, archive, decompress);
const particle = "assets/shaders/hlsl/particlesystem/",
  skin = "assets/shaders/hlsl/skinnedmesh/";
const pairs = [
  ["quad", `${particle}quad_vs.vs`, `${particle}quad_ps.ps`],
  [
    "quadFixedAlphaUv",
    `${particle}quad_vs_fixedalphauv.vs`,
    `${particle}quad_ps_fixedalphauv.ps`,
  ],
  [
    "quadScreenSpaceUv",
    `${particle}quad_screenspaceuv.vs`,
    `${particle}quad_screenspaceuv.ps`,
  ],
  ["quadSlice", `${particle}quad_vs.vs`, `${particle}quad_ps_slice.ps`],
  ["mesh", `${particle}mesh_vs.vs`, `${particle}mesh_ps.ps`],
  ["meshSlice", `${particle}mesh_vs.vs`, `${particle}mesh_ps_slice.ps`],
  ["attachedMesh", `${skin}particle_vs.vs`, `${skin}particle_ps.ps`],
  ["attachedMeshSlice", `${skin}particle_vs.vs`, `${skin}particle_ps_slice.ps`],
  ["distortion", `${particle}distortion_vs.vs`, `${particle}distortion_ps.ps`],
  [
    "distortionMesh",
    `${particle}distortion_mesh_vs.vs`,
    `${particle}distortion_mesh_ps.ps`,
  ],
  [
    "distortionAttachedMesh",
    `${skin}particle_distortion_vs.vs`,
    `${skin}particle_distortion_ps.ps`,
  ],
];
const stages = [],
  unique = new Map(),
  jobs = [],
  bundleReferences = new Map();
for (const file of new Set(pairs.flatMap((p) => p.slice(1)))) {
  const path = `${file}-dx11`,
    toc = await read(path),
    tocHash = digest(toc);
  await Bun.write(`${work}/${tocHash}.toc`, toc);
  await run(["toc", `${work}/${tocHash}.toc`, `${work}/${tocHash}.json`]);
  const parsed = await Bun.file(`${work}/${tocHash}.json`).json();
  if (
    parsed.shaderIds.length !== parsed.shaderHashes.length ||
    parsed.pipelineVersion !== 4
  )
    throw Error(`Invalid parsed shader table ${path}`);
  const stage = file.endsWith(".vs") ? "vertex" : "pixel",
    records = [];
  const bundles = new Map();
  for (const id of new Set(parsed.shaderIds)) {
    if (!Number.isInteger(id) || id < 0) throw Error("Invalid shader id");
    const start = 100 * Math.floor(id / 100),
      bundlePath = `${path}_${start}`;
    if (!bundles.has(start)) {
      const data = await read(bundlePath);
      bundles.set(start, data);
      bundleReferences.set(bundlePath, {
        path: bundlePath,
        sha256: digest(data),
        bytes: data.length,
      });
    }
    const data = bundles.get(start),
      view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;
    for (let i = 0; i < id % 100; i++) {
      if (offset + 4 > data.length)
        throw Error(`Truncated shader bundle ${bundlePath}`);
      offset += 4 + view.getUint32(offset, true);
    }
    if (offset + 4 > data.length)
      throw Error(`Missing shader record ${bundlePath}/${id}`);
    const recordSize = view.getUint32(offset, true),
      begin = offset + 4;
    if (recordSize < 32 || begin + recordSize > data.length)
      throw Error("Truncated DXBC record");
    if (String.fromCharCode(...data.subarray(begin, begin + 4)) !== "DXBC")
      throw Error("Record is not DXBC");
    const containerSize = view.getUint32(begin + 24, true);
    if (containerSize < 32 || containerSize > recordSize)
      throw Error("Invalid DXBC container size");
    const dxbc = data.subarray(begin, begin + containerSize),
      dxbcSha256 = digest(dxbc);
    const key = `${stage}:${dxbcSha256}`;
    if (!unique.has(key)) {
      const source = `${output}/blobs/${dxbcSha256}.dxbc`,
        translated = `${output}/stages/${dxbcSha256}.json`;
      await Bun.write(source, dxbc);
      unique.set(key, {
        stage,
        dxbcSha256,
        dxbcBytes: dxbc.length,
        dxbc: `blobs/${dxbcSha256}.dxbc`,
        file: `stages/${dxbcSha256}.json`,
      });
      jobs.push({ stage, source, output: translated });
    }
    records.push({
      id,
      dxbcSha256,
      bundle: bundlePath,
      offset: begin,
      recordSize,
      containerSize,
      trailingBytes: Buffer.from(
        data.subarray(begin + containerSize, begin + recordSize),
      ).toString("hex"),
    });
  }
  stages.push({
    file,
    stage,
    tocPath: path,
    tocSha256: tocHash,
    tocBytes: toc.length,
    baseDefines: parsed.baseDefines,
    permutations: parsed.shaderIds.map((id, i) => ({
      hash: parsed.shaderHashes[i],
      id,
    })),
    records,
  });
  console.log(
    JSON.stringify({
      stage: file,
      permutations: parsed.shaderIds.length,
      records: records.length,
    }),
  );
}
await Bun.write(`${work}/jobs.json`, JSON.stringify(jobs, null, 2));
await run(["translate", `${work}/jobs.json`, `${work}/translation.json`]);
const translation = await Bun.file(`${work}/translation.json`).json();
if (
  translation.failed !== 0 ||
  translation.translated !== unique.size ||
  translation.pipelineVersion !== 4
)
  throw Error("Incomplete shader translations");
const bindings = {
  blocks: new Map(),
  textures: new Map(),
  attributes: new Map(),
  patches: new Map(),
};
for (const entry of unique.values()) {
  const data = await bytes(`${output}/${entry.file}`),
    translated = JSON.parse(new TextDecoder().decode(data));
  if (!translated.glsl.startsWith("#version 300 es"))
    throw Error("Shader is not GLSL ES 3.00");
  entry.sha256 = digest(data);
  entry.bytes = data.length;
  for (const [kind, rows] of Object.entries({
    blocks: translated.sidecar.blocks,
    textures: translated.sidecar.textures,
    attributes: translated.sidecar.attributes,
  })) {
    for (const row of rows) {
      const key =
        kind === "attributes" ? `${row.semantic}${row.index}` : row.name;
      const old = bindings[kind].get(key) ?? {
        name: key,
        stages: 0,
        variants: [],
      };
      old.stages++;
      const encoded = JSON.stringify(row);
      if (!old.variants.some((v) => JSON.stringify(v) === encoded))
        old.variants.push(row);
      bindings[kind].set(key, old);
    }
  }
  for (const patch of translated.applied) {
    const key = JSON.stringify(patch);
    bindings.patches.set(key, (bindings.patches.get(key) ?? 0) + 1);
  }
}
if (
  (await sha(`${installation}/Game/${archive}`)) !== wadSha256 ||
  (await sha(`${installation}/Game/League of Legends.exe`)) !==
    expectedExecutable
)
  throw Error("Installed build changed during shader preparation");
const manifest = {
  schema: 1,
  kind: "installed-particle-shader-translations",
  build: "16.21.829.8620",
  executableSha256: expectedExecutable,
  archive,
  archiveSha256: wadSha256,
  compiler: {
    revision: sources.revision,
    pipelineVersion: 4,
    sourcesSha256: digest(sourceBytes),
    binarySha256: await sha(executable),
    lockSha256: await sha(`${compiler}/Cargo.lock`),
    preparationSha256: await sha(import.meta.path),
    license: "AGPL-3.0-or-later",
    upstream: "https://github.com/LeagueToolkit/ltk-manager",
  },
  pairs: pairs.map(([name, vertex, pixel]) => ({ name, vertex, pixel })),
  stages,
  bundles: [...bundleReferences.values()],
  translations: [...unique.values()],
  bindings: Object.fromEntries(
    Object.entries(bindings).map(([key, value]) => [
      key,
      key === "patches"
        ? [...value].map(([patch, count]) => ({
            patch: JSON.parse(patch),
            count,
          }))
        : [...value.values()],
    ]),
  ),
  counts: {
    pairs: pairs.length,
    stages: stages.length,
    permutations: stages.reduce((n, s) => n + s.permutations.length, 0),
    records: stages.reduce((n, s) => n + s.records.length, 0),
    uniqueTranslations: unique.size,
    failed: translation.failed,
  },
  scope: {
    translationOnly: true,
    webglCompiled: false,
    gpuRendered: false,
    nativePixelComparison: false,
    originalRuntimeBindingsRecovered: false,
    usedByMainViewer: false,
    unsupportedPermutation: "reject; never substitute another record",
    studioDefinesAdded: [],
  },
};
await Bun.write(`${output}/package.json`, JSON.stringify(manifest, null, 2));
await Bun.write(
  `${output}/HEXShade-LICENSE.txt`,
  Bun.file(`${compiler}/HEXShade-LICENSE`),
);
await Bun.write(`${work}/sources.json`, sourceBytes);
await Bun.write(`${work}/Cargo.lock`, Bun.file(`${compiler}/Cargo.lock`));
console.log(JSON.stringify(manifest.counts));
