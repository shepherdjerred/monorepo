// Static build preparation only. Original slot-1 samplers on complete assets;
// this does not claim native resource acquisition or replay effect activation.
import { resolve } from "node:path";
import { validateSelectedParticleColorRecords } from "./selected-particle-color-records.mjs";
export const PARTICLE_COLOR_BINDINGS_SHA =
  "ba06d3700bc3835496ab14811d9b6db1f3acab620afdeef73e8c4a23c15000a3";

export async function loadNativeParticleColorBindings({
  assets,
  raw,
  sha,
  selectedReferenceBytes = null,
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
  const root = resolve(import.meta.dir);
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
  for (const [name, h] of Object.entries(meta.sources))
    if (sha(await raw(`${root}/${name}`)) !== h)
      throw Error(`Native particle color source changed: ${name}`);
  for (const [path, h] of Object.entries(meta.inputs))
    if (sha(await raw(path)) !== h)
      throw Error(`Native particle color input changed: ${path}`);
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
