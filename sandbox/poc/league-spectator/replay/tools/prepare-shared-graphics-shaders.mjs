// Extend the frozen particle shader package with exact native-requested stages.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";

const [installation, cacheArg, compilerArg, ...tail] = process.argv.slice(2);
let outputName = "latest-shared-shaders",
  seedName = "latest-shared-shaders";
const options = new Set();
const requested = [];
for (let i = 0; i < tail.length; i++) {
  if (["--output-name", "--seed-name"].includes(tail[i])) {
    const flag = tail[i];
    if (options.has(flag) || !tail[i + 1])
      throw Error("One explicit shared shader output name required");
    options.add(flag);
    if (flag === "--output-name") outputName = tail[++i];
    else seedName = tail[++i];
  } else requested.push(tail[i]);
}
if (
  !installation ||
  !cacheArg ||
  !compilerArg ||
  !/^latest-shared-shaders(?:-[a-z0-9-]+)?$/.test(outputName) ||
  !/^latest-shared-shaders(?:-[a-z0-9-]+)?$/.test(seedName) ||
  outputName.length > 48 ||
  seedName.length > 48 ||
  (options.has("--seed-name") && outputName === "latest-shared-shaders") ||
  !requested.length ||
  requested.some(
    (p) =>
      !/^assets\/shaders\/(?:hlsl|generated\/shaders)\/[a-z0-9_/-]+\.(vs|ps)$/i.test(
        p,
      ),
  )
)
  throw Error(
    "Usage: prepare-shared-graphics-shaders.mjs <installation> <cache> <compiler> [--output-name latest-shared-shaders-<name>] [--seed-name latest-shared-shaders-<name>] <native shader paths...>",
  );
const cache = resolve(cacheArg),
  compiler = resolve(compilerArg),
  output = `${cache}/public/${outputName}`,
  work = `${cache}/research/shared-graphics-shaders${outputName.slice("latest-shared-shaders".length)}`,
  bytes = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  digest = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  sha = async (p) => digest(await bytes(p));
const baseBytes = await bytes(`${cache}/public/latest-shaders/package.json`),
  base = JSON.parse(new TextDecoder().decode(baseBytes)),
  baseSha = digest(baseBytes),
  sourceBytes = await bytes(`${compiler}/sources.json`),
  sources = JSON.parse(new TextDecoder().decode(sourceBytes));
if (
  base.schema !== 1 ||
  base.kind !== "installed-particle-shader-translations" ||
  base.build !== "16.21.829.8620" ||
  base.compiler.pipelineVersion !== 4 ||
  sources.pipelineVersion !== 4 ||
  sources.revision !== "a3e5ef85ca4cf50486f2dcd9024831432ec9921b" ||
  digest(sourceBytes) !== base.compiler.sourcesSha256 ||
  (await sha(`${installation}/Game/League of Legends.exe`)) !==
    base.executableSha256 ||
  (await sha(`${installation}/Game/${base.archive}`)) !== base.archiveSha256
)
  throw Error(
    "Exact installed build, base package and pinned shader compiler required",
  );
for (const f of sources.files)
  if ((await sha(`${compiler}/${f.path}`)) !== f.sha256)
    throw Error(`Compiler source changed: ${f.path}`);
if (
  (await sha(`${compiler}/Cargo.toml`)) !== sources.workspaceSha256 ||
  (await sha(`${compiler}/Cargo.lock`)) !== base.compiler.lockSha256
)
  throw Error("Pinned compiler workspace/lock required");
const executable = `${compiler}/target/release/scout-shader-prepare.exe`;
if ((await sha(executable)) !== base.compiler.binarySha256)
  throw Error("Pinned compiler executable required");
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
    throw Error(`Shader compiler exited ${status}: ${stderr}\n${stdout}`);
};
await mkdir(`${output}/blobs`, { recursive: true });
await mkdir(`${output}/stages`, { recursive: true });
await mkdir(work, { recursive: true });
const previous = await Bun.file(`${output}/package.json`).exists(),
  seedDirectory =
    outputName === "latest-shared-shaders"
      ? `${cache}/public/latest-shaders`
      : `${cache}/public/${seedName}`,
  manifest = previous
    ? await Bun.file(`${output}/package.json`).json()
    : outputName === "latest-shared-shaders"
      ? structuredClone(base)
      : await Bun.file(`${seedDirectory}/package.json`).json();
