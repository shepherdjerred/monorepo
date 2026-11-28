// Static build preparation only. Original slot-1 samplers on complete assets;
// this does not claim native resource acquisition or replay effect activation.
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { validateSelectedParticleColorRecords } from "./selected-particle-color-records.mjs";
export const PARTICLE_COLOR_BINDINGS_SHA =
  "ba06d3700bc3835496ab14811d9b6db1f3acab620afdeef73e8c4a23c15000a3";

async function recoveredProofFile(root, path) {
  const file = await realpath(resolve(root, path));
  const fromRoot = relative(root, file);
  if (
    !fromRoot ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  )
    throw Error("Recovered particle color proof file escapes its root");
  return file;
}

export async function verifyParticleColorProofInputs({
  assets,
  inputs,
  sources,
  raw,
  sha,
  recovery = null,
}) {
  const tools = resolve(import.meta.dir);
  const recordedAssetRoot =
    typeof recovery?.recordedAssetRoot === "string"
      ? recovery.recordedAssetRoot.replaceAll("\\", "/").replace(/\/$/, "")
      : null;
  if (
    recovery !== null &&
    (!/^(?:[A-Za-z]:\/|\/)[^:]+$/.test(recordedAssetRoot ?? "") ||
      recordedAssetRoot
        .split("/")
        .some((part) => part === "." || part === "..") ||
      typeof recovery.sourceRoot !== "string" ||
      !isAbsolute(recovery.sourceRoot))
  )
    throw Error(
      "Explicit recorded asset root and recovered source root required",
    );
  const assetRoot = recovery === null ? null : await realpath(assets);
  const sourceRoot =
    recovery === null ? null : await realpath(recovery.sourceRoot);
  for (const [name, digest] of Object.entries(sources)) {
    if (sourceRoot !== null && !/^[A-Za-z0-9_-]+\.py$/.test(name))
      throw Error("Recovered particle color proof requires a source filename");
    const file =
      sourceRoot === null
        ? `${tools}/${name}`
        : await recoveredProofFile(sourceRoot, name);
    if (sha(await raw(file)) !== digest)
      throw Error(`Native particle color source changed: ${name}`);
  }
  for (const [path, digest] of Object.entries(inputs)) {
    let file = path;
    if (assetRoot !== null) {
      const recordedPath = path.replaceAll("\\", "/");
      const prefix = `${recordedAssetRoot}/`;
      if (!recordedPath.startsWith(prefix))
        throw Error("Unrecognized recorded particle color asset root");
      const name = recordedPath.slice(prefix.length);
      if (
        name
          .split("/")
          .some(
            (part) =>
              !/^[A-Za-z0-9_. -]+$/.test(part) || part === "." || part === "..",
          )
      )
        throw Error("Invalid recovered particle color asset path");
      file = await recoveredProofFile(assetRoot, name);
    }
    if (sha(await raw(file)) !== digest)
      throw Error(`Native particle color input changed: ${path}`);
  }
}

export async function loadNativeParticleColorBindings({
  assets,
  raw,
  sha,
  selectedReferenceBytes = null,
  recovery = null,
}) {
  const bytes = await raw(`${assets}/latest-particle-color/package.json`);
  const selected = selectedReferenceBytes !== null;
  if (
    (!selected && sha(bytes) !== PARTICLE_COLOR_BINDINGS_SHA) ||
    (selected && sha(selectedReferenceBytes) !== PARTICLE_COLOR_BINDINGS_SHA)
  )
    throw Error("Original particle color binding package changed");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.kind !== "native-authored-particle-color-bindings" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    !meta.scope.completeAssetBytesUnchanged ||
    !meta.scope.originalSamplerPrefixExecuted ||
    meta.scope.textureAcquisitionExecuted ||
    meta.scope.nativeFactoryExecuted ||
    meta.scope.gpuSubmitted ||
    meta.entries.length !== meta.counts.emitters
  )
    throw Error("Unsupported native particle color contract");
  if (selected)
    await validateSelectedParticleColorRecords({
      meta,
      approved: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          selectedReferenceBytes,
        ),
      ),
      assets,
      raw,
      sha,
    });
  await verifyParticleColorProofInputs({
    assets,
    inputs: meta.inputs,
    sources: meta.sources,
    raw,
    sha,
    recovery,
  });
  const image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
  if (sha(image) !== meta.decoderImageSha256)
    throw Error("Native color decoder image differs");
  for (const b of meta.sourceBlocks)
    if (sha(image.subarray(b.startRva, b.endRva)) !== b.sha256)
      throw Error("Original particle color instructions changed");
  if (selected)
    for (const b of meta.originalBlocks)
      if (
        !Number.isSafeInteger(b.rva) ||
        !Number.isSafeInteger(b.size) ||
        b.rva < 0 ||
        b.size <= 0 ||
        b.rva + b.size > image.length ||
        sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256
      )
        throw Error(
          "Selected original particle color instruction block changed",
        );
  const entries = new Map();
  for (const entry of meta.entries) {
    const key = `${entry.effectId}:${entry.emitterIndex}`;
    if (
      entries.has(key) ||
      entry.nativeSlot !== 1 ||
      entry.nativeName !== "PARTICLE_COLOR_TEXTURE" ||
      !/^010101(00|01)\1$/.test(entry.descriptorHex)
    )
      throw Error("Ambiguous native color binding or sampler");
    entries.set(key, entry);
  }
  return entries;
}
