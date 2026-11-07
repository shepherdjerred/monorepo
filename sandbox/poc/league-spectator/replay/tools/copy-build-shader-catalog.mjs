// Copy build-only translated shader bytes, validating every stage/blob/pair.
// No replay, lineup resource, native material observation or HS process is used.
import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg || process.argv.length !== 4)
  throw Error(
    "Usage: copy-build-shader-catalog.mjs <source-cache> <target-cache>",
  );
const source = resolve(sourceArg),
  target = resolve(targetArg),
  inputs = {},
  outputs = [];
if (source === target) throw Error("Distinct isolated target cache required");
const need = (condition, message) => {
  if (!condition) throw Error(message);
};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  need(!inputs[path] || inputs[path] === hash, "Shader source changed");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
const a = await read(`${source}/public/decoder-16.21-macos/profile.json`),
  b = await read(`${target}/public/decoder-16.21-macos/profile.json`),
  packageBytes = await raw(`${source}/public/latest-shaders/package.json`),
  meta = JSON.parse(new TextDecoder().decode(packageBytes)),
  pairsBytes = await raw(`${source}/research/latest-shaders/pairs.json`),
  pairs = JSON.parse(new TextDecoder().decode(pairsBytes));
need(
  a.clientVersion === b.clientVersion &&
    a.protocolDigest === b.protocolDigest &&
    a.decoderImageSha256 === b.decoderImageSha256 &&
    meta.build === a.clientVersion &&
    meta.executableSha256 === a.windowsClientSha256 &&
    meta.compiler.pipelineVersion === 4 &&
    pairs.shaderPackageSha256 === (await sha256(packageBytes)) &&
    pairs.build === meta.build,
  "Exact shared build-only shader catalog required",
);
const inventory = new Map();
function add(path, hash, bytes) {
  need(
    typeof path === "string" &&
      /^(stages\/[a-f0-9]{64}\.json|blobs\/[a-f0-9]{64}\.dxbc)$/.test(path) &&
      /^[a-f0-9]{64}$/.test(hash) &&
      Number.isInteger(bytes) &&
      bytes > 0,
    "Bounded exact shader file identity required",
  );
  const prior = inventory.get(path);
  need(
    !prior || (prior.hash === hash && prior.bytes === bytes),
    "Conflicting shader inventory",
  );
  inventory.set(path, { hash, bytes });
}
for (const record of meta.translations) {
  add(record.file, record.sha256, record.bytes);
  add(record.dxbc, record.dxbcSha256, record.dxbcBytes);
}
for (const program of pairs.programs)
  for (const key of ["vertex", "pixel"]) {
    const record = program[key],
      stage = inventory.get(record.file),
      blob = inventory.get(record.dxbc);
    need(
      stage &&
        stage.hash === record.sha256 &&
        stage.bytes === record.bytes &&
        blob &&
        blob.hash === record.dxbcSha256 &&
        blob.bytes === record.dxbcBytes,
      "Pair references unprepared shader bytes",
    );
  }
const actual = [];
for (const dir of ["stages", "blobs"])
  for (const entry of await readdir(`${source}/public/latest-shaders/${dir}`, {
    withFileTypes: true,
  })) {
    need(
      entry.isFile() && !entry.isSymbolicLink(),
      "Plain shader files required",
    );
    actual.push(`${dir}/${entry.name}`);
  }
need(
  actual.length === inventory.size &&
    actual.every((path) => inventory.has(path)),
  "Complete exact shader file inventory required",
);
async function copy(path, data) {
  const destination = resolve(target, path);
  await Bun.write(destination, data);
  const bytes = await Bun.file(destination).bytes();
  need(
    bytes.length === data.length &&
      (await sha256(bytes)) === (await sha256(data)),
    "Shader copied bytes differ",
  );
  outputs.push({
    path: destination,
    sha256: await sha256(bytes),
    bytes: bytes.length,
  });
}
for (const [path, expected] of inventory) {
  const bytes = await raw(`${source}/public/latest-shaders/${path}`);
  need(
    bytes.length === expected.bytes && (await sha256(bytes)) === expected.hash,
    "Shader inventory bytes changed: " + path,
  );
  await copy(`public/latest-shaders/${path}`, bytes);
}
await copy("public/latest-shaders/package.json", packageBytes);
await copy(
  "public/latest-shaders/HEXShade-LICENSE.txt",
  await raw(`${source}/public/latest-shaders/HEXShade-LICENSE.txt`),
);
await copy("research/latest-shaders/pairs.json", pairsBytes);
await raw(import.meta.path);
for (const [path, hash] of Object.entries(inputs))
  need(
    (await sha256(await Bun.file(path).bytes())) === hash,
    "Build shader source drift",
  );
const output = `${target}/research/build-shader-catalog-copy.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "exact-same-build-shader-catalog-copy",
      inputs,
      outputs,
      stages: meta.stages.length,
      translations: meta.translations.length,
      pairPrograms: pairs.programs.length,
      scope: {
        entirePublishedStageBlobInventoryVerified: true,
        staticBuildContentOnly: true,
        sourceCacheUnchanged: true,
        hsAccess: false,
        replayEventsPrepared: false,
        nativeMaterialAdmissionEstablished: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    files: outputs.length,
    translations: meta.translations.length,
    pairPrograms: pairs.programs.length,
  }),
);