if (
  (previous || outputName !== "latest-shared-shaders") &&
  (manifest.extension?.basePackageSha256 !== baseSha ||
    manifest.build !== base.build ||
    manifest.archiveSha256 !== base.archiveSha256 ||
    manifest.compiler.binarySha256 !== base.compiler.binarySha256)
)
  throw Error(
    "Existing shared shader package belongs to a different base/compiler",
  );
for (const entry of manifest.translations) {
  if (
    !/^stages\/[a-f0-9]{64}\.json$/.test(entry.file) ||
    !/^blobs\/[a-f0-9]{64}\.dxbc$/.test(entry.dxbc)
  )
    throw Error("Shader translation references escape the prepared package");
  const directory = previous ? output : seedDirectory;
  for (const [file, hash] of [
    [entry.file, entry.sha256],
    [entry.dxbc, entry.dxbcSha256],
  ]) {
    const data = await bytes(`${directory}/${file}`);
    if (digest(data) !== hash)
      throw Error(`Prepared shader bytes changed: ${file}`);
    if (!previous) await Bun.write(`${output}/${file}`, data);
  }
}
const { decompress } = await import(
    pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
  ),
  read = await openLocalWad(installation, base.archive, decompress),
  unique = new Map(
    manifest.translations.map((x) => [`${x.stage}:${x.dxbcSha256}`, x]),
  ),
  bundles = new Map(manifest.bundles.map((x) => [x.path, x])),
  jobs = [];
