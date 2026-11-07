import { resolve, dirname } from "node:path";
import { createLatestVfxAssetInventory } from "../latest-vfx-assets.mjs";
const [packagePath, effectsPath, workPath, nativePath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-assets.mjs <decoder> <effects> <work> <native> <comparison>",
  );
const root = resolve(packagePath),
  effects = resolve(effectsPath),
  work = resolve(workPath),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  metaRaw = await Bun.file(`${root}/vfx-assets.json`).arrayBuffer(),
  meta = JSON.parse(new TextDecoder().decode(metaRaw)),
  nativeRaw = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeRaw)),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  factory = await createLatestVfxAssetInventory(profile, metaRaw),
  manifestRaw = await Bun.file(`${effects}/manifest.json`).arrayBuffer(),
  manifest = JSON.parse(new TextDecoder().decode(manifestRaw));
if (
  native.definitionSha256 !== hash(metaRaw) ||
  native.build !== meta.build ||
  native.protocol !== meta.protocol ||
  hash(image) !== meta.decoderImageSha256 ||
  hash(manifestRaw) !== meta.effectsManifestSha256 ||
  hash(await Bun.file(`${effects}/package.json`).arrayBuffer()) !==
    meta.sourcePackageSha256
)
  throw Error("Native VFX asset evidence source mismatch");
