// Native full-prefix vectors compared with browser-compatible decoded vectors.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StructuralDecoder } from "../structural-decoder.mjs";
import {
  createLatestEffectPlacementReader,
  EFFECT_PLACEMENT_PACKAGE_SHA,
} from "../latest-effect-placement.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-effect-placement.mjs <cache>");
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
  json = async (path) => JSON.parse(new TextDecoder().decode(await raw(path)));
const requireThat = (ok, message) => {
  if (!ok) throw Error(message);
};
const profile = await json(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  constructors = await raw(`${decoder}/constructors.bin`),
  nativePath = `${cache}/research/effect-placement-native.json`,
  native = await json(nativePath),
  gridBytes = await raw(`${cache}/research/effect-placement-grid-native.bin`),
  packageBytes = await raw(
    `${cache}/public/latest-effect-placement/package.json`,
  ),
  creationBytes = await raw(
    `${cache}/public/latest-effect-creation/package.json`,
  ),
  sceneBytes = await raw(`${cache}/public/latest-scene/manifest.json`),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  samples = await json(`${cache}/research/effect-creation-input.json`),
  objects = await json(`${cache}/research/effect-creation-objects-native.json`),
  requests = await json(`${cache}/research/effect-creation-native.json`),
  report = await json(`${cache}/research/latest-semantics-creations.json`),
  vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
requireThat(
  sha(packageBytes) === native.packageSha256 &&
    native.packageSha256 === EFFECT_PLACEMENT_PACKAGE_SHA &&
    sha(gridBytes) === native.gridOracleSha256 &&
    sha(constructors) === profile.constructorImageSha256 &&
    sha(await raw(`${root}/tools/prepare-effect-placement.py`)) ===
      native.preparerSha256 &&
    samples.replaySha256 === report.replaySha256 &&
    sha(await raw(vendor)) ===
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
  "Placement evidence provenance differs",
);
for (const [path, expected] of Object.entries(native.inputs))
  requireThat(
    sha(await raw(path)) === expected,
    `Stale placement input: ${path}`,
  );
for (const block of native.originalBlocks)
  requireThat(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Original placement instruction changed",
  );
const reader = await createLatestEffectPlacementReader(
    profile,
    image,
    creationBytes,
    packageBytes,
    sceneBytes,
  ),
  scratch = new DataView(new ArrayBuffer(4)),
  bits = (value) => {
    scratch.setFloat32(0, value, true);
    return scratch.getUint32(0, true);
  },
  grid = new DataView(
    gridBytes.buffer,
    gridBytes.byteOffset,
    gridBytes.byteLength,
  );
let gridChecks = 0,
  mixedChecks = 0,
  packetChecks = 0,
  entryChecks = 0,
  floatChecks = 0;
for (const axis of [0, 2])
  for (let value = -32768; value < 32768; value++) {
    requireThat(
      bits(reader.coordinate(axis, value)) ===
        grid.getUint32(gridChecks * 4, true),
      "Native map conversion differs",
    );
    gridChecks++;
  }
requireThat(gridChecks * 4 === gridBytes.length, "Grid oracle size differs");
for (const probe of native.mixedProbes) {
  requireThat(
    reader.decodeField(probe.field, Buffer.from(probe.encodedHex, "hex")) ===
      probe.value,
    "Mixed native placement getter differs",
  );
  mixedChecks++;
}
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  structural = new StructuralDecoder(
    await createUnicorn(),
    profile,
    image,
    constructors,
  ),
  byPacket = Map.groupBy(native.records, (record) => record.key),
  records = [];
try {
  for (const [key, sample] of Object.entries(samples.packets)) {
    const observation = structural.observePacket(
        756,
        Buffer.from(sample.payloadHex, "hex"),
        sample.param,
      ),
      expected = objects.observations[key],
      decoded = reader.read(observation),
      nativeRecords = byPacket.get(key) ?? [];
    requireThat(
      observation.complete &&
        observation.consumed === expected.consumed &&
        Buffer.from(observation.object).toString("hex") === expected.object &&
        Buffer.from(observation.heap).toString("hex") === expected.heap &&
        decoded.length === nativeRecords.length,
      `Placement packet construction differs: ${key}`,
    );
    for (let index = 0; index < decoded.length; index++) {
      const value = decoded[index],
        expectedRecord = nativeRecords[index],
        request = requests.records[entryChecks],
        creation = report.effectCreations[entryChecks],
        vectorBits = [
          value.primaryPacketPosition,
          value.secondaryPacketVector,
          value.tertiaryPacketVector,
        ].map((vector) => vector.map(bits));
      requireThat(
        value.groupIndex === expectedRecord.groupIndex &&
          value.entryIndex === expectedRecord.entryIndex &&
          request.key === key &&
          value.entityId === request.entityId &&
          value.entityId === creation.entityId &&
          JSON.stringify(value.additionalFields) ===
            JSON.stringify(expectedRecord.fields) &&
          JSON.stringify(vectorBits) ===
            JSON.stringify(expectedRecord.vectorBits) &&
          value.packetVectorsResolved &&
          !value.worldPlacementResolved &&
          !value.entityOverrideResolved &&
          !value.attachmentPoseResolved,
        `Native creation vectors differ: ${key}/${index}`,
      );
      floatChecks += 9;
      records.push({
        ...value,
        creationSequence: creation.creationSequence,
        time: creation.time,
        stream: creation.stream,
        vectorBits,
      });
      entryChecks++;
    }
    packetChecks++;
  }
} finally {
  structural.close();
}
requireThat(
  entryChecks === native.records.length &&
    entryChecks === report.effectCreations.length &&
    floatChecks === native.counts.floatLanes,
  "Placement corpus incomplete",
);
const sources = {};
for (const name of [
  "latest-effect-placement.mjs",
  "latest-effect-creation.mjs",
  "latest-movement.mjs",
  "structural-decoder.mjs",
  "structural-comparison.mjs",
  "native-decoder.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  packetChecks,
  entryChecks,
  vectors: entryChecks * 3,
  floatChecks,
  gridChecks,
  mixedChecks,
  packetPositionsInsideMap: records.filter((record) => {
    const [x, , z] = record.primaryPacketPosition;
    return (
      x >= scene.map.min[0] &&
      x <= scene.map.max[0] &&
      z >= scene.map.min[2] &&
      z <= scene.map.max[2]
    );
  }).length,
  attachmentEntityReferences: records.filter(
    (record) => record.attachmentEntityId !== 0,
  ).length,
};
const result = {
  schema: 1,
  kind: "particle-placement-comparison",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  packageSha256: EFFECT_PLACEMENT_PACKAGE_SHA,
  nativeEvidenceSha256: inputs[nativePath],
  inspectorSha256: sha(await raw(import.meta.path)),
  sources,
  inputs,
  counts,
  records,
  mismatches: [],
  scope: {
    mapInitializationExecuted: true,
    packetVectorGettersExecuted: true,
    browserCompatibleComponent: true,
    mainViewerIntegrated: false,
    entityOverrideExecuted: false,
    attachmentPoseExecuted: false,
    factoryExecuted: false,
    renderingIntegrated: false,
    browserRun: false,
    leagueReferenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/effect-placement-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(counts));