for (const file of new Set(requested.map((p) => p.toLowerCase()))) {
  if (manifest.stages.some((x) => x.file === file)) continue;
  const path = `${file}-dx11`,
    toc = await read(path),
    tocHash = digest(toc);
  await Bun.write(`${work}/${tocHash}.toc`, toc);
  await run(["toc", `${work}/${tocHash}.toc`, `${work}/${tocHash}.json`]);
  const parsed = await Bun.file(`${work}/${tocHash}.json`).json();
  if (
    parsed.pipelineVersion !== 4 ||
    parsed.shaderIds.length !== parsed.shaderHashes.length
  )
    throw Error("Invalid native shader TOC");
  const stage = file.endsWith(".vs") ? "vertex" : "pixel",
    records = [],
    loaded = new Map();
  for (const id of new Set(parsed.shaderIds)) {
    if (!Number.isInteger(id) || id < 0)
      throw Error("Invalid native shader ID");
    const start = 100 * Math.floor(id / 100),
      bundlePath = `${path}_${start}`;
    if (!loaded.has(start)) {
      const data = await read(bundlePath),
        reference = {
          path: bundlePath,
          sha256: digest(data),
          bytes: data.length,
        };
      if (
        bundles.has(bundlePath) &&
        JSON.stringify(bundles.get(bundlePath)) !== JSON.stringify(reference)
      )
        throw Error("Shader bundle changed");
      loaded.set(start, data);
      bundles.set(bundlePath, reference);
    }
    const data = loaded.get(start),
      view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;
    for (let i = 0; i < id % 100; i++) {
      if (offset + 4 > data.length) throw Error("Truncated shader bundle");
      offset += 4 + view.getUint32(offset, true);
    }
    if (offset + 4 > data.length) throw Error("Missing shader record");
    const recordSize = view.getUint32(offset, true),
      begin = offset + 4;
    if (
      recordSize < 32 ||
      begin + recordSize > data.length ||
      Buffer.from(data.subarray(begin, begin + 4)).toString() !== "DXBC"
    )
      throw Error("Invalid DXBC record");
    const containerSize = view.getUint32(begin + 24, true);
    if (containerSize < 32 || containerSize > recordSize)
      throw Error("Invalid DXBC container size");
    const dxbc = data.subarray(begin, begin + containerSize),
      dxbcSha256 = digest(dxbc),
      key = `${stage}:${dxbcSha256}`;
    if (!unique.has(key)) {
      const entry = {
        stage,
        dxbcSha256,
        dxbcBytes: dxbc.length,
        dxbc: `blobs/${dxbcSha256}.dxbc`,
        file: `stages/${dxbcSha256}.json`,
      };
      await Bun.write(`${output}/${entry.dxbc}`, dxbc);
      unique.set(key, entry);
      jobs.push({
        stage,
        source: `${output}/${entry.dxbc}`,
        output: `${output}/${entry.file}`,
      });
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
  const permutationMap = new Map();
  for (const [index, id] of parsed.shaderIds.entries()) {
    const hash = parsed.shaderHashes[index];
    if (permutationMap.has(hash) && permutationMap.get(hash) !== id)
      throw Error(`Conflicting native shader TOC mapping: ${file}/${hash}`);
    permutationMap.set(hash, id);
  }
  manifest.stages.push({
    file,
    stage,
    tocPath: path,
    tocSha256: tocHash,
    tocBytes: toc.length,
    baseDefines: parsed.baseDefines,
    sourcePermutationRows: parsed.shaderIds.length,
    permutations: [...permutationMap].map(([hash, id]) => ({ hash, id })),
    records,
  });
  console.log(
    JSON.stringify({
      file,
      records: records.length,
      sourcePermutationRows: parsed.shaderIds.length,
      permutations: permutationMap.size,
    }),
  );
}
await Bun.write(`${work}/jobs.json`, JSON.stringify(jobs, null, 2));
if (jobs.length) {
  await run(["translate", `${work}/jobs.json`, `${work}/translation.json`]);
  const translated = await Bun.file(`${work}/translation.json`).json();
  if (
    translated.pipelineVersion !== 4 ||
    translated.failed ||
    translated.translated !== jobs.length
  )
    throw Error("Incomplete shared shader translations");
}
for (const entry of unique.values()) {
  const data = await bytes(`${output}/${entry.file}`),
    translation = JSON.parse(new TextDecoder().decode(data));
  if (!translation.glsl.startsWith("#version 300 es"))
    throw Error("Shared shader is not GLSL ES 3.00");
  if (entry.sha256 && entry.sha256 !== digest(data))
    throw Error("Existing shared translation changed");
  entry.sha256 = digest(data);
  entry.bytes = data.length;
}
if (
  (await sha(`${installation}/Game/${base.archive}`)) !== base.archiveSha256 ||
  (await sha(`${installation}/Game/League of Legends.exe`)) !==
    base.executableSha256
)
  throw Error("Installed build changed during preparation");
manifest.translations = [...unique.values()];
manifest.bundles = [...bundles.values()];
manifest.extension = {
  basePackageSha256: baseSha,
  preparerSha256: await sha(import.meta.path),
  wadReaderSha256: await sha(`${import.meta.dir}/wad.mjs`),
  compilerSourcesSha256: digest(sourceBytes),
  stagePaths: manifest.stages
    .filter((s) => !base.stages.some((b) => b.file === s.file))
    .map((s) => s.file),
};
manifest.counts = {
  pairs: manifest.pairs.length,
  stages: manifest.stages.length,
  permutations: manifest.stages.reduce((n, s) => n + s.permutations.length, 0),
  records: manifest.stages.reduce((n, s) => n + s.records.length, 0),
  uniqueTranslations: unique.size,
  failed: 0,
};
manifest.scope = {
  ...manifest.scope,
  includesSharedGraphicsStages: true,
  aggregateBindingsIncludeExtension: false,
  webglCompiled: false,
  gpuRendered: false,
  nativePixelComparison: false,
};
await Bun.write(`${output}/package.json`, JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({ output: `${output}/package.json`, ...manifest.counts }),
);