for (const [name, digest] of Object.entries({
  ...meta.compilerSources,
  ...native.compilerSources,
}))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale native asset compiler ${name}`);
for (const b of native.originalBlocks)
  if (hash(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Native asset code changed");
const rawSources = new Map(),
  sourceCache = new Map(),
  parserId = manifest.toolchain.parserIdentity.slice(0, 16),
  fieldsByHash = new Map(
    factory.typeInfo(0x09cde442).properties.map((p) => [p.hash, p]),
  ),
  observations = new Map(native.observations.map((o) => [o.key, o])),
  mismatches = [],
  effectsCache = new Map(),
  widths = new Map([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 2],
    [5, 2],
    [6, 4],
    [7, 4],
    [8, 8],
    [9, 8],
    [10, 4],
    [11, 8],
    [12, 12],
    [13, 16],
    [14, 64],
    [15, 4],
  ]);
for (const [path, digest] of Object.entries(meta.rawSources)) {
  if (!sourceCache.has(digest)) {
    const raw = new Uint8Array(
      await Bun.file(`${work}/bins/${digest}-${parserId}.bin`).arrayBuffer(),
    );
    if (hash(raw) !== digest) throw Error("Native asset raw BIN changed");
    sourceCache.set(digest, raw);
  }
  rawSources.set(path, sourceCache.get(digest));
}
let emitters = 0,
  fields = 0,
  primitiveChecks = 0,
  stringChecks = 0,
  flagChecks = 0,
  bytes = 0,
  heapBytes = 0;
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
for (const [key, ref] of Object.entries(meta.emitters)) {
  if (!effectsCache.has(ref.effectId))
    effectsCache.set(
      ref.effectId,
      await Bun.file(
        `${effects}/${manifest.definitions[ref.effectId].file}`,
      ).arrayBuffer(),
    );
  const graphRaw = await Bun.file(`${root}/${ref.file}`).arrayBuffer(),
    asset = await factory.bindEmitter(
      ref.effectId,
      ref.emitterIndex,
      effectsCache.get(ref.effectId),
      graphRaw,
    ),
    view = new DataView(asset.object.buffer),
    raw = rawSources.get(ref.rawSource),
    observation = observations.get(key);
  if (
    !observation ||
    observation.graphSha256 !== hash(graphRaw) ||
    observation.objectSha256 !== hash(asset.object) ||
    observation.heapSha256 !== hash(asset.heap)
  )
    throw Error("Native emitter asset observation changed");
  emitters++;
  bytes += graphRaw.byteLength;
  heapBytes += asset.heap.length;
  const final = new Map(ref.fields.map((f) => [f.hash, f]));
  for (const field of ref.fields) {
    fields++;
    const serialized = raw.subarray(field.offset, field.offset + field.bytes),
      sv = new DataView(
        serialized.buffer,
        serialized.byteOffset,
        serialized.byteLength,
      );
    if (
      hash(serialized) !== field.sha256 ||
      sv.getUint32(0, true) !== field.hash ||
      serialized[4] !== field.type
    )
      throw Error("Native asset field span/source mismatch");
    const prop = fieldsByHash.get(field.hash);
    if (
      !prop ||
      prop.type !== field.type ||
      final.get(field.hash) !== field ||
      asset.ignored.some((p) => p.hash === field.hash) ||
      asset.mismatched.some((p) => p.hash === field.hash)
    )
      continue;
    const record = Uint8Array.from(prop.recordHex.match(/../g), (b) =>
        parseInt(b, 16),
      ),
      pv = new DataView(record.buffer);
    if (pv.getBigUint64(0x20, true) !== 0n) continue; // Custom native accessors retain their own ABI.
    let good = true;
    if (widths.has(field.type)) {
      const width = widths.get(field.type);
      primitiveChecks++;
      good =
        field.bytes === 5 + width &&
        equal(
          asset.object.subarray(prop.offset, prop.offset + width),
          serialized.subarray(5),
        );
    } else if (field.type === 0x87) {
      flagChecks++;
      good =
        field.bytes === 6 &&
        ((asset.object[prop.offset] & prop.mask) !== 0) ===
          (serialized[5] !== 0);
    } else if (field.type === 16) {
      stringChecks++;
      const length = sv.getUint16(5, true),
        actualLength = view.getUint32(prop.offset + 8, true),
        pointer = Number(view.getBigUint64(prop.offset, true));
      let actual;
      if (!length) actual = new Uint8Array();
      else if (
        pointer >= asset.heapStart &&
        pointer + length <= asset.heapStart + asset.heap.length
      )
        actual = asset.heap.subarray(
          pointer - asset.heapStart,
          pointer - asset.heapStart + length,
        );
      else if (
        pointer >= profile.imageBase &&
        pointer + length <= profile.imageBase + image.length
      )
        actual = image.subarray(
          pointer - profile.imageBase,
          pointer - profile.imageBase + length,
        );
      else if (pointer >= 0x10020000 && pointer + length <= 0x10020470)
        actual = asset.object.subarray(
          pointer - 0x10020000,
          pointer - 0x10020000 + length,
        );
      good =
        length === actualLength &&
        actual !== undefined &&
        field.bytes === 7 + length &&
        equal(actual, serialized.subarray(7));
    }
    if (!good)
      mismatches.push({
        key,
        hash: field.hash,
        type: field.type,
        offset: prop.offset,
      });
  }
}
if (
  emitters !== meta.summary.emitters ||
  fields !== meta.summary.fields ||
  observations.size !== emitters
)
  throw Error("Incomplete native asset inventory");
const result = {
  schema: 1,
  build: meta.build,
  protocol: meta.protocol,
  definitionSha256: hash(metaRaw),
  nativeEvidenceSha256: hash(nativeRaw),
  moduleSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-assets.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  types: Object.keys(meta.types).length,
  emitterProperties: fieldsByHash.size,
  emitters,
  fields,
  primitiveChecks,
  stringChecks,
  flagChecks,
  bytes,
  heapBytes,
  rawBins: sourceCache.size,
  repeatedLoads: native.repeatedLoads,
  originalBlocks: native.originalBlocks.length,
  nativeIgnoredFields: meta.summary.nativeIgnoredFields,
  nativeTypeMismatches: meta.summary.nativeTypeMismatches,
  unsupportedClassEmitters: meta.summary.unsupportedClassEmitters ?? 0,
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 20),
  scope: meta.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, scope: undefined }));
if (mismatches.length) process.exitCode = 1;
