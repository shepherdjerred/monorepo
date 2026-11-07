// Execute the original descriptor prefix in WASM against native observations.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StructuralDecoder } from "../structural-decoder.mjs";
import {
  createLatestEffectDescriptorReader,
  EFFECT_DESCRIPTOR_PACKAGE_SHA,
} from "../latest-effect-descriptor.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-effect-descriptor.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  decoder = `${cache}/public/decoder-16.21-macos`,
  inputs = {};
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  raw = async (path) => {
    const value = new Uint8Array(await Bun.file(path).arrayBuffer());
    inputs[path] = sha(value);
    return value;
  },
  json = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  hex = (bytes) => Buffer.from(bytes).toString("hex");
const requireThat = (ok, message) => {
  if (!ok) throw Error(message);
};
const nativePath = `${cache}/research/effect-descriptor-native.json`,
  native = await json(nativePath),
  profile = await json(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  constructors = await raw(`${decoder}/constructors.bin`),
  creationBytes = await raw(
    `${cache}/public/latest-effect-creation/package.json`,
  ),
  placementBytes = await raw(
    `${cache}/public/latest-effect-placement/package.json`,
  ),
  descriptorBytes = await raw(
    `${cache}/public/latest-effect-descriptor/package.json`,
  ),
  sceneBytes = await raw(`${cache}/public/latest-scene/manifest.json`),
  samples = await json(`${cache}/research/effect-creation-input.json`),
  objects = await json(`${cache}/research/effect-creation-objects-native.json`),
  report = await json(`${cache}/research/latest-semantics-creations.json`),
  vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
requireThat(
  native.packageSha256 === sha(descriptorBytes) &&
    native.packageSha256 === EFFECT_DESCRIPTOR_PACKAGE_SHA &&
    native.preparerSha256 ===
      sha(await raw(`${root}/tools/prepare-effect-descriptor.py`)) &&
    sha(constructors) === profile.constructorImageSha256 &&
    report.replaySha256 === samples.replaySha256 &&
    sha(await raw(vendor)) ===
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
  "Descriptor fixture/package changed",
);
for (const [path, expected] of Object.entries(native.inputs))
  requireThat(
    sha(await raw(path)) === expected,
    `Stale descriptor input: ${path}`,
  );
for (const block of native.originalBlocks)
  requireThat(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Executed descriptor instruction changed",
  );
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn(),
  reader = await createLatestEffectDescriptorReader({
    uc,
    profile,
    image,
    creationBytes,
    placementBytes,
    sceneBytes,
    descriptorBytes,
  }),
  structural = new StructuralDecoder(uc, profile, image, constructors),
  byPacket = Map.groupBy(native.records, (record) => record.key),
  records = [];
let packetChecks = 0,
  entryChecks = 0,
  bytesCompared = 0;
try {
  for (const [key, sample] of Object.entries(samples.packets)) {
    const observed = structural.observePacket(
        756,
        Buffer.from(sample.payloadHex, "hex"),
        sample.param,
      ),
      expected = objects.observations[key],
      heapBefore = hex(observed.heap),
      objectBefore = hex(observed.object),
      decoded = reader.read(observed),
      nativeRecords = byPacket.get(key) ?? [];
    requireThat(
      observed.complete &&
        observed.consumed === expected.consumed &&
        objectBefore === expected.object &&
        heapBefore === expected.heap &&
        hex(observed.heap) === heapBefore &&
        hex(observed.object) === objectBefore &&
        decoded.length === nativeRecords.length,
      `Descriptor packet changed: ${key}`,
    );
    for (let index = 0; index < decoded.length; index++) {
      const value = decoded[index],
        expectedRecord = nativeRecords[index],
        creation = report.effectCreations[entryChecks];
      requireThat(
        value.entityId === expectedRecord.entityId &&
          value.entityId === creation.entityId &&
          value.groupIndex === expectedRecord.groupIndex &&
          value.entryIndex === expectedRecord.entryIndex &&
          hex(value.descriptorBytes) === expectedRecord.descriptorHex &&
          hex(value.mutatedEntryBytes) === expectedRecord.mutatedEntryHex &&
          JSON.stringify(value.scalarBits) ===
            JSON.stringify(expectedRecord.scalarBits) &&
          JSON.stringify(value.vector6cBits) ===
            JSON.stringify(expectedRecord.vector6cBits) &&
          JSON.stringify(value.unresolvedAuxiliaryContextIds) ===
            JSON.stringify(expectedRecord.unresolvedAuxiliaryContextIds) &&
          Object.keys(reader.metadata.wordFields).every(
            (name) => value[name] === expectedRecord[name],
          ),
        `Original descriptor prefix differs: ${key}/${index}`,
      );
      const { descriptorBytes: bytes, mutatedEntryBytes, ...fields } = value;
      records.push({
        ...fields,
        creationSequence: creation.creationSequence,
        time: creation.time,
        descriptorHex: hex(bytes),
        mutatedEntryHex: hex(mutatedEntryBytes),
      });
      bytesCompared += bytes.length;
      entryChecks++;
    }
    packetChecks++;
  }
} finally {
  reader.close();
  structural.close();
}
requireThat(
  entryChecks === native.counts.entries &&
    entryChecks === report.effectCreations.length &&
    bytesCompared === native.counts.descriptorBytesCompared,
  "Incomplete descriptor corpus",
);
const counts = {
  packetChecks,
  entryChecks,
  bytesCompared,
  nondefaultScalar78: records.filter(
    (record) => record.scalarBits.scalar78 !== 0x3f800000,
  ).length,
  nondefaultScalar7c: records.filter(
    (record) => record.scalarBits.scalar7c !== 0x3f800000,
  ).length,
  nonzeroScalarA0: records.filter((record) => record.scalarBits.scalarA0 !== 0)
    .length,
  nonzeroVector6c: records.filter((record) =>
    record.vector6cBits.some((bits) => (bits & 0x7fffffff) !== 0),
  ).length,
  flagCounts: Object.fromEntries(
    [...Map.groupBy(records, (record) => record.flags)].map(
      ([flags, entries]) => [flags, entries.length],
    ),
  ),
  auxiliaryContextIds: records.reduce(
    (sum, record) => sum + record.unresolvedAuxiliaryContextIds.length,
    0,
  ),
};
for (const name of [
  "nondefaultScalar78",
  "nondefaultScalar7c",
  "nonzeroScalarA0",
  "nonzeroVector6c",
  "flagCounts",
  "auxiliaryContextIds",
])
  requireThat(
    JSON.stringify(counts[name]) === JSON.stringify(native.counts[name]),
    `Descriptor summary differs: ${name}`,
  );
const sources = {};
for (const name of [
  "latest-effect-descriptor.mjs",
  "latest-effect-placement.mjs",
  "latest-effect-creation.mjs",
  "latest-movement.mjs",
  "native-decoder.mjs",
  "structural-decoder.mjs",
  "structural-comparison.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "particle-descriptor-comparison",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  packageSha256: EFFECT_DESCRIPTOR_PACKAGE_SHA,
  nativeEvidenceSha256: inputs[nativePath],
  inspectorSha256: sha(await raw(import.meta.path)),
  sources,
  inputs,
  counts,
  records,
  mismatches: [],
  scope: {
    originalDescriptorPrefixExecuted: true,
    packetVectorInputsNative: true,
    entityPointersSuppliedZero: true,
    inputObservationPreserved: true,
    auxiliaryContextLookupExecuted: false,
    resourceLookupExecuted: false,
    worldRegistryExecuted: false,
    factoryExecuted: false,
    mainViewerIntegrated: false,
    renderingIntegrated: false,
    browserRun: false,
    leagueReferenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/effect-descriptor-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(counts));
